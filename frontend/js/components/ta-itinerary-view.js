import "./ta-map.js";
import "./ta-leg-card.js";
import { resolveCoords } from "../city-coords.js";

const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };
const TYPE_ICONS    = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaItineraryView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._legs = [];
    this._selectedId = null;
    this._aiProvider = "none";
  }

  set legs(v)        { this._legs = v || []; this._render(); }
  set aiProvider(v)  { this._aiProvider = v; this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;gap:20px}
      ta-map{display:none}
      .timeline{display:flex;flex-direction:column;gap:0;position:relative}
      .timeline::before{content:"";position:absolute;left:19px;top:24px;bottom:24px;width:2px;background:#e0e0e0;z-index:0}
      .node{display:flex;align-items:flex-start;gap:12px;padding:10px 0;cursor:pointer;position:relative}
      .dot{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);flex-shrink:0;margin-top:4px;z-index:1;transition:transform .15s}
      .node:hover .dot{transform:scale(1.3)}
      .node.selected .dot{transform:scale(1.4);box-shadow:0 2px 8px rgba(0,0,0,.3)}
      .info{flex:1;background:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 1px 4px rgba(0,0,0,.07);border:2px solid transparent;transition:border-color .15s}
      .node.selected .info{border-color:#03a9f4}
      .node:hover .info{border-color:#b3e5fc}
      .route{font-size:14px;font-weight:600;color:#222;display:flex;align-items:center;gap:6px}
      .type-icon{font-size:16px}
      .dates{font-size:11px;color:#888;margin-top:3px}
      .bottom-row{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
      .badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;color:#fff;white-space:nowrap}
      .carrier{font-size:11px;color:#666}
      .progress-mini{display:flex;align-items:center;gap:4px;font-size:10px;color:#888;margin-left:auto}
      .prog-bar{width:40px;height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden}
      .prog-fill{height:100%;background:#03a9f4;border-radius:2px}
      .leg-detail{margin-top:8px}
    </style>

    <ta-map id="map"></ta-map>

    <div class="timeline" id="timeline">
      ${this._legs.length === 0 ? `<div style="color:#aaa;text-align:center;padding:32px">No legs in this trip.</div>` :
        this._legs.map(l => this._nodeHtml(l)).join("")}
    </div>

    <div class="leg-detail" id="leg-detail"></div>`;

    // Wire up map
    const map = this.shadowRoot.getElementById("map");
    map.legs = this._legs;
    map.addEventListener("leg-selected", e => this._selectLeg(e.detail));

    // Wire up timeline nodes
    this.shadowRoot.querySelectorAll(".node").forEach(node => {
      node.addEventListener("click", () => this._selectLeg(node.dataset.id));
    });

    // Auto-select active leg or first leg
    if (!this._selectedId && this._legs.length) {
      const active = this._legs.find(l => l.status === "active") || this._legs[0];
      this._selectedId = active.id;
    }

    this._updateSelection();
  }

  _nodeHtml(l) {
    const color = STATUS_COLORS[l.status] || "#607D8B";
    const icon  = TYPE_ICONS[l.type] || "🧳";
    const items = l.checklist_items || [];
    const done  = items.filter(i => i.checked).length;
    const total = items.length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const sel   = l.id === this._selectedId;

    return `<div class="node${sel?" selected":""}" data-id="${l.id}">
      <div class="dot" style="background:${color}"></div>
      <div class="info">
        <div class="route">
          <span class="type-icon">${icon}</span>
          <span>${_esc(l.origin)} → ${_esc(l.destination)}</span>
        </div>
        <div class="dates">
          ${l.depart_at ? _fmtDate(l.depart_at) : ""}
          ${l.arrive_at ? ` → ${_fmtDate(l.arrive_at)}` : ""}
        </div>
        <div class="bottom-row">
          <span class="badge" style="background:${color}">${l.status}</span>
          ${l.carrier ? `<span class="carrier">${_esc(l.carrier)}${l.flight_number?" "+_esc(l.flight_number):""}</span>` : ""}
          ${total ? `<div class="progress-mini">
            <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
            <span>${done}/${total}</span>
          </div>` : ""}
        </div>
      </div>
    </div>`;
  }

  _selectLeg(id) {
    this._selectedId = id;
    this._updateSelection();

    // Pan map
    const map = this.shadowRoot.getElementById("map");
    if (map) map.selectedLegId = id;

    // Scroll node into view
    const node = this.shadowRoot.querySelector(`.node[data-id="${id}"]`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Mount leg card
    this._mountLegCard(id);

    this.dispatchEvent(new CustomEvent("leg-selected", { detail: id, bubbles: true, composed: true }));
  }

  _updateSelection() {
    this.shadowRoot.querySelectorAll(".node").forEach(n => {
      n.classList.toggle("selected", n.dataset.id === this._selectedId);
    });
  }

  _mountLegCard(id) {
    const leg = this._legs.find(l => l.id === id);
    const detail = this.shadowRoot.getElementById("leg-detail");
    if (!detail || !leg) return;
    detail.innerHTML = "";
    const card = document.createElement("ta-leg-card");
    detail.appendChild(card);
    card.aiProvider = this._aiProvider;
    card.leg = leg;
    card.addEventListener("leg-updated", e => {
      const idx = this._legs.findIndex(l => l.id === e.detail.id);
      if (idx >= 0) this._legs[idx] = e.detail;
      // Re-render timeline node without full re-render to preserve scroll
      const node = this.shadowRoot.querySelector(`.node[data-id="${e.detail.id}"] .info`);
      if (node) {
        const tmp = document.createElement("div");
        tmp.innerHTML = this._nodeHtml(e.detail);
        const newNode = tmp.querySelector(".info");
        if (newNode) node.replaceWith(newNode);
      }
      const map = this.shadowRoot.getElementById("map");
      if (map) map.legs = this._legs;
      this.dispatchEvent(new CustomEvent("leg-updated", { detail: e.detail, bubbles: true, composed: true }));
    });
    card.addEventListener("data-changed", () => {
      this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
    });
  }
}

function _esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function _fmtDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }); }
  catch { return iso; }
}

customElements.define("ta-itinerary-view", TaItineraryView);
