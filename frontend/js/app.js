import { api } from "./api.js";
import "./components/ta-itinerary-view.js";
import "./components/ta-reminder-editor.js";
import "./components/ta-chat.js";
import "./components/ta-item-modal.js";
import "./components/ta-tasks.js";

// ---------------------------------------------------------------------------
// IANA timezone list for datalist (injected into light DOM once)
// ---------------------------------------------------------------------------
const TZ_LIST = [
  "UTC",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Toronto","America/Vancouver","America/Mexico_City","America/Bogota",
  "America/Lima","America/Santiago","America/Sao_Paulo","America/Buenos_Aires",
  "America/Caracas","America/Halifax","America/Anchorage","America/Phoenix",
  "Europe/London","Europe/Dublin","Europe/Lisbon","Europe/Paris","Europe/Berlin",
  "Europe/Madrid","Europe/Rome","Europe/Amsterdam","Europe/Brussels","Europe/Stockholm",
  "Europe/Oslo","Europe/Copenhagen","Europe/Helsinki","Europe/Athens","Europe/Warsaw",
  "Europe/Prague","Europe/Vienna","Europe/Zurich","Europe/Moscow","Europe/Istanbul",
  "Europe/Bucharest","Europe/Budapest","Europe/Belgrade","Europe/Sofia",
  "Asia/Dubai","Asia/Karachi","Asia/Kolkata","Asia/Dhaka","Asia/Colombo",
  "Asia/Kathmandu","Asia/Bangkok","Asia/Singapore","Asia/Kuala_Lumpur",
  "Asia/Jakarta","Asia/Shanghai","Asia/Hong_Kong","Asia/Taipei","Asia/Tokyo",
  "Asia/Seoul","Asia/Manila","Asia/Tehran","Asia/Riyadh","Asia/Baghdad",
  "Asia/Beirut","Asia/Jerusalem","Asia/Rangoon","Asia/Almaty","Asia/Tashkent",
  "Africa/Cairo","Africa/Johannesburg","Africa/Lagos","Africa/Nairobi","Africa/Casablanca",
  "Pacific/Auckland","Pacific/Sydney","Pacific/Melbourne","Pacific/Fiji","Pacific/Honolulu","Pacific/Guam",
];

function _ensureTzDatalist() {
  if (!document.getElementById("__ta-tz-list")) {
    const dl = document.createElement("datalist");
    dl.id = "__ta-tz-list";
    TZ_LIST.forEach(tz => { const o = document.createElement("option"); o.value = tz; dl.appendChild(o); });
    document.body.appendChild(dl);
  }
}

// ---------------------------------------------------------------------------
// Root application
// ---------------------------------------------------------------------------

class TravelApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._trips = [];
    this._selectedTripId = null;
    this._tripData = null;
    this._aiProvider = "none";
    this._gcalEntity = "";
    this._view = "itinerary";
    this._loading = false;
    this._error = null;
    this._fabOpen = false;
    this._chatOpen = false;
  }

  connectedCallback() {
    _ensureTzDatalist();
    this._bootstrap();
  }

  async _bootstrap() {
    this._loading = true;
    this._render();
    try {
      const cfg = await fetch("./api/config").then(r => r.ok ? r.json() : {}).catch(() => ({}));
      this._aiProvider = cfg.ai_provider || "none";
      this._gcalEntity = cfg.gcal_entity || "";
      this._trips = await api.getTrips();
      if (this._trips.length > 0) {
        this._selectedTripId = this._trips[0].id;
        await this._loadTrip(this._selectedTripId);
      }
    } catch(e) {
      this._error = e.message;
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _loadTrip(id) {
    this._tripData = await api.getTrip(id);
  }

  _render() {
    const t = this._tripData;

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;min-height:100vh;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);position:sticky;top:0;z-index:100}
      .logo{font-size:22px}
      h1{font-size:17px;font-weight:700;color:#222;margin:0;flex:1}
      .trip-select{padding:6px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#fff;cursor:pointer;max-width:200px}
      .btn{padding:7px 14px;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;white-space:nowrap}
      .btn-primary{background:#03a9f4;color:#fff}.btn-primary:hover{background:#0288d1}
      .btn-ghost{background:none;color:#666;border:1px solid #ddd}.btn-ghost:hover{background:#f5f5f5}
      .btn-danger{background:none;color:#f44336;border:1px solid #fcc}.btn-danger:hover{background:#ffeaea}
      main{flex:1;padding:20px;max-width:960px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:20px;padding-bottom:96px}
      .error{background:#ffeaea;color:#b71c1c;padding:12px 16px;border-radius:8px;font-size:13px}
      .spinner{text-align:center;color:#aaa;padding:48px;font-size:14px}
      .section-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
      .section-title{font-size:14px;font-weight:600;color:#444;margin:0 0 14px}
      .form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
      .form-grid input,.form-grid textarea,.form-grid select{padding:8px 10px;border:1px solid #ccc;border-radius:7px;font-size:13px;width:100%;box-sizing:border-box}
      .form-grid textarea{resize:vertical;min-height:64px}
      .form-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      .reminders-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
      .trip-actions{display:flex;gap:8px;align-items:center}
      .empty-state{text-align:center;color:#bbb;padding:48px;font-size:14px}
      .new-trip-form{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
      details summary{cursor:pointer;font-size:13px;font-weight:600;color:#555;list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
      details summary::before{content:"▶";font-size:10px;transition:transform .15s;display:inline-block}
      details[open] summary::before{transform:rotate(90deg)}
      .status-msg{font-size:11px;color:#888}
      .notes-area{width:100%;min-height:100px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5}
      .notes-hint{font-size:11px;color:#aaa;margin-top:4px}
      /* FAB */
      .fab-container{position:fixed;bottom:24px;right:24px;z-index:200;display:flex;flex-direction:column;align-items:flex-end;gap:10px;transition:transform .3s ease,opacity .3s ease}
      .fab-container.sheet-open{transform:translateY(120px);opacity:0;pointer-events:none}
      .fab{width:56px;height:56px;border-radius:50%;border:none;background:#03a9f4;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s}
      .fab:hover{background:#0288d1}
      .fab.open{transform:rotate(45deg)}
      .fab-chat{font-size:22px;background:#7c4dff}
      .fab-chat:hover{background:#651fff}
      .fab-menu{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
      .fab-option{display:flex;align-items:center;gap:8px;cursor:pointer;background:none;border:none;padding:0}
      .fab-option-label{background:#fff;color:#333;font-size:13px;font-weight:500;padding:6px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap}
      .fab-option-btn{width:44px;height:44px;border-radius:50%;border:none;background:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center}
      .fab-option-btn:hover{background:#e3f2fd}
      /* Chat bottom sheet */
      .chat-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300}
      .chat-sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:640px;background:#fff;border-radius:20px 20px 0 0;z-index:301;display:flex;flex-direction:column;max-height:85vh;overflow:hidden;animation:chatSlideUp .25s ease;box-shadow:0 -4px 24px rgba(0,0,0,.15)}
      @keyframes chatSlideUp{from{transform:translateX(-50%) translateY(100%)}to{transform:translateX(-50%) translateY(0)}}
      .chat-sheet-hdr{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;flex-shrink:0}
      .chat-sheet-title{font-size:16px;font-weight:700;color:#222;flex:1}
      .chat-close-btn{background:none;border:none;font-size:22px;cursor:pointer;color:#aaa;padding:0 4px;line-height:1}
      .chat-close-btn:hover{color:#333}
      .chat-sheet-body{flex:1;overflow:hidden;display:flex;flex-direction:column}
    </style>
    <header>
      <span class="logo">✈️</span>
      <h1>Travel Assistant</h1>
      ${this._trips.length > 0 ? `
        <select class="trip-select" id="trip-select">
          ${this._trips.map(tr => `<option value="${tr.id}"${tr.id===this._selectedTripId?" selected":""}>${_esc(tr.name)}</option>`).join("")}
        </select>
        <div class="trip-actions">
          <button class="btn btn-ghost" id="btn-new-trip">+ Trip</button>
          <button class="btn btn-ghost" id="btn-trip-settings">⚙ Edit</button>
          ${this._gcalEntity ? `<button class="btn btn-ghost" id="btn-gcal-export" title="Export to Google Calendar">📅 GCal</button>` : ""}
          <button class="btn btn-danger" id="btn-delete-trip">🗑</button>
        </div>
      ` : ""}
    </header>
    <main>
      ${this._error ? `<div class="error">⚠️ ${_esc(this._error)}</div>` : ""}
      ${this._loading ? `<div class="spinner">Loading…</div>` : ""}

      ${!this._loading && this._trips.length === 0 ? this._renderNewTripForm() : ""}

      ${!this._loading && this._trips.length > 0 && this._view === "trip-settings" ? this._renderTripSettings() : ""}

      ${!this._loading && t && this._view === "itinerary" ? `

        <ta-itinerary-view id="itinerary-view"></ta-itinerary-view>

        <div class="section-card">
          <p class="section-title">📝 Trip Notes</p>
          <textarea class="notes-area" id="trip-notes" placeholder="Add free-form notes for this trip…">${_esc(t.notes || "")}</textarea>
          <div class="notes-hint">Auto-saves on blur.</div>
        </div>

        ${this._renderTripTasks(t)}
      ` : ""}

      ${!this._loading && this._trips.length > 0 && this._view === "new-trip" ? this._renderNewTripForm() : ""}
    </main>

    ${!this._loading && t && this._view === "itinerary" ? `
    <div class="fab-container" id="fab-container">
      ${this._fabOpen ? `
      <div class="fab-menu">
        <button class="fab-option" id="fab-add-stay">
          <span class="fab-option-label">Stay</span>
          <span class="fab-option-btn">🏨</span>
        </button>
        <button class="fab-option" id="fab-add-segment">
          <span class="fab-option-label">Segment</span>
          <span class="fab-option-btn">✈️</span>
        </button>
      </div>` : ""}
      <button class="fab${this._fabOpen ? " open" : ""}" id="fab-main">+</button>
      ${this._aiProvider !== "none" ? `<button class="fab fab-chat" id="fab-chat" title="AI Travel Assistant">💬</button>` : ""}
    </div>
    ${this._chatOpen ? `
    <div class="chat-backdrop" id="chat-backdrop"></div>
    <div class="chat-sheet" id="chat-sheet">
      <div class="chat-sheet-hdr">
        <span class="chat-sheet-title">✨ AI Travel Assistant</span>
        <button class="chat-close-btn" id="chat-close-btn">✕</button>
      </div>
      <div class="chat-sheet-body">
        <ta-chat id="trip-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden"></ta-chat>
      </div>
    </div>` : ""}
    ` : ""}

    <ta-item-modal id="item-modal"></ta-item-modal>`;

    // Wire trip selector
    const sel = this.shadowRoot.getElementById("trip-select");
    if (sel) sel.addEventListener("change", () => this._switchTrip(sel.value));

    // Header buttons
    const btnNew = this.shadowRoot.getElementById("btn-new-trip");
    if (btnNew) btnNew.addEventListener("click", () => { this._view = "new-trip"; this._render(); });

    const btnSettings = this.shadowRoot.getElementById("btn-trip-settings");
    if (btnSettings) btnSettings.addEventListener("click", () => { this._view = this._view==="trip-settings"?"itinerary":"trip-settings"; this._render(); });

    const btnDelete = this.shadowRoot.getElementById("btn-delete-trip");
    if (btnDelete) btnDelete.addEventListener("click", () => this._deleteTrip());

    const btnGcal = this.shadowRoot.getElementById("btn-gcal-export");
    if (btnGcal) btnGcal.addEventListener("click", () => this._exportToGcal());

    // Mount itinerary view
    const itinerary = this.shadowRoot.getElementById("itinerary-view");
    if (itinerary && t) {
      itinerary.aiProvider  = this._aiProvider;
      itinerary.gcalEntity  = this._gcalEntity;
      itinerary.legs  = t.legs  || [];
      itinerary.stays = t.stays || [];
      itinerary.addEventListener("data-changed",  () => this._refresh());
      itinerary.addEventListener("leg-updated",   () => this._refresh());
      itinerary.addEventListener("stay-updated",  () => this._refresh());
      const fabContainer = this.shadowRoot.getElementById("fab-container");
      itinerary.addEventListener("detail-sheet-opened", () => fabContainer?.classList.add("sheet-open"));
      itinerary.addEventListener("detail-sheet-closed", () => fabContainer?.classList.remove("sheet-open"));
    }

    // Catch edit-requested from itinerary (bubbles + composed through shadow DOM)
    this.shadowRoot.addEventListener("edit-requested", e => {
      const { type, item } = e.detail || {};
      if (!type || !item) return;
      const modal = this.shadowRoot.getElementById("item-modal");
      if (!modal) return;
      modal.aiProvider = this._aiProvider;
      modal.open({ mode: type === "stay" ? "stay" : "segment", tripId: this._selectedTripId, item });
    });

    // Chat bottom sheet
    const chat = this.shadowRoot.getElementById("trip-chat");
    if (chat && t) {
      chat.tripId  = t.id;
      chat.history = t.chat_history || [];
      chat.addEventListener("data-changed", () => this._refresh());
    }
    const chatBackdrop = this.shadowRoot.getElementById("chat-backdrop");
    if (chatBackdrop) chatBackdrop.addEventListener("click", () => { this._chatOpen = false; this._render(); });
    const chatCloseBtn = this.shadowRoot.getElementById("chat-close-btn");
    if (chatCloseBtn) chatCloseBtn.addEventListener("click", () => { this._chatOpen = false; this._render(); });
    const fabChat = this.shadowRoot.getElementById("fab-chat");
    if (fabChat) fabChat.addEventListener("click", () => { this._chatOpen = true; this._fabOpen = false; this._render(); });

    // Trip notes auto-save
    const notesArea = this.shadowRoot.getElementById("trip-notes");
    if (notesArea && t) {
      notesArea.addEventListener("blur", async e => {
        try { await api.updateTrip(t.id, { notes: e.target.value }); } catch(err) { console.error("Notes save failed:", err); }
      });
    }

    // FAB
    const fabMain = this.shadowRoot.getElementById("fab-main");
    if (fabMain) {
      fabMain.addEventListener("click", () => {
        this._fabOpen = !this._fabOpen;
        this._render();
      });
    }
    const fabSeg = this.shadowRoot.getElementById("fab-add-segment");
    if (fabSeg) {
      fabSeg.addEventListener("click", () => {
        this._fabOpen = false;
        this._render();
        const modal = this.shadowRoot.getElementById("item-modal");
        if (modal) { modal.aiProvider = this._aiProvider; modal.open({ mode: "segment", tripId: this._selectedTripId, item: null }); }
      });
    }
    const fabStay = this.shadowRoot.getElementById("fab-add-stay");
    if (fabStay) {
      fabStay.addEventListener("click", () => {
        this._fabOpen = false;
        this._render();
        const modal = this.shadowRoot.getElementById("item-modal");
        if (modal) { modal.aiProvider = this._aiProvider; modal.open({ mode: "stay", tripId: this._selectedTripId, item: null }); }
      });
    }

    // Modal events
    const modal = this.shadowRoot.getElementById("item-modal");
    if (modal) {
      modal.addEventListener("saved",   () => this._refresh());
      modal.addEventListener("deleted", () => this._refresh());
    }

    if (t && this._view === "itinerary") this._mountTripTasks(t);
    this._wireNewTripForm();
    this._wireTripSettings();
  }

  _renderTripTasks(t) {
    const allItems = [
      ...(t.legs  || []).map(l => ({ parentType:"leg",  parentId:l.id,  name:`${l.origin||""}→${l.destination||""}`, items:l.checklist_items||[], reminders:l.reminders||[] })),
      ...(t.stays || []).map(s => ({ parentType:"stay", parentId:s.id,  name:s.name||"Stay",                          items:s.checklist_items||[], reminders:s.reminders||[] })),
    ].filter(g => g.items.length > 0);

    if (allItems.length === 0) return "";

    const rows = allItems.map((g, i) => {
      const done  = g.items.filter(x => x.checked).length;
      const total = g.items.length;
      return `
      <div class="tasks-group">
        <div class="tasks-group-hdr">${_esc(g.name)} <span class="tasks-progress">${done}/${total}</span></div>
        <ta-tasks id="trip-tasks-${i}" data-idx="${i}"></ta-tasks>
      </div>`;
    }).join("");

    return `
    <div class="section-card" id="trip-tasks-section">
      <p class="section-title">✅ Tasks by Segment/Stay</p>
      <style>
        .tasks-group{margin-bottom:18px}
        .tasks-group:last-child{margin-bottom:0}
        .tasks-group-hdr{font-size:13px;font-weight:600;color:#555;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
        .tasks-progress{font-size:11px;color:#aaa;font-weight:400}
      </style>
      ${rows}
    </div>`;
  }

  _mountTripTasks(t) {
    const allItems = [
      ...(t.legs  || []).map(l => ({ parentType:"leg",  parentId:l.id,  items:l.checklist_items||[], reminders:l.reminders||[] })),
      ...(t.stays || []).map(s => ({ parentType:"stay", parentId:s.id,  items:s.checklist_items||[], reminders:s.reminders||[] })),
    ].filter(g => g.items.length > 0);

    allItems.forEach((g, i) => {
      const el = this.shadowRoot.getElementById(`trip-tasks-${i}`);
      if (!el) return;
      el.parentType = g.parentType;
      el.parentId   = g.parentId;
      el.reminders  = g.reminders;
      el.items      = g.items;
    });
  }

  _renderNewTripForm() {
    return `
    <div class="new-trip-form">
      <p class="section-title">${this._trips.length===0?"Create your first trip":"New Trip"}</p>
      <div class="form-grid">
        <input id="new-trip-name" type="text" placeholder="Trip name, e.g. Europe 2026">
        <textarea id="new-trip-desc" placeholder="Description (optional)"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="btn-create-trip">Create Trip</button>
        ${this._trips.length>0?`<button class="btn btn-ghost" id="btn-cancel-new">Cancel</button>`:""}
        <span class="status-msg" id="new-trip-status"></span>
      </div>
    </div>`;
  }

  _renderTripSettings() {
    const t = this._tripData;
    if (!t) return "";
    return `
    <div class="section-card">
      <p class="section-title">✏️ Edit Trip</p>
      <div class="form-grid">
        <input id="edit-trip-name" type="text" value="${_esc(t.name)}">
        <textarea id="edit-trip-desc">${_esc(t.description||"")}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="btn-save-trip">Save</button>
        <button class="btn btn-ghost" id="btn-cancel-settings">Cancel</button>
        <span class="status-msg" id="edit-trip-status"></span>
      </div>
    </div>`;
  }

  _wireNewTripForm() {
    const btn = this.shadowRoot.getElementById("btn-create-trip");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const name = this.shadowRoot.getElementById("new-trip-name")?.value.trim();
      const desc = this.shadowRoot.getElementById("new-trip-desc")?.value.trim();
      const st   = this.shadowRoot.getElementById("new-trip-status");
      if (!name) { if(st) st.textContent = "Name required."; return; }
      if(st) st.textContent = "Creating…";
      try {
        const trip = await api.createTrip({ name, description: desc || "" });
        this._trips.push(trip);
        this._selectedTripId = trip.id;
        await this._loadTrip(trip.id);
        this._view = "itinerary";
        this._render();
      } catch(e) { if(st) st.textContent = `Error: ${e.message}`; }
    });

    const cancel = this.shadowRoot.getElementById("btn-cancel-new");
    if (cancel) cancel.addEventListener("click", () => { this._view = "itinerary"; this._render(); });
  }

  _wireTripSettings() {
    const save = this.shadowRoot.getElementById("btn-save-trip");
    if (!save) return;
    save.addEventListener("click", async () => {
      const name = this.shadowRoot.getElementById("edit-trip-name")?.value.trim();
      const desc = this.shadowRoot.getElementById("edit-trip-desc")?.value.trim();
      const st   = this.shadowRoot.getElementById("edit-trip-status");
      if (!name) { if(st) st.textContent = "Name required."; return; }
      if(st) st.textContent = "Saving…";
      try {
        await api.updateTrip(this._selectedTripId, { name, description: desc || "" });
        const idx = this._trips.findIndex(t => t.id === this._selectedTripId);
        if (idx >= 0) this._trips[idx] = { ...this._trips[idx], name, description: desc };
        if (this._tripData) this._tripData = { ...this._tripData, name, description: desc };
        this._view = "itinerary";
        this._render();
      } catch(e) { if(st) st.textContent = `Error: ${e.message}`; }
    });

    const cancel = this.shadowRoot.getElementById("btn-cancel-settings");
    if (cancel) cancel.addEventListener("click", () => { this._view = "itinerary"; this._render(); });
  }

  async _switchTrip(id) {
    this._selectedTripId = id;
    this._tripData = null;
    this._view = "itinerary";
    this._loading = true;
    this._render();
    try {
      await this._loadTrip(id);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _deleteTrip() {
    if (!confirm(`Delete trip "${this._tripData?.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteTrip(this._selectedTripId);
      this._trips = this._trips.filter(t => t.id !== this._selectedTripId);
      this._tripData = null;
      this._selectedTripId = this._trips[0]?.id || null;
      if (this._selectedTripId) await this._loadTrip(this._selectedTripId);
      this._view = "itinerary";
      this._render();
    } catch(e) { alert(`Error: ${e.message}`); }
  }

  async _exportToGcal() {
    if (!this._selectedTripId) return;
    const btn = this.shadowRoot.getElementById("btn-gcal-export");
    if (btn) { btn.disabled = true; btn.textContent = "📅 Exporting…"; }
    try {
      const res = await api.exportToGcal(this._selectedTripId);
      alert(`✅ Exported ${res.created} event(s) to Google Calendar${res.errors?.length ? `\n⚠️ ${res.errors.length} error(s): ${res.errors.join(", ")}` : ""}.`);
    } catch(e) {
      alert(`❌ GCal export failed: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "📅 GCal"; }
    }
  }

  async _refresh() {
    if (!this._selectedTripId) return;
    try {
      await this._loadTrip(this._selectedTripId);
      this._render();
    } catch(e) { /* silent */ }
  }
}

function _esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

customElements.define("travel-app", TravelApp);

// Mount on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  const app = document.createElement("travel-app");
  document.getElementById("app").appendChild(app);
});
