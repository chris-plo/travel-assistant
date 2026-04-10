import { resolveCoords } from "../city-coords.js";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };

/** True when a leg should be displayed as visually "done" — either explicitly completed/cancelled,
 *  or the departure time has already passed (regardless of stored status). */
function isLegDone(leg) {
  if (leg.status === "completed" || leg.status === "cancelled") return true;
  if (leg.depart_at && new Date(leg.depart_at) < Date.now()) return true;
  return false;
}

/** True when a stay should be displayed as visually "done". */
function isStayDone(stay) {
  if (stay.status === "completed" || stay.status === "cancelled") return true;
  if (stay.check_out && new Date(stay.check_out) < Date.now()) return true;
  return false;
}

function legColor(leg) {
  if (isLegDone(leg)) return STATUS_COLORS.completed;
  return STATUS_COLORS[leg.status] || "#607D8B";
}

/**
 * Compute the "current window" of legs/stays to focus the map on.
 * Returns { legIds: Set, stayIds: Set } of the IDs that should be in focus, or
 * null when everything is past (fall back to showing all).
 *
 * Window = first active-or-upcoming item up to (and including) the next stay.
 * If no stay remains, the window covers all remaining upcoming items.
 */
function _computeFocusWindow(legs, stays) {
  const now = Date.now();
  const allItems = [
    ...legs.map(l => ({
      id: l.id, type: "leg",
      ms:    l.depart_at ? new Date(l.depart_at).getTime() : Infinity,
      endMs: l.arrive_at ? new Date(l.arrive_at).getTime() : null,
    })),
    ...stays.map(s => ({
      id: s.id, type: "stay",
      ms:    s.check_in  ? new Date(s.check_in).getTime()  : Infinity,
      endMs: s.check_out ? new Date(s.check_out).getTime() : null,
    })),
  ].sort((a, b) => a.ms - b.ms);

  // First item that is active (now between start and end) or upcoming (start > now)
  const firstIdx = allItems.findIndex(item => {
    if (item.ms <= now && (!item.endMs || now <= item.endMs)) return true; // active
    if (item.ms > now) return true;                                         // upcoming
    return false;
  });
  if (firstIdx === -1) return null; // all past → show everything

  // Next STAY from firstIdx onward (inclusive)
  const nextStayIdx = allItems.findIndex((item, i) => i >= firstIdx && item.type === "stay");
  const endIdx = nextStayIdx !== -1 ? nextStayIdx : allItems.length - 1;

  const focusItems = allItems.slice(firstIdx, endIdx + 1);
  return {
    legIds:  new Set(focusItems.filter(i => i.type === "leg").map(i => i.id)),
    stayIds: new Set(focusItems.filter(i => i.type === "stay").map(i => i.id)),
  };
}

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
    this._locationMarker  = null;
    this._locationInterval = null;
    this._lastAllPoints   = [];
    this._lastFocusPoints = [];
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

  /** Fit the map viewport. focusPoints is the "current window"; falls back to allPoints.
   *  Always includes the user GPS marker if present. Stores points for re-use on first GPS fix. */
  _fitViewport(allPoints, focusPoints) {
    if (!this._map) return;
    const fp = [...focusPoints];
    if (this._locationMarker) {
      const ll = this._locationMarker.getLatLng();
      fp.push([ll.lat, ll.lng]);
    }
    const pts = fp.length ? fp : allPoints;
    if (pts.length) this._map.fitBounds(pts, { padding: [40, 40] });
    // Store so _fetchLocation can re-fit when the first GPS fix arrives
    this._lastAllPoints   = allPoints;
    this._lastFocusPoints = focusPoints;
  }

  async _fetchLocation() {
    const wasFirst = !this._locationMarker;
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
      // On the very first GPS fix, re-fit the viewport to include user position
      if (wasFirst && this._lastAllPoints.length) {
        this._fitViewport(this._lastAllPoints, this._lastFocusPoints);
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

    const allPoints   = [];
    const focusPoints = [];
    const focus = _computeFocusWindow(legs, stays);

    // --- Leg polylines & city dots ---
    const cityMap = new Map();
    legPairs.forEach(({leg, oc, dc}) => {
      [[leg.origin, oc], [leg.destination, dc]].forEach(([name, c]) => {
        if (!c) return;
        const k = name.toUpperCase();
        if (!cityMap.has(k)) cityMap.set(k, {coords:c, legs:[]});
        cityMap.get(k).legs.push(leg);
        allPoints.push([c.lat, c.lng]);
        if (!focus || focus.legIds.has(leg.id)) focusPoints.push([c.lat, c.lng]);
      });
      if (oc && dc) {
        const done    = isLegDone(leg);
        const color   = legColor(leg);
        const opacity = done ? 0.35 : (leg.type === "flight" ? 0.8 : 0.7);
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
      // Pick the most "alive" leg to colour the city dot: active > upcoming-future > anything
      const rl = cLegs.find(l=>l.status==="active")
              || cLegs.find(l=>!isLegDone(l))
              || cLegs[0];
      const color = legColor(rl);
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
      allPoints.push([coords.lat, coords.lng]);
      if (!focus || focus.stayIds.has(stay.id)) focusPoints.push([coords.lat, coords.lng]);
      const marker = L.marker([coords.lat, coords.lng], {icon: hotelIcon(L, isStayDone(stay))});
      const checkin  = stay.check_in  ? new Date(stay.check_in).toLocaleDateString()  : "";
      const checkout = stay.check_out ? new Date(stay.check_out).toLocaleDateString() : "";
      const dateLine = checkin || checkout ? `<div style="color:#888;font-size:11px;margin-top:2px">${checkin}${checkin && checkout ? " – " : ""}${checkout}</div>` : "";
      const addrLine = stay.address ? `<div style="color:#666;font-size:11px;margin-top:2px">${stay.address}</div>` : "";
      marker.bindPopup(
        `<div style="font-size:13px"><strong>${stay.name}</strong>${addrLine}${dateLine}</div>`
      );
      marker.addTo(this._map); this._layers.push(marker);
    });

    this._fitViewport(allPoints, focusPoints);
  }
}
customElements.define("ta-map", TaMap);
