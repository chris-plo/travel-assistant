/**
 * ta-itinerary-view — map + timeline combined itinerary view.
 *
 * Properties:
 *   trip      — full trip object with legs_detail
 *   token     — HA auth token
 *   aiEnabled — boolean
 * Events:
 *   leg-selected — detail: legId
 */
import "./ta-map.js";
import "./ta-leg-card.js";

const LEG_ICONS = {
  flight: "✈️", train: "🚆", bus: "🚌", drive: "🚗", ferry: "⛴️", other: "🧳",
};

const STATUS_COLORS = {
  upcoming:  "#2196F3",
  active:    "#4CAF50",
  completed: "#9E9E9E",
  cancelled: "#F44336",
};

class TaItineraryView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._trip        = null;
    this._token       = null;
    this._aiEnabled   = false;
    this._selectedId  = null;
  }

  set trip(val)      { this._trip = val; this._render(); }
  set token(val)     { this._token = val; }
  set aiEnabled(val) { this._aiEnabled = val; }

  connectedCallback() { this._render(); }

  _render() {
    const trip = this._trip;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .map-section { margin-bottom: 20px; border-radius: 12px; overflow: hidden; }
        .section-title {
          font-size: 11px; font-weight: 700; letter-spacing: .08em;
          text-transform: uppercase; color: var(--secondary-text-color,#888); margin: 0 0 10px;
        }
        .timeline { position: relative; padding-left: 28px; }
        .timeline::before {
          content: ""; position: absolute; left: 11px; top: 0; bottom: 0;
          width: 2px; background: var(--divider-color,#e0e0e0);
        }
        .leg-node {
          position: relative; margin-bottom: 12px; cursor: pointer;
          transition: opacity .15s;
        }
        .leg-node:hover { opacity: .85; }
        .leg-node::before {
          content: ""; position: absolute; left: -24px; top: 12px;
          width: 10px; height: 10px; border-radius: 50%;
          background: var(--node-color, #607D8B);
          border: 2px solid var(--card-background-color,#fff);
          box-shadow: 0 0 0 2px var(--node-color,#607D8B);
        }
        .leg-node.selected::before { box-shadow: 0 0 0 3px var(--node-color,#607D8B); }
        .leg-inner {
          background: var(--secondary-background-color,#f5f5f5);
          border-radius: 10px; padding: 10px 14px;
          display: flex; align-items: flex-start; gap: 10px;
        }
        .leg-node.selected .leg-inner {
          background: var(--card-background-color,#fff);
          box-shadow: 0 2px 10px rgba(0,0,0,.1);
        }
        .leg-type-icon { font-size: 20px; line-height: 1; padding-top: 2px; }
        .leg-details   { flex: 1; }
        .leg-route     { font-size: 14px; font-weight: 600; color: var(--primary-text-color,#222); }
        .leg-meta      { font-size: 11px; color: var(--secondary-text-color,#888); margin-top: 2px; }
        .leg-progress  { margin-top: 6px; }
        .prog-bar      { height: 4px; border-radius: 2px; background: var(--divider-color,#e0e0e0); }
        .prog-fill     { height: 100%; border-radius: 2px; }
        .prog-label    { font-size: 10px; color: var(--secondary-text-color,#999); margin-top: 2px; }
        .status-badge  {
          font-size: 10px; padding: 2px 8px; border-radius: 10px;
          color: #fff; white-space: nowrap; align-self: flex-start;
        }
        .detail-panel  { margin-top: 20px; }
      </style>
    `;

    if (!trip) {
      this.shadowRoot.innerHTML += `<div style="color:#999;padding:20px">No trip data.</div>`;
      return;
    }

    const legs = trip.legs_detail || [];

    // Map section
    const mapSection = document.createElement("div");
    mapSection.className = "map-section";
    const mapEl = document.createElement("ta-map");
    mapEl.legs = legs;
    mapEl.addEventListener("leg-selected", (e) => this._selectLeg(e.detail));
    mapSection.appendChild(mapEl);
    this.shadowRoot.appendChild(mapSection);

    // Timeline section
    const timelineLabel = document.createElement("p");
    timelineLabel.className = "section-title";
    timelineLabel.textContent = "Itinerary";
    this.shadowRoot.appendChild(timelineLabel);

    const timeline = document.createElement("div");
    timeline.className = "timeline";
    this.shadowRoot.appendChild(timeline);

    legs.forEach(leg => {
      const color    = STATUS_COLORS[leg.status] || "#607D8B";
      const icon     = LEG_ICONS[leg.type]  || "🧳";
      const items    = leg.checklist_items_detail || [];
      const total    = items.length;
      const done     = items.filter(i => i.checked).length;
      const pct      = total ? Math.round((done / total) * 100) : 0;
      const dateStr  = new Date(leg.depart_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const timeStr  = new Date(leg.depart_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const selected = this._selectedId === leg.id;

      const node = document.createElement("div");
      node.className = `leg-node${selected ? " selected" : ""}`;
      node.style.setProperty("--node-color", color);
      node.dataset.legId = leg.id;
      node.innerHTML = `
        <div class="leg-inner">
          <div class="leg-type-icon">${icon}</div>
          <div class="leg-details">
            <div class="leg-route">${_esc(leg.origin)} → ${_esc(leg.destination)}</div>
            <div class="leg-meta">
              ${dateStr} · ${timeStr}
              ${leg.carrier ? ` · ${_esc(leg.carrier)}` : ""}
              ${leg.flight_number ? ` ${_esc(leg.flight_number)}` : ""}
            </div>
            ${total > 0 ? `
              <div class="leg-progress">
                <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color}"></div></div>
                <div class="prog-label">${done}/${total} tasks</div>
              </div>
            ` : ""}
          </div>
          <span class="status-badge" style="background:${color}">${leg.status}</span>
        </div>
      `;
      node.addEventListener("click", () => this._selectLeg(leg.id));
      timeline.appendChild(node);
    });

    // Detail panel
    const detail = document.createElement("div");
    detail.className = "detail-panel";
    detail.id = "detail-panel";
    this.shadowRoot.appendChild(detail);

    if (this._selectedId) this._renderDetail(detail, legs);

    // Scroll selected node into view
    if (this._selectedId) {
      const el = timeline.querySelector(`[data-leg-id="${this._selectedId}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  _selectLeg(legId) {
    this._selectedId = legId;

    // Pan map
    const mapEl = this.shadowRoot.querySelector("ta-map");
    if (mapEl) mapEl.selectedLegId = legId;

    // Re-render highlighted node and detail
    this.shadowRoot.querySelectorAll(".leg-node").forEach(n => {
      n.classList.toggle("selected", n.dataset.legId === legId);
    });

    const legs   = this._trip?.legs_detail || [];
    const detail = this.shadowRoot.getElementById("detail-panel");
    if (detail) this._renderDetail(detail, legs);

    this.dispatchEvent(new CustomEvent("leg-selected", { detail: legId, bubbles: true, composed: true }));
  }

  _renderDetail(container, legs) {
    container.innerHTML = "";
    const leg = legs.find(l => l.id === this._selectedId);
    if (!leg) return;

    const card = document.createElement("ta-leg-card");
    card.token       = this._token;
    card.tripId      = this._trip?.id;
    card.aiEnabled   = this._aiEnabled;
    card.chatHistory = this._trip?.chat_history || [];
    card.leg         = leg;
    card.addEventListener("status-changed", () => {
      this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
    });
    card.addEventListener("data-changed", () => {
      this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
    });
    container.appendChild(card);
  }
}

function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("ta-itinerary-view", TaItineraryView);
