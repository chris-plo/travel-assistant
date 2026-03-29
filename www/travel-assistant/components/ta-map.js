/**
 * ta-map — Leaflet.js map showing trip route.
 * Attributes/properties:
 *   legs  — array of leg objects
 */
import { resolveCoords } from "../city-coords.js";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

const STATUS_COLORS = {
  upcoming:  "#2196F3",
  active:    "#4CAF50",
  completed: "#9E9E9E",
  cancelled: "#F44336",
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}

// Great-circle arc midpoint (approximate)
function arcMidpoint(a, b) {
  const lat = (a.lat + b.lat) / 2;
  const lng = (a.lng + b.lng) / 2;
  const dist = Math.sqrt((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2);
  // Offset midpoint perpendicular to route
  const dlat = -(b.lng - a.lng) / dist * dist * 0.15;
  const dlng =  (b.lat - a.lat) / dist * dist * 0.15;
  return { lat: lat + dlat, lng: lng + dlng };
}

class TaMap extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._legs = [];
    this._map = null;
    this._layers = [];
    this._selectedLegId = null;
  }

  set legs(val) {
    this._legs = val || [];
    this._render();
  }

  set selectedLegId(val) {
    this._selectedLegId = val;
    this._highlightSelected();
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 320px; }
        #map  { width: 100%; height: 100%; border-radius: 12px; overflow: hidden; }
      </style>
      <div id="map"></div>
    `;
    this._initMap();
  }

  async _initMap() {
    loadCSS(LEAFLET_CSS);
    await loadScript(LEAFLET_JS);
    const L = window.L;
    const container = this.shadowRoot.getElementById("map");
    this._map = L.map(container, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(this._map);
    this._render();
  }

  _render() {
    if (!this._map) return;
    const L = window.L;

    // Clear existing layers
    this._layers.forEach(l => l.remove());
    this._layers = [];

    const legs = this._legs;
    if (!legs.length) return;

    // Collect unique city coords
    const cityMap = new Map(); // city key → {coords, legs[]}
    const points = [];

    legs.forEach(leg => {
      const origCoords = resolveCoords(leg.origin);
      const destCoords = resolveCoords(leg.destination);

      if (origCoords) {
        const key = leg.origin.toUpperCase();
        if (!cityMap.has(key)) cityMap.set(key, { coords: origCoords, legs: [] });
        cityMap.get(key).legs.push(leg);
        points.push([origCoords.lat, origCoords.lng]);
      }
      if (destCoords) {
        const key = leg.destination.toUpperCase();
        if (!cityMap.has(key)) cityMap.set(key, { coords: destCoords, legs: [] });
        cityMap.get(key).legs.push(leg);
        points.push([destCoords.lat, destCoords.lng]);
      }

      // Draw route line
      if (origCoords && destCoords) {
        const color = STATUS_COLORS[leg.status] || "#607D8B";
        let polyline;
        if (leg.type === "flight") {
          // Curved arc via midpoint
          const mid = arcMidpoint(origCoords, destCoords);
          polyline = L.polyline(
            [[origCoords.lat, origCoords.lng], [mid.lat, mid.lng], [destCoords.lat, destCoords.lng]],
            { color, weight: 2, dashArray: "6 4", opacity: 0.8 }
          );
        } else {
          polyline = L.polyline(
            [[origCoords.lat, origCoords.lng], [destCoords.lat, destCoords.lng]],
            { color, weight: 2, dashArray: "4 4", opacity: 0.7 }
          );
        }
        polyline.addTo(this._map);
        this._layers.push(polyline);
      }
    });

    // Draw city markers
    cityMap.forEach((cityData, key) => {
      const { coords, legs: cityLegs } = cityData;
      // Use the status of the most relevant leg for colour
      const relevantLeg = cityLegs.find(l => l.status === "active")
        || cityLegs.find(l => l.status === "upcoming")
        || cityLegs[0];
      const color = STATUS_COLORS[relevantLeg?.status] || "#607D8B";

      const icon = L.divIcon({
        className: "",
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([coords.lat, coords.lng], { icon });

      const firstLeg = cityLegs[0];
      const popupHtml = `
        <strong>${key}</strong><br>
        ${cityLegs.map(l => `
          <span style="color:${STATUS_COLORS[l.status]};font-size:11px">
            ${l.origin} → ${l.destination} (${l.type})<br>
            ${new Date(l.depart_at).toLocaleDateString()} — <em>${l.status}</em>
          </span>
        `).join("<br>")}
        <br><button class="ta-map-detail-btn" data-leg="${firstLeg.id}"
          style="margin-top:4px;padding:2px 8px;cursor:pointer;font-size:11px">
          Details →
        </button>
      `;
      marker.bindPopup(popupHtml);
      marker.on("popupopen", () => {
        // Attach click on detail button after popup DOM renders
        setTimeout(() => {
          const btn = document.querySelector(`.ta-map-detail-btn[data-leg="${firstLeg.id}"]`);
          if (btn) {
            btn.addEventListener("click", () => {
              this.dispatchEvent(new CustomEvent("leg-selected", { detail: firstLeg.id, bubbles: true, composed: true }));
            });
          }
        }, 50);
      });

      marker.addTo(this._map);
      this._layers.push(marker);
    });

    // Fit map to all points
    if (points.length) {
      this._map.fitBounds(points, { padding: [30, 30] });
    }
  }

  _highlightSelected() {
    // Future: pan to selected leg's origin marker
    if (!this._map || !this._selectedLegId) return;
    const leg = this._legs.find(l => l.id === this._selectedLegId);
    if (!leg) return;
    const coords = resolveCoords(leg.origin);
    if (coords) {
      this._map.panTo([coords.lat, coords.lng], { animate: true });
    }
  }
}

customElements.define("ta-map", TaMap);
