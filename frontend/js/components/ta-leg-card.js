import { api } from "../api.js";
import "./ta-checklist.js";
import "./ta-document-viewer.js";
import "./ta-reminder-editor.js";
import "./ta-chat.js";

const STATUS_LABELS = { upcoming:"Upcoming", active:"Active", completed:"Completed", cancelled:"Cancelled" };
const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };
const TYPE_ICONS    = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaLegCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._leg = null;
    this._tab = "checklist";
    this._aiProvider = "none";
  }

  set leg(v)        { this._leg = v; this._render(); }
  set aiProvider(v) { this._aiProvider = v; this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    if (!this._leg) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a leg to view details</div>`;
      return;
    }
    const l = this._leg;
    const color = STATUS_COLORS[l.status] || "#607D8B";
    const icon  = TYPE_ICONS[l.type] || "🧳";
    const tabs  = ["checklist","documents","reminders",...(this._aiProvider!=="none"?["chat"]:[])];

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;gap:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#f8f9ff,#fff)}
      .route{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .icon{font-size:24px}
      .arrow{color:#aaa;font-weight:300}
      .meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .status-row{display:flex;align-items:center;gap:10px;margin-top:10px}
      .status-select{padding:5px 10px;border-radius:8px;border:1px solid #ddd;font-size:12px;cursor:pointer;background:#fff}
      .tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa}
      .tab{flex:1;padding:10px 0;border:none;background:none;font-size:12px;font-weight:500;cursor:pointer;color:#999;border-bottom:2px solid transparent;transition:all .15s}
      .tab.active{color:#03a9f4;border-bottom-color:#03a9f4;background:#fff}
      .tab:hover:not(.active){color:#555}
      .body{padding:16px;flex:1;overflow-y:auto}
    </style>
    <div class="hdr">
      <div class="route">
        <span class="icon">${icon}</span>
        <span>${_esc(l.origin)}</span>
        <span class="arrow">→</span>
        <span>${_esc(l.destination)}</span>
      </div>
      <div class="meta">
        ${l.depart_at ? `<div class="meta-item">🛫 ${_fmtDt(l.depart_at)}</div>` : ""}
        ${l.arrive_at ? `<div class="meta-item">🛬 ${_fmtDt(l.arrive_at)}</div>` : ""}
        ${l.carrier   ? `<div class="meta-item">🏢 ${_esc(l.carrier)}</div>` : ""}
        ${l.flight_number ? `<div class="meta-item">🔢 ${_esc(l.flight_number)}</div>` : ""}
        ${l.notes     ? `<div class="meta-item">📝 ${_esc(l.notes)}</div>` : ""}
      </div>
      <div class="status-row">
        <span class="badge" style="background:${color}">${STATUS_LABELS[l.status]||l.status}</span>
        <select class="status-select" id="status-select">
          ${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}"${k===l.status?" selected":""}>${v}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(t=>`<button class="tab${t===this._tab?" active":""}" data-tab="${t}">${_tabLabel(t)}</button>`).join("")}
    </div>
    <div class="body" id="body"></div>`;

    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this._render(); });
    });

    this.shadowRoot.getElementById("status-select").addEventListener("change", async e => {
      const newStatus = e.target.value;
      try {
        await api.updateLeg(l.id, { status: newStatus });
        this._leg = { ...this._leg, status: newStatus };
        this.dispatchEvent(new CustomEvent("leg-updated", { detail: this._leg, bubbles: true, composed: true }));
        this._render();
      } catch(err) { e.target.value = l.status; }
    });

    this._mountTab();
  }

  _mountTab() {
    const body = this.shadowRoot.getElementById("body");
    if (!body || !this._leg) return;
    const l = this._leg;

    if (this._tab === "checklist") {
      const el = document.createElement("ta-checklist");
      body.appendChild(el);
      el.legId = l.id;
      el.items = l.checklist_items || [];
    } else if (this._tab === "documents") {
      const el = document.createElement("ta-document-viewer");
      body.appendChild(el);
      el.legId = l.id;
      el.documents = l.documents || [];
    } else if (this._tab === "reminders") {
      const el = document.createElement("ta-reminder-editor");
      body.appendChild(el);
      el.parentType = "leg";
      el.parentId = l.id;
      el.reminders = l.reminders || [];
    } else if (this._tab === "chat") {
      const el = document.createElement("ta-chat");
      body.appendChild(el);
      el.tripId = l.trip_id;
      el.history = l.chat_history || [];
      el.addEventListener("data-changed", () => {
        this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
      });
    }
  }
}

function _esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function _fmtDt(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle:"short", timeStyle:"short" }); }
  catch { return iso; }
}
function _tabLabel(t) {
  return { checklist:"✅ Checklist", documents:"📎 Documents", reminders:"🔔 Reminders", chat:"💬 Chat" }[t] || t;
}

customElements.define("ta-leg-card", TaLegCard);
