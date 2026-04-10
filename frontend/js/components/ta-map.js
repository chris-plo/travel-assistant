import { resolveCoords } from "../city-coords.js";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.L) { res(); return; }
    let s = document.querySelector(`script[src="${src}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = src;
      document.head.appendChild(s);
    }
    s.addEventListener("load", res, { once: true });
    s.addEventListener("error", rej, { once: true });
    if (window.L) res();
  });
}
function arcMid(a, b) {
  const dist = Math.sqrt((b.lat-a.lat)**2+(b.lng-a.lng)**2)||1;
  return { lat:(a.lat+b.lat)/2 - (b.lng-a.lng)/dist*dist*0.15,
           lng:(a.lng+b.lng)/2 + (b.lat-a.lat)/dist*dist*0.15 };
}

function hotelIcon(L, completed) {
  const bg = completed ? "#9E9E9E" : "#FF9800";
  const opacity = completed ? "opacity:.5;" : "";
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:6px;background:${bg};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;${opacity}">🏨</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function legDotIcon(L, color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function userLocationIcon(L) {
  return L.divIcon({
    className: "",
    html: `<div class="ta-user-dot"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

class TaMap extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:"open"});
    this._legs  = [];
    this._stays = [];
    this._map   = null;
    this._layers = [];
    this._locationMarker = null;
    this._locationInterval = null;
  }

  set legs(v)  { this._legs  = v||[]; this._renderMap().catch(()=>{}); }
  set stays(v) { this._stays = v||[]; this._renderMap().catch(()=>{}); }

  set selectedLegId(v) {
    const leg = this._legs.find(l=>l.id===v);
    if (leg && this._map) {
      resolveCoords(leg.origin).then(c => {
        if (c) this._map.panTo([c.lat,c.lng],{animate:true});
      });
    }
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="${LEAFLET_CSS}">
      <style>
        :host{display:block;width:100%;height:320px}
        #map{width:100%;height:100%;border-radius:12px;overflow:hidden}
        .ta-user-dot{
          width:16px;height:16px;border-radius:50%;
          background:#2563eb;border:3px solid #fff;
          box-shadow:0 0 0 2px rgba(37,99,235,.8);
          animation:ta-pulse 2s infinite;
        }
        @keyframes ta-pulse{
          0%,100%{box-shadow:0 0 0 2px rgba(37,99,235,.8)}
          50%{box-shadow:0 0 0 8px rgba(37,99,235,0)}
        }
      </style>
      <div id="map"></div>`;
    this._init();
  }

  disconnectedCallback() {
    clearInterval(this._locationInterval);
    this._locationInterval = null;
  }

  async _init() {
    await loadScript(LEAFLET_JS);
    const L = window.L;
    this._map = L.map(this.shadowRoot.getElementById("map"),{zoomControl:true,attributionControl:true});
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains:"abcd", maxZoom:19
    }).addTo(this._map);
    requestAnimationFrame(() => this._map.invalidateSize());
    this._renderMap().catch(()=>{});
    // Start polling for user location
    this._fetchLocation();
    this._locationInterval = setInterval(() => this._fetchLocation(), 60_000);
  }

  async _fetchLocation() {
    try {
      const r = await fetch("./api/location");
      if (!r.ok) {
        console.warn("[ta-map] location fetch failed: HTTP", r.status);
        return;
      }
      const d = await r.json();
      if (!d.lat) {
        console.debug("[ta-map] location endpoint returned no coordinates (entity not configured or missing GPS attributes)");
        return;
      }
      if (!this._map) {
        console.debug("[ta-map] location: map not ready yet");
        return;
      }
      console.debug("[ta-map] location:", d.friendly_name, d.lat, d.lng);
      const L = window.L;
      if (this._locationMarker) {
        this._locationMarker.setLatLng([d.lat, d.lng]);
      } else {
        this._locationMarker = L.marker([d.lat, d.lng], {
          icon: userLocationIcon(L),
          zIndexOffset: 1000,
        })
          .bindPopup(`<div style="font-size:13px">📍 <strong>${d.friendly_name || "You"}</strong></div>`)
          .addTo(this._map);
      }
    } catch(e) {
      console.warn("[ta-map] location fetch error:", e);
    }
  }

  async _renderMap() {
    if (!this._map) return;
    const L = window.L;
    this._layers.forEach(l=>l.remove()); this._layers=[];

    const legs  = this._legs;
    const stays = this._stays;
    if (!legs.length && !stays.length) return;

    // Resolve all coords concurrently
    const [legPairs, stayCoords] = await Promise.all([
      Promise.all(legs.map(async leg => ({
        leg,
        oc: await resolveCoords(leg.origin),
        dc: await resolveCoords(leg.destination),
      }))),
      Promise.all(stays.map(async stay => ({
        stay,
        // Prefer full address for precision, fall back to location/city
        coords: await resolveCoords(stay.address) || await resolveCoords(stay.location),
      }))),
    ]);

    const points = [];

    // --- Leg polylines & city dots ---
    const cityMap = new Map();
    legPairs.forEach(({leg, oc, dc}) => {
      [[leg.origin, oc], [leg.destination, dc]].forEach(([name, c]) => {
        if (!c) return;
        const k = name.toUpperCase();
        if (!cityMap.has(k)) cityMap.set(k, {coords:c, legs:[]});
        cityMap.get(k).legs.push(leg);
        points.push([c.lat, c.lng]);
      });
      if (oc && dc) {
        const color   = STATUS_COLORS[leg.status]||"#607D8B";
        const faded   = leg.status === "completed" || leg.status === "cancelled";
        const opacity = faded ? 0.35 : (leg.type === "flight" ? 0.8 : 0.7);
        let poly;
        if (leg.type === "flight") {
          const m = arcMid(oc, dc);
          poly = L.polyline([[oc.lat,oc.lng],[m.lat,m.lng],[dc.lat,dc.lng]],{color,weight:2,dashArray:"6 4",opacity});
        } else {
          poly = L.polyline([[oc.lat,oc.lng],[dc.lat,dc.lng]],{color,weight:2,dashArray:"4 4",opacity});
        }
        poly.addTo(this._map); this._layers.push(poly);
      }
    });

    cityMap.forEach((data) => {
      const {coords, legs:cLegs} = data;
      const rl = cLegs.find(l=>l.status==="active")||cLegs.find(l=>l.status==="upcoming")||cLegs[0];
      const color = STATUS_COLORS[rl?.status]||"#607D8B";
      const marker = L.marker([coords.lat, coords.lng], {icon: legDotIcon(L, color)});
      marker.bindPopup(
        cLegs.map(l =>
          `<div style="font-size:12px;margin-bottom:4px">
            <strong>${l.origin} → ${l.destination}</strong>
            <span style="color:${STATUS_COLORS[l.status]||'#607D8B'};margin-left:4px">(${l.type})</span><br>
            <span style="color:#888">${new Date(l.depart_at).toLocaleDateString()}</span>
          </div>`
        ).join("")
      );
      marker.addTo(this._map); this._layers.push(marker);
    });

    // --- Stay hotel markers ---
    stayCoords.forEach(({stay, coords}) => {
      if (!coords) return;
      points.push([coords.lat, coords.lng]);
      const completed = stay.status === "completed" || stay.status === "cancelled";
      const marker = L.marker([coords.lat, coords.lng], {icon: hotelIcon(L, completed)});
      const checkin  = stay.check_in  ? new Date(stay.check_in).toLocaleDateString()  : "";
      const checkout = stay.check_out ? new Date(stay.check_out).toLocaleDateString() : "";
      const dateLine = checkin || checkout ? `<div style="color:#888;font-size:11px;margin-top:2px">${checkin}${checkin && checkout ? " – " : ""}${checkout}</div>` : "";
      const addrLine = stay.address ? `<div style="color:#666;font-size:11px;margin-top:2px">${stay.address}</div>` : "";
      marker.bindPopup(
        `<div style="font-size:13px"><strong>${stay.name}</strong>${addrLine}${dateLine}</div>`
      );
      marker.addTo(this._map); this._layers.push(marker);
    });

    if (points.length) this._map.fitBounds(points, {padding:[30,30]});
  }
}
customElements.define("ta-map", TaMap);
