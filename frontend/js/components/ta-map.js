import { resolveCoords } from "../city-coords.js";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}
function loadCSS(href) {
  if (!document.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement("link"); l.rel="stylesheet"; l.href=href;
    document.head.appendChild(l);
  }
}
function arcMid(a, b) {
  const dist = Math.sqrt((b.lat-a.lat)**2+(b.lng-a.lng)**2)||1;
  return { lat:(a.lat+b.lat)/2 - (b.lng-a.lng)/dist*dist*0.15,
           lng:(a.lng+b.lng)/2 + (b.lat-a.lat)/dist*dist*0.15 };
}

class TaMap extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); this._legs=[]; this._map=null; this._layers=[]; }

  set legs(v) { this._legs=v||[]; this._renderMap(); }
  set selectedLegId(v) {
    const leg = this._legs.find(l=>l.id===v);
    if (leg && this._map) {
      const c = resolveCoords(leg.origin);
      if (c) this._map.panTo([c.lat,c.lng],{animate:true});
    }
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="${LEAFLET_CSS}">
      <style>:host{display:block;width:100%;height:320px}#map{width:100%;height:100%;border-radius:12px;overflow:hidden}</style>
      <div id="map"></div>`;
    this._init();
  }

  async _init() {
    await loadScript(LEAFLET_JS);
    const L = window.L;
    this._map = L.map(this.shadowRoot.getElementById("map"),{zoomControl:true,attributionControl:true});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(this._map);
    // Force Leaflet to recalculate container size after DOM settles
    requestAnimationFrame(() => this._map.invalidateSize());
    this._renderMap();
  }

  _renderMap() {
    if (!this._map) return;
    const L = window.L;
    this._layers.forEach(l=>l.remove()); this._layers=[];
    const legs=this._legs; if(!legs.length) return;
    const cityMap=new Map(); const points=[];

    legs.forEach(leg=>{
      const oc=resolveCoords(leg.origin), dc=resolveCoords(leg.destination);
      [["origin",oc,leg],["destination",dc,leg]].forEach(([,c,l])=>{
        if(!c)return;
        const k=(l===leg?(leg.origin):(leg.destination)).toUpperCase();
        if(!cityMap.has(k)) cityMap.set(k,{coords:c,legs:[]});
        cityMap.get(k).legs.push(leg);
        points.push([c.lat,c.lng]);
      });
      if(oc&&dc){
        const color=STATUS_COLORS[leg.status]||"#607D8B";
        let poly;
        if(leg.type==="flight"){
          const m=arcMid(oc,dc);
          poly=L.polyline([[oc.lat,oc.lng],[m.lat,m.lng],[dc.lat,dc.lng]],{color,weight:2,dashArray:"6 4",opacity:.8});
        } else {
          poly=L.polyline([[oc.lat,oc.lng],[dc.lat,dc.lng]],{color,weight:2,dashArray:"4 4",opacity:.7});
        }
        poly.addTo(this._map); this._layers.push(poly);
      }
    });

    cityMap.forEach((data,key)=>{
      const {coords,legs:cLegs}=data;
      const rl=cLegs.find(l=>l.status==="active")||cLegs.find(l=>l.status==="upcoming")||cLegs[0];
      const color=STATUS_COLORS[rl?.status]||"#607D8B";
      const icon=L.divIcon({className:"",html:`<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
      const marker=L.marker([coords.lat,coords.lng],{icon});
      const fl=cLegs[0];
      marker.bindPopup(`<strong>${key}</strong><br>${cLegs.map(l=>`<span style="color:${STATUS_COLORS[l.status]||'#607D8B'};font-size:11px">${l.origin}→${l.destination} (${l.type})<br>${new Date(l.depart_at).toLocaleDateString()}</span>`).join("<br>")}<br><button data-leg="${fl.id}" style="margin-top:4px;padding:2px 8px;cursor:pointer;font-size:11px">Details →</button>`);
      marker.on("popupopen",()=>{
        setTimeout(()=>{
          const btn=this.shadowRoot.querySelector(`button[data-leg="${fl.id}"]`);
          if(btn) btn.onclick=()=>this.dispatchEvent(new CustomEvent("leg-selected",{detail:fl.id,bubbles:true,composed:true}));
        },50);
      });
      marker.addTo(this._map); this._layers.push(marker);
    });

    if(points.length) this._map.fitBounds(points,{padding:[30,30]});
  }
}
customElements.define("ta-map",TaMap);
