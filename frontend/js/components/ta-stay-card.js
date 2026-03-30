import { api } from "../api.js";
import "./ta-checklist.js";
import "./ta-document-viewer.js";
import "./ta-reminder-editor.js";

const STATUS_LABELS = { upcoming:"Upcoming", active:"Active", completed:"Completed", cancelled:"Cancelled" };
const STATUS_COLORS = { upcoming:"#2196F3", active:"#4CAF50", completed:"#9E9E9E", cancelled:"#F44336" };

class TaStayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stay = null;
    this._tab = "checklist";
  }

  set stay(v) { this._stay = v; this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    if (!this._stay) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a stay to view details</div>`;
      return;
    }
    const s = this._stay;
    const color = STATUS_COLORS[s.status] || "#607D8B";
    const tabs  = ["checklist", "documents", "reminders", "notes"];

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#fff8f0,#fff)}
      .title-row{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .hotel-icon{font-size:26px}
      .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .status-row{display:flex;align-items:center;gap:10px;margin-top:10px}
      .status-select{padding:5px 10px;border-radius:8px;border:1px solid #ddd;font-size:12px;cursor:pointer;background:#fff}
      .tabs{display:flex;border-bottom:1px solid #eee;background:#fafafa}
      .tab{flex:1;padding:10px 0;border:none;background:none;font-size:12px;font-weight:500;cursor:pointer;color:#999;border-bottom:2px solid transparent;transition:all .15s}
      .tab.active{color:#FF9800;border-bottom-color:#FF9800;background:#fff}
      .tab:hover:not(.active){color:#555}
      .body{padding:16px;flex:1;overflow-y:auto}
      .notes-area{width:100%;min-height:120px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5}
      .notes-hint{font-size:11px;color:#aaa;margin-top:6px}
    </style>
    <div class="hdr">
      <div class="title-row">
        <span class="hotel-icon">🏨</span>
        <span>${_esc(s.name)}</span>
      </div>
      <div class="meta">
        ${s.location        ? `<div class="meta-item">📍 ${_esc(s.location)}</div>` : ""}
        ${s.check_in        ? `<div class="meta-item">📅 Check-in: ${_fmtDt(s.check_in)}</div>` : ""}
        ${s.check_out       ? `<div class="meta-item">📅 Check-out: ${_fmtDt(s.check_out)}</div>` : ""}
        ${s.address         ? `<div class="meta-item">🗺️ ${_esc(s.address)}</div>` : ""}
        ${s.confirmation_number ? `<div class="meta-item">🔖 ${_esc(s.confirmation_number)}</div>` : ""}
        ${s.timezone        ? `<div class="meta-item">🕐 ${_esc(s.timezone)}</div>` : ""}
      </div>
      <div class="status-row">
        <span class="badge" style="background:${color}">${STATUS_LABELS[s.status] || s.status}</span>
        <select class="status-select" id="status-select">
          ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}"${k===s.status?" selected":""}>${v}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(t => `<button class="tab${t===this._tab?" active":""}" data-tab="${t}">${_tabLabel(t)}</button>`).join("")}
    </div>
    <div class="body" id="body"></div>`;

    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this._render(); });
    });

    this.shadowRoot.getElementById("status-select").addEventListener("change", async e => {
      const newStatus = e.target.value;
      try {
        await api.updateStay(s.id, { status: newStatus });
        this._stay = { ...this._stay, status: newStatus };
        this.dispatchEvent(new CustomEvent("stay-updated", { detail: this._stay, bubbles: true, composed: true }));
        this._render();
      } catch(err) { e.target.value = s.status; }
    });

    this._mountTab();
  }

  _mountTab() {
    const body = this.shadowRoot.getElementById("body");
    if (!body || !this._stay) return;
    const s = this._stay;

    if (this._tab === "checklist") {
      const el = document.createElement("ta-checklist");
      body.appendChild(el);
      el.parentType = "stay";
      el.legId = s.id;
      el.items = s.checklist_items || [];
    } else if (this._tab === "documents") {
      const el = document.createElement("ta-document-viewer");
      body.appendChild(el);
      el.parentType = "stay";
      el.legId = s.id;
      el.documents = s.documents || [];
    } else if (this._tab === "reminders") {
      const el = document.createElement("ta-reminder-editor");
      body.appendChild(el);
      el.parentType = "stay";
      el.parentId = s.id;
      el.reminders = s.reminders || [];
    } else if (this._tab === "notes") {
      body.innerHTML = `
        <textarea id="notes-ta" placeholder="Add free-form notes for this stay…">${_esc(s.notes || "")}</textarea>
        <div class="notes-hint">Auto-saves on blur.</div>`;
      const ta = body.querySelector("#notes-ta");
      ta.style.cssText = "width:100%;min-height:120px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5";
      ta.addEventListener("blur", async e => {
        const notes = e.target.value;
        try { await api.updateStay(s.id, { notes }); this._stay = { ...this._stay, notes }; } catch(err) { /* silent */ }
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
  return { checklist:"✅ Checklist", documents:"📎 Documents", reminders:"🔔 Reminders", notes:"📝 Notes" }[t] || t;
}

customElements.define("ta-stay-card", TaStayCard);
