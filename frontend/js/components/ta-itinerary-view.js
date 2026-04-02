import "./ta-map.js";
import "./ta-leg-card.js";
import "./ta-stay-card.js";
import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, fmtDate, fmtTime, fmtDuration, esc } from "../utils.js";

const TYPE_ICONS = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaItineraryView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._legs          = [];
    this._stays         = [];
    this._selectedId    = null;
    this._selectedType  = null;
    this._aiProvider    = "none";
    this._gcalEntity    = "";
    this._statusLegId   = null;
    this._statusData    = null;
    this._statusLoading = false;
    this._sheetOpen     = false;
  }

  set legs(v)       { this._legs  = v || []; this._render(); }
  set stays(v)      { this._stays = v || []; this._render(); }
  set aiProvider(v) { this._aiProvider = v; this._render(); }
  set gcalEntity(v) { this._gcalEntity = v; this._render(); }
  connectedCallback() { this._render(); }

  _items() {
    const legs = this._legs.map(l => ({ ...l, _type:"leg", _sortKey: l.depart_at }));
    // Stays are date-only — push sort key to end-of-day so same-day segments sort first
    const stays = this._stays.map(s => {
      let sortKey = s.check_in || null;
      if (sortKey) {
        const d = new Date(sortKey);
        if (!isNaN(d)) { d.setUTCHours(23, 59, 0, 0); sortKey = d.toISOString(); }
      }
      return { ...s, _type:"stay", _sortKey: sortKey };
    });
    return [...legs, ...stays].sort((a, b) => {
      if (!a._sortKey && !b._sortKey) return 0;
      if (!a._sortKey) return 1;
      if (!b._sortKey) return -1;
      return new Date(a._sortKey) - new Date(b._sortKey);
    });
  }

  _render() {
    const items = this._items();

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
      /* Info card */
      .info{flex:1;background:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 1px 4px rgba(0,0,0,.07);border:2px solid transparent;transition:border-color .15s}
      .node[data-type="leg"] .info{border-left:3px solid #e3f2fd}
      .node[data-type="stay"] .info{border-left:3px solid #fff3e0}
      .node[data-type="leg"].selected .info,.node[data-type="leg"]:hover .info{border-color:#03a9f4}
      .node[data-type="stay"].selected .info,.node[data-type="stay"]:hover .info{border-color:#FF9800}
      /* Compact info (completed) */
      .info-compact{flex:1;background:#f7f7f7;border-radius:8px;padding:8px 12px;box-shadow:none;border:1px solid #eee;opacity:.75;display:flex;align-items:center;gap:8px;font-size:13px;color:#666;transition:opacity .15s}
      .node:hover .info-compact{opacity:1;border-color:#ccc}
      .node.selected .info-compact{opacity:1;border-color:#03a9f4;background:#f0f9ff}
      /* Two-column layout inside info card */
      .info-cols{display:flex;gap:8px;align-items:flex-start}
      .info-left{flex:1;min-width:0}
      .info-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;max-width:45%}
      .route{font-size:14px;font-weight:600;color:#222;display:flex;align-items:center;gap:6px}
      .type-icon{font-size:16px}
      .dates{font-size:11px;color:#888;margin-top:3px}
      .duration{font-size:11px;color:#03a9f4;font-weight:500}
      .badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;color:#fff;white-space:nowrap}
      .carrier{font-size:11px;color:#666;text-align:right}
      .status-btn-inline{padding:3px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:11px;cursor:pointer;color:#555;white-space:nowrap;margin-top:2px}
      .status-btn-inline:hover{background:#f5f5f5}
      .progress-row{display:flex;align-items:center;gap:4px;font-size:10px;color:#888;margin-top:6px}
      .prog-bar{width:40px;height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden}
      .prog-fill{height:100%;background:#03a9f4;border-radius:2px}
      .layover{display:flex;align-items:center;gap:6px;padding:2px 0 2px 33px;font-size:11px;color:#999}
      .layover.tight{color:#f44336;font-weight:600}
      .item-detail{margin-top:8px}
      .empty{color:#aaa;text-align:center;padding:32px}
      /* Flight status overlay */
      .status-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:500}
      .status-sheet{position:fixed;left:0;right:0;bottom:0;z-index:501;background:#fff;border-radius:20px 20px 0 0;padding:20px;max-height:60vh;overflow-y:auto;animation:slideUp .2s ease}
      @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      .status-sheet-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
      .status-sheet-title{font-size:16px;font-weight:700;color:#222}
      .status-close-btn{background:none;border:none;font-size:22px;cursor:pointer;color:#aaa}
      .fs-grid{display:flex;flex-wrap:wrap;gap:16px}
      .fs-item{display:flex;flex-direction:column;gap:2px;min-width:80px}
      .fs-label{color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
      .fs-val{font-weight:600;color:#222;font-size:14px}
      .fs-delay{color:#f44336}
      .spinner{display:inline-block;width:22px;height:22px;border:2px solid #e0e0e0;border-top-color:#03a9f4;border-radius:50%;animation:spin .6s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
      /* Mobile bottom sheet */
      .detail-sheet{display:none}
      @media(max-width:640px){
        .item-detail{display:none}
        .detail-sheet{
          display:block;position:fixed;left:0;right:0;bottom:0;z-index:200;
          background:#fff;border-radius:20px 20px 0 0;
          box-shadow:0 -4px 24px rgba(0,0,0,.18);
          max-height:65vh;overflow-y:auto;
          transform:translateY(100%);transition:transform .28s ease;
          flex-direction:column
        }
        .detail-sheet.open{transform:translateY(0)}
        .sheet-hdr{display:flex;align-items:center;padding:10px 16px 4px;position:sticky;top:0;background:#fff;z-index:1;border-bottom:1px solid #f0f0f0}
        .sheet-drag{width:36px;height:4px;background:#ddd;border-radius:2px;margin:0 auto 0}
        .sheet-title{flex:1;font-size:13px;font-weight:600;color:#555;padding-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .sheet-close-btn{background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;padding:4px 8px;line-height:1}
        .sheet-body{padding:0 0 env(safe-area-inset-bottom,0)}
      }
    </style>

    <ta-map id="map"></ta-map>

    <div class="timeline" id="timeline">
      ${items.length === 0
        ? `<div class="empty">No segments or stays yet. Use the + button to add one.</div>`
        : items.map((item, idx) => {
            const prev = items[idx - 1];
            const layover = (idx > 0 && prev._type === "leg" && item._type === "leg" && prev.arrive_at && item.depart_at)
              ? this._layoverHtml(prev.arrive_at, item.depart_at) : "";
            return layover + (item._type === "stay" ? this._stayNodeHtml(item) : this._legNodeHtml(item));
          }).join("")}
    </div>

    ${(this._statusData !== null || this._statusLoading) ? `
      <div class="status-backdrop" id="status-backdrop"></div>
      <div class="status-sheet">
        <div class="status-sheet-hdr">
          <span class="status-sheet-title">✈️ Flight Status</span>
          <button class="status-close-btn" id="status-close">✕</button>
        </div>
        ${this._statusLoading
          ? `<div style="text-align:center;padding:32px"><span class="spinner"></span></div>`
          : this._flightStatusHtml(this._statusData)}
      </div>
    ` : ""}

    <div class="detail-sheet${this._sheetOpen ? " open" : ""}" id="detail-sheet">
      <div class="sheet-hdr">
        <div class="sheet-drag"></div>
        <span class="sheet-title" id="sheet-title"></span>
        <button class="sheet-close-btn" id="sheet-close">✕</button>
      </div>
      <div class="sheet-body" id="sheet-body"></div>
    </div>

    <div class="item-detail" id="item-detail"></div>`;

    const map = this.shadowRoot.getElementById("map");
    map.legs = this._legs;

    this.shadowRoot.querySelectorAll(".node").forEach(node => {
      node.addEventListener("click", () => this._selectItem(node.dataset.id, node.dataset.type));
    });

    this.shadowRoot.querySelectorAll(".status-btn-inline").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        this._fetchStatus(btn.dataset.legId);
      });
    });

    const closeStatus = this.shadowRoot.getElementById("status-close");
    if (closeStatus) closeStatus.addEventListener("click", () => this._closeStatus());
    const statusBackdrop = this.shadowRoot.getElementById("status-backdrop");
    if (statusBackdrop) statusBackdrop.addEventListener("click", () => this._closeStatus());

    const sheetClose = this.shadowRoot.getElementById("sheet-close");
    if (sheetClose) sheetClose.addEventListener("click", () => this._closeSheet());

    if (!this._selectedId && items.length) {
      const active   = items.find(i => computeStatus(i._type==="leg"?i.depart_at:i.check_in, i._type==="leg"?i.arrive_at:i.check_out) === "active");
      const upcoming = items.find(i => computeStatus(i._type==="leg"?i.depart_at:i.check_in, i._type==="leg"?i.arrive_at:i.check_out) === "upcoming");
      const pick = active || upcoming || items[0];
      this._selectedId   = pick.id;
      this._selectedType = pick._type;
    }

    this._updateSelection();
    if (this._selectedId) this._mountDetail(this._selectedId, this._selectedType);
  }

  _legNodeHtml(l) {
    const status = computeStatus(l.depart_at, l.arrive_at);
    const dotColor = status === "completed" ? (STATUS_COLORS[status] || "#9E9E9E") : "#03a9f4";
    const badgeColor = STATUS_COLORS[status] || "#03a9f4";
    const icon   = TYPE_ICONS[l.type] || "🧳";
    const sel    = l.id === this._selectedId;
    const items  = l.checklist_items || [];
    const done   = items.filter(i => i.checked).length;
    const total  = items.length;
    const pct    = total ? Math.round(done / total * 100) : 0;

    if (status === "completed") {
      return `<div class="node${sel?" selected":""}" data-id="${l.id}" data-type="leg">
        <div class="dot" style="background:${dotColor}"></div>
        <div class="info-compact">
          <span>${icon}</span>
          <span>${esc(l.origin)} → ${esc(l.destination)}</span>
          <span class="badge" style="background:${badgeColor};margin-left:4px">Completed</span>
          ${l.depart_at ? `<span style="margin-left:auto;font-size:10px">${fmtDate(l.depart_at, l.depart_timezone)}</span>` : ""}
        </div>
      </div>`;
    }

    const depDate = l.depart_at ? fmtDate(l.depart_at, l.depart_timezone) : "";
    const depTime = l.depart_at ? fmtTime(l.depart_at, l.depart_timezone) : "";
    const arrTime = l.arrive_at ? fmtTime(l.arrive_at, l.arrive_timezone) : "";
    const dur     = fmtDuration(l.depart_at, l.arrive_at);
    const timeStr = depTime
      ? `${depTime}${arrTime ? ` → ${arrTime}` : ""}${dur ? ` · <span class="duration">${dur}</span>` : ""}`
      : "";
    const datesContent = [depDate, timeStr].filter(Boolean).join(" · ");

    const hasStatusBtn = l.type === "flight" && l.flight_number;

    return `<div class="node${sel?" selected":""}" data-id="${l.id}" data-type="leg">
      <div class="dot" style="background:${dotColor}"></div>
      <div class="info">
        <div class="info-cols">
          <div class="info-left">
            <div class="route"><span class="type-icon">${icon}</span><span>${esc(l.origin)} → ${esc(l.destination)}</span></div>
            <div class="dates">${datesContent}</div>
          </div>
          <div class="info-right">
            <span class="badge" style="background:${badgeColor}">${status}</span>
            ${l.carrier ? `<span class="carrier">${esc(l.carrier)}${l.flight_number?" "+esc(l.flight_number):""}</span>` : ""}
            ${hasStatusBtn ? `<button class="status-btn-inline" data-leg-id="${l.id}">🔄 Status</button>` : ""}
          </div>
        </div>
        ${total ? `<div class="progress-row"><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div><span>${done}/${total}</span></div>` : ""}
      </div>
    </div>`;
  }

  _stayNodeHtml(s) {
    const status   = computeStatus(s.check_in, s.check_out);
    const dotColor = status === "completed" ? (STATUS_COLORS[status] || "#9E9E9E") : "#FF9800";
    const badgeColor = STATUS_COLORS[status] || "#FF9800";
    const sel    = s.id === this._selectedId;
    const items  = s.checklist_items || [];
    const done   = items.filter(i => i.checked).length;
    const total  = items.length;
    const pct    = total ? Math.round(done / total * 100) : 0;

    if (status === "completed") {
      return `<div class="node${sel?" selected":""}" data-id="${s.id}" data-type="stay">
        <div class="dot" style="background:${dotColor}"></div>
        <div class="info-compact">
          <span>🏨</span>
          <span>${esc(s.name)}${s.location?` · ${esc(s.location)}`:""}</span>
          <span class="badge" style="background:${badgeColor};margin-left:4px">Completed</span>
          ${s.check_in ? `<span style="margin-left:auto;font-size:10px">${fmtDate(s.check_in, s.timezone)}</span>` : ""}
        </div>
      </div>`;
    }

    const inDate  = s.check_in  ? fmtDate(s.check_in,  s.timezone) : "";
    const outDate = s.check_out ? fmtDate(s.check_out, s.timezone) : "";
    const dateRange = inDate && outDate ? `${inDate} – ${outDate}` : inDate || outDate;

    return `<div class="node${sel?" selected":""}" data-id="${s.id}" data-type="stay">
      <div class="dot" style="background:${dotColor}"></div>
      <div class="info">
        <div class="info-cols">
          <div class="info-left">
            <div class="route"><span class="type-icon">🏨</span><span>${esc(s.name)}</span></div>
            <div class="dates">${s.location ? `📍 ${esc(s.location)}` : ""}${dateRange ? (s.location ? ` · ${dateRange}` : dateRange) : ""}</div>
          </div>
          <div class="info-right">
            <span class="badge" style="background:${badgeColor}">${status}</span>
            ${s.confirmation_number ? `<span class="carrier">🔖 ${esc(s.confirmation_number)}</span>` : ""}
          </div>
        </div>
        ${total ? `<div class="progress-row"><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div><span>${done}/${total}</span></div>` : ""}
      </div>
    </div>`;
  }

  _layoverHtml(arriveIso, departIso) {
    const mins = Math.round((new Date(departIso) - new Date(arriveIso)) / 60000);
    if (mins <= 0) return "";
    const h = Math.floor(mins / 60), m = mins % 60;
    const label = h > 0 ? `${h}h ${m > 0 ? m + "m " : ""}layover` : `${m}m layover`;
    const tight = mins < 60;
    return `<div class="layover${tight ? " tight" : ""}">${tight ? "⚠️" : "⏱"} ${label}</div>`;
  }

  _flightStatusHtml(fs) {
    if (!fs) return `<div style="color:#aaa;text-align:center">No status data.</div>`;
    if (fs.error) return `<div style="color:#f44336">⚠️ ${esc(fs.error)}</div>`;
    const rows = [
      fs.flight_status      ? { l:"Status",       v: fs.flight_status }                      : null,
      fs.departure_gate     ? { l:"Gate",          v: fs.departure_gate }                     : null,
      fs.departure_terminal ? { l:"Terminal",      v: fs.departure_terminal }                 : null,
      fs.arrival_gate       ? { l:"Arr. Gate",     v: fs.arrival_gate }                       : null,
      fs.departure_delay    ? { l:"Dep. Delay",    v: `+${fs.departure_delay}m`, cls:"delay" } : null,
      fs.arrival_delay      ? { l:"Arr. Delay",    v: `+${fs.arrival_delay}m`,   cls:"delay" } : null,
    ].filter(Boolean);
    if (!rows.length) return `<div style="color:#aaa">No live status data available.</div>`;
    return `<div class="fs-grid">${rows.map(r =>
      `<div class="fs-item"><span class="fs-label">${r.l}</span><span class="fs-val${r.cls?" fs-"+r.cls:""}">${esc(String(r.v))}</span></div>`
    ).join("")}</div>`;
  }

  async _fetchStatus(legId) {
    this._statusLegId   = legId;
    this._statusData    = null;
    this._statusLoading = true;
    this._render();
    try {
      this._statusData = await api.getFlightStatus(legId);
    } catch(e) {
      this._statusData = { error: e.message };
    } finally {
      this._statusLoading = false;
      this._render();
    }
  }

  _closeSheet() {
    this._sheetOpen = false;
    const sheet = this.shadowRoot.getElementById("detail-sheet");
    if (sheet) sheet.classList.remove("open");
    const body = this.shadowRoot.getElementById("sheet-body");
    if (body) body.innerHTML = "";
  }

  _closeStatus() {
    this._statusData    = null;
    this._statusLegId   = null;
    this._statusLoading = false;
    this._render();
  }

  _selectItem(id, type) {
    this._selectedId   = id;
    this._selectedType = type;
    this._updateSelection();
    if (window.innerWidth <= 640) {
      // Mobile: open bottom sheet; keep timeline visible
      this._sheetOpen = true;
      this._mountDetail(id, type);
      // Update sheet title
      const titleEl = this.shadowRoot.getElementById("sheet-title");
      if (titleEl) {
        const item = type === "stay"
          ? this._stays.find(s => s.id === id)
          : this._legs.find(l => l.id === id);
        titleEl.textContent = item
          ? (type === "stay" ? item.name : `${item.origin} → ${item.destination}`)
          : "";
      }
      // Animate open
      const sheet = this.shadowRoot.getElementById("detail-sheet");
      if (sheet) sheet.classList.add("open");
    } else {
      const node = this.shadowRoot.querySelector(`.node[data-id="${id}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "nearest" });
      this._mountDetail(id, type);
    }
    this.dispatchEvent(new CustomEvent("item-selected", { detail: { id, type }, bubbles: true, composed: true }));
    this.dispatchEvent(new CustomEvent("leg-selected", { detail: id, bubbles: true, composed: true }));
  }

  _updateSelection() {
    this.shadowRoot.querySelectorAll(".node").forEach(n => {
      n.classList.toggle("selected", n.dataset.id === this._selectedId);
    });
  }

  _mountDetail(id, type) {
    const isMobile = window.innerWidth <= 640;
    const detail = this.shadowRoot.getElementById(isMobile ? "sheet-body" : "item-detail");
    if (!detail) return;
    detail.innerHTML = "";

    if (type === "stay") {
      const stay = this._stays.find(s => s.id === id);
      if (!stay) return;
      const card = document.createElement("ta-stay-card");
      detail.appendChild(card);
      card.gcalEntity = this._gcalEntity;
      card.stay = stay;
      card.addEventListener("stay-updated", e => {
        const idx = this._stays.findIndex(s => s.id === e.detail.id);
        if (idx >= 0) this._stays[idx] = e.detail;
        this._refreshNode(e.detail.id);
        this.dispatchEvent(new CustomEvent("stay-updated", { detail: e.detail, bubbles: true, composed: true }));
      });
    } else {
      const leg = this._legs.find(l => l.id === id);
      if (!leg) return;
      const card = document.createElement("ta-leg-card");
      detail.appendChild(card);
      card.gcalEntity = this._gcalEntity;
      card.leg = leg;
      card.addEventListener("leg-updated", e => {
        const idx = this._legs.findIndex(l => l.id === e.detail.id);
        if (idx >= 0) this._legs[idx] = e.detail;
        this._refreshNode(e.detail.id);
        const map = this.shadowRoot.getElementById("map");
        if (map) map.legs = this._legs;
        this.dispatchEvent(new CustomEvent("leg-updated", { detail: e.detail, bubbles: true, composed: true }));
      });
      card.addEventListener("data-changed", () => {
        this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
      });
    }
  }

  _refreshNode(id) {
    const items = this._items();
    const item  = items.find(i => i.id === id);
    if (!item) return;
    const node = this.shadowRoot.querySelector(`.node[data-id="${id}"] .info, .node[data-id="${id}"] .info-compact`);
    if (!node) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = item._type === "stay" ? this._stayNodeHtml(item) : this._legNodeHtml(item);
    const newInfo = tmp.querySelector(".info, .info-compact");
    if (newInfo) node.replaceWith(newInfo);
  }
}

customElements.define("ta-itinerary-view", TaItineraryView);
