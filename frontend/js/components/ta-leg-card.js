import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, STATUS_LABELS, fmtDt, esc, attachNotesSave } from "../utils.js";
import "./ta-tasks.js";
import "./ta-document-viewer.js";

const TYPE_ICONS = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaLegCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._leg = null;
    this._tab = "tasks";
  }

  set leg(v) { this._leg = v; this._render(); }
  connectedCallback() { this._render(); }

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
      </div>
      <div class="hdr-actions">
        <span class="badge" style="background:${color}">${STATUS_LABELS[status] || status}</span>
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
}

function _tabLabel(t) {
  return { tasks:"✅ Tasks", documents:"📎 Documents", notes:"📝 Notes" }[t] || t;
}

customElements.define("ta-leg-card", TaLegCard);
