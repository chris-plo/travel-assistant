import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, STATUS_LABELS, fmtDt, esc, attachNotesSave } from "../utils.js";
import "./ta-tasks.js";
import "./ta-document-viewer.js";

function _countdown(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0 || diff > 7 * 24 * 3600 * 1000) return null;
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hrs  = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs  > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const TYPE_ICONS = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaLegCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._leg = null;
    this._tab = "tasks";
    this._flightStatus = null;
    this._flightStatusLoading = false;
    this._gcalEntity = "";
    this._gcalMsg = "";
    this._countdownTimer = null;
  }

  set leg(v)        { this._leg = v; this._flightStatus = null; this._render(); }
  set gcalEntity(v) { this._gcalEntity = v; this._render(); }
  connectedCallback() {
    this._render();
    this._countdownTimer = setInterval(() => {
      if (this._leg && computeStatus(this._leg.depart_at, this._leg.arrive_at) === "upcoming") this._render();
    }, 60000);
  }
  disconnectedCallback() { clearInterval(this._countdownTimer); }

  _render() {
    if (!this._leg) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a segment to view details</div>`;
      return;
    }
    const l      = this._leg;
    const status = computeStatus(l.depart_at, l.arrive_at);
    const color  = STATUS_COLORS[status] || "#607D8B";
    const icon   = TYPE_ICONS[l.type] || "🧳";
    const tabs   = ["tasks", "documents", "notes"];

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#f8f9ff,#fff)}
      .route{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .icon{font-size:24px}
      .arrow{color:#aaa;font-weight:300}
      .hdr-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
      .meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .edit-btn{margin-left:auto;padding:5px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .edit-btn:hover{background:#f5f5f5}
      .status-btn{padding:5px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .status-btn:hover{background:#f5f5f5}
      .gcal-btn{padding:5px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .gcal-btn:hover{background:#f5f5f5}
      .gcal-msg{font-size:11px;color:#4CAF50}
      .countdown{font-size:11px;font-weight:600;color:#03a9f4;background:#e3f2fd;padding:3px 8px;border-radius:10px}
      .flight-status-bar{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;padding:8px 12px;background:#f8f9ff;border-radius:8px;font-size:11px;color:#555;border-left:3px solid #03a9f4}
      .fs-item{display:flex;flex-direction:column;gap:1px}
      .fs-label{color:#aaa;font-size:10px;text-transform:uppercase}
      .fs-val{font-weight:600;color:#222}
      .fs-delay{color:#f44336;font-weight:700}
      .tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa}
      .tab{flex:1;padding:10px 0;border:none;background:none;font-size:12px;font-weight:500;cursor:pointer;color:#999;border-bottom:2px solid transparent;transition:all .15s}
      .tab.active{color:#03a9f4;border-bottom-color:#03a9f4;background:#fff}
      .tab:hover:not(.active){color:#555}
      .body{padding:16px;flex:1;overflow-y:auto}
      .notes-wrap{display:flex;flex-direction:column;gap:6px}
      textarea{width:100%;min-height:120px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5}
      .save-indicator{font-size:11px;color:#aaa;transition:opacity .3s}
      .save-indicator.saved{color:#4CAF50}
      .save-indicator.error{color:#f44336}
      .notes-hint{font-size:11px;color:#aaa}
    </style>
    <div class="hdr">
      <div class="route">
        <span class="icon">${icon}</span>
        <span>${esc(l.origin)}</span>
        <span class="arrow">→</span>
        <span>${esc(l.destination)}</span>
      </div>
      <div class="meta">
        ${l.depart_at ? `<div class="meta-item">🛫 ${fmtDt(l.depart_at, l.depart_timezone)}${l.depart_timezone ? ` <span style="color:#bbb">${esc(l.depart_timezone)}</span>` : ""}</div>` : ""}
        ${l.arrive_at ? `<div class="meta-item">🛬 ${fmtDt(l.arrive_at, l.arrive_timezone)}${l.arrive_timezone ? ` <span style="color:#bbb">${esc(l.arrive_timezone)}</span>` : ""}</div>` : ""}
        ${l.carrier      ? `<div class="meta-item">🏢 ${esc(l.carrier)}</div>` : ""}
        ${l.flight_number ? `<div class="meta-item">🔢 ${esc(l.flight_number)}</div>` : ""}
        ${l.seats        ? `<div class="meta-item">💺 ${esc(l.seats)}</div>` : ""}
        ${l.booking_url  ? `<div class="meta-item"><a href="${esc(l.booking_url)}" target="_blank" rel="noopener" style="color:#03a9f4;font-size:12px">🔗 Booking</a></div>` : ""}
      </div>
      <div class="hdr-actions">
        <span class="badge" style="background:${color}">${STATUS_LABELS[status] || status}</span>
        ${status === "upcoming" && _countdown(l.depart_at) ? `<span class="countdown">✈ ${_countdown(l.depart_at)}</span>` : ""}
        ${l.type === "flight" && l.flight_number ? `<button class="status-btn" id="flight-status-btn">${this._flightStatusLoading ? "…" : "🔄 Status"}</button>` : ""}
        ${this._gcalEntity ? `<button class="gcal-btn" id="gcal-btn" title="Export to Google Calendar">📅</button>` : ""}
        ${this._gcalMsg ? `<span class="gcal-msg">${esc(this._gcalMsg)}</span>` : ""}
        <button class="edit-btn" id="edit-btn">✏ Edit</button>
      </div>
      ${this._flightStatus ? this._flightStatusHtml(this._flightStatus) : ""}
    </div>
    <div class="tabs">
      ${tabs.map(t => `<button class="tab${t===this._tab?" active":""}" data-tab="${t}">${_tabLabel(t)}</button>`).join("")}
    </div>
    <div class="body" id="body"></div>`;

    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this._render(); });
    });

    const statusBtn = this.shadowRoot.getElementById("flight-status-btn");
    if (statusBtn) statusBtn.addEventListener("click", () => this._fetchFlightStatus());

    const gcalBtn = this.shadowRoot.getElementById("gcal-btn");
    if (gcalBtn) gcalBtn.addEventListener("click", () => this._exportToGcal());

    this.shadowRoot.getElementById("edit-btn").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("edit-requested", {
        detail: { type: "segment", item: this._leg },
        bubbles: true, composed: true,
      }));
    });

    this._mountTab();
  }

  _mountTab() {
    const body = this.shadowRoot.getElementById("body");
    if (!body || !this._leg) return;
    const l = this._leg;

    if (this._tab === "tasks") {
      const el = document.createElement("ta-tasks");
      body.appendChild(el);
      el.parentType = "leg";
      el.parentId   = l.id;
      el.reminders  = l.reminders || [];
      el.items      = l.checklist_items || [];
    } else if (this._tab === "documents") {
      const el = document.createElement("ta-document-viewer");
      body.appendChild(el);
      el.legId = l.id;
      el.documents = l.documents || [];
    } else if (this._tab === "notes") {
      body.innerHTML = `
        <div class="notes-wrap">
          <textarea id="notes-ta" placeholder="Add free-form notes for this segment…">${esc(l.notes || "")}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="notes-hint">Auto-saves on blur.</span>
            <span class="save-indicator" id="save-ind"></span>
          </div>
        </div>`;
      const ta  = body.querySelector("#notes-ta");
      const ind = body.querySelector("#save-ind");
      attachNotesSave(ta, ind, async value => {
        await api.updateLeg(l.id, { notes: value });
        this._leg = { ...this._leg, notes: value };
      });
    }
  }

  async _fetchFlightStatus() {
    if (this._flightStatusLoading) return;
    this._flightStatusLoading = true;
    this._render();
    try {
      this._flightStatus = await api.getFlightStatus(this._leg.id);
    } catch(e) {
      this._flightStatus = { error: e.message };
    } finally {
      this._flightStatusLoading = false;
      this._render();
    }
  }

  async _exportToGcal() {
    const btn = this.shadowRoot.getElementById("gcal-btn");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      await api.exportLegToGcal(this._leg.id);
      this._gcalMsg = "✓ Exported";
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 3000);
    } catch(e) {
      this._gcalMsg = `⚠ ${e.message}`;
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 4000);
    }
  }

  _flightStatusHtml(fs) {
    if (fs.error) return `<div class="flight-status-bar">⚠️ ${esc(fs.error)}</div>`;
    const items = [
      fs.flight_status ? { l: "Status", v: fs.flight_status } : null,
      fs.departure_gate ? { l: "Gate", v: fs.departure_gate } : null,
      fs.departure_terminal ? { l: "Terminal", v: fs.departure_terminal } : null,
      fs.arrival_gate ? { l: "Arr. Gate", v: fs.arrival_gate } : null,
      fs.departure_delay ? { l: "Dep. Delay", v: `+${fs.departure_delay}m`, cls: "fs-delay" } : null,
      fs.arrival_delay ? { l: "Arr. Delay", v: `+${fs.arrival_delay}m`, cls: "fs-delay" } : null,
    ].filter(Boolean);
    if (!items.length) return `<div class="flight-status-bar">No live status data available.</div>`;
    return `<div class="flight-status-bar">${items.map(i =>
      `<div class="fs-item"><span class="fs-label">${i.l}</span><span class="fs-val${i.cls?" "+i.cls:""}">${esc(String(i.v))}</span></div>`
    ).join("")}</div>`;
  }
}

function _tabLabel(t) {
  return { tasks:"✅ Tasks", documents:"📎 Documents", notes:"📝 Notes" }[t] || t;
}

customElements.define("ta-leg-card", TaLegCard);
