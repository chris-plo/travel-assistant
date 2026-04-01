import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, STATUS_LABELS, fmtDate, esc, attachNotesSave } from "../utils.js";
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

class TaStayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stay = null;
    this._tab  = "tasks";
    this._countdownTimer = null;
  }

  set stay(v) { this._stay = v; this._render(); }
  connectedCallback() {
    this._render();
    this._countdownTimer = setInterval(() => {
      if (this._stay && computeStatus(this._stay.check_in, this._stay.check_out) === "upcoming") this._render();
    }, 60000);
  }
  disconnectedCallback() { clearInterval(this._countdownTimer); }

  _render() {
    if (!this._stay) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a stay to view details</div>`;
      return;
    }
    const s      = this._stay;
    const status = computeStatus(s.check_in, s.check_out);
    const color  = STATUS_COLORS[status] || "#FF9800";
    const tabs   = ["tasks", "documents", "notes"];

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#fff8f0,#fff)}
      .title-row{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .hotel-icon{font-size:26px}
      .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .hdr-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
      .edit-btn{margin-left:auto;padding:5px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .edit-btn:hover{background:#f5f5f5}
      .countdown{font-size:11px;font-weight:600;color:#FF9800;background:#fff3e0;padding:3px 8px;border-radius:10px}
      .tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa}
      .tab{flex:1;padding:10px 0;border:none;background:none;font-size:12px;font-weight:500;cursor:pointer;color:#999;border-bottom:2px solid transparent;transition:all .15s}
      .tab.active{color:#FF9800;border-bottom-color:#FF9800;background:#fff}
      .tab:hover:not(.active){color:#555}
      .body{padding:16px;flex:1;overflow-y:auto}
      .notes-wrap{display:flex;flex-direction:column;gap:6px}
      textarea{width:100%;min-height:120px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5}
      .save-indicator{font-size:11px;color:#aaa}
      .save-indicator.saved{color:#4CAF50}
      .save-indicator.error{color:#f44336}
      .notes-hint{font-size:11px;color:#aaa}
    </style>
    <div class="hdr">
      <div class="title-row">
        <span class="hotel-icon">🏨</span>
        <span>${esc(s.name)}</span>
      </div>
      <div class="meta">
        ${s.location  ? `<div class="meta-item">📍 ${esc(s.location)}</div>` : ""}
        ${s.check_in  ? `<div class="meta-item">📅 In: ${fmtDt(s.check_in, s.timezone)}</div>` : ""}
        ${s.check_out ? `<div class="meta-item">📅 Out: ${fmtDt(s.check_out, s.timezone)}</div>` : ""}
        ${s.address   ? `<div class="meta-item">🗺️ ${esc(s.address)}</div>` : ""}
        ${s.confirmation_number ? `<div class="meta-item">🔖 ${esc(s.confirmation_number)}</div>` : ""}
        ${s.timezone  ? `<div class="meta-item">🕐 ${esc(s.timezone)}</div>` : ""}
        ${s.booking_url ? `<div class="meta-item"><a href="${esc(s.booking_url)}" target="_blank" rel="noopener" style="color:#FF9800;font-size:12px">🔗 Booking</a></div>` : ""}
      </div>
      <div class="hdr-actions">
        <span class="badge" style="background:${color}">${STATUS_LABELS[status] || status}</span>
        ${status === "upcoming" && _countdown(s.check_in) ? `<span class="countdown">🏨 ${_countdown(s.check_in)}</span>` : ""}
        <button class="edit-btn" id="edit-btn">✏ Edit</button>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(t => `<button class="tab${t===this._tab?" active":""}" data-tab="${t}">${_tabLabel(t)}</button>`).join("")}
    </div>
    <div class="body" id="body"></div>`;

    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this._render(); });
    });

    this.shadowRoot.getElementById("edit-btn").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("edit-requested", {
        detail: { type: "stay", item: this._stay },
        bubbles: true, composed: true,
      }));
    });

    this._mountTab();
  }

  _mountTab() {
    const body = this.shadowRoot.getElementById("body");
    if (!body || !this._stay) return;
    const s = this._stay;

    if (this._tab === "tasks") {
      const el = document.createElement("ta-tasks");
      body.appendChild(el);
      el.parentType = "stay";
      el.parentId   = s.id;
      el.reminders  = s.reminders || [];
      el.items      = s.checklist_items || [];
    } else if (this._tab === "documents") {
      const el = document.createElement("ta-document-viewer");
      body.appendChild(el);
      el.parentType = "stay";
      el.legId = s.id;
      el.documents = s.documents || [];
    } else if (this._tab === "notes") {
      body.innerHTML = `
        <div class="notes-wrap">
          <textarea id="notes-ta" placeholder="Add free-form notes for this stay…">${esc(s.notes || "")}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="notes-hint">Auto-saves on blur.</span>
            <span class="save-indicator" id="save-ind"></span>
          </div>
        </div>`;
      const ta  = body.querySelector("#notes-ta");
      const ind = body.querySelector("#save-ind");
      attachNotesSave(ta, ind, async value => {
        await api.updateStay(s.id, { notes: value });
        this._stay = { ...this._stay, notes: value };
      });
    }
  }
}

function _tabLabel(t) {
  return { tasks:"✅ Tasks", documents:"📎 Documents", notes:"📝 Notes" }[t] || t;
}

customElements.define("ta-stay-card", TaStayCard);
