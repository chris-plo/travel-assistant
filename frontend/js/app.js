import { api } from "./api.js";
import "./components/ta-itinerary-view.js";
import "./components/ta-reminder-editor.js";
import "./components/ta-chat.js";

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
    this._view = "itinerary";
    this._loading = false;
    this._error = null;
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
      main{flex:1;padding:20px;max-width:960px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:20px}
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
      .leg-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-top:12px}
      .leg-form input,.leg-form select{padding:7px 9px;border:1px solid #ccc;border-radius:7px;font-size:12px;width:100%;box-sizing:border-box}
      .leg-form-actions{display:flex;gap:8px;margin-top:10px}
      details summary{cursor:pointer;font-size:13px;font-weight:600;color:#555;list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
      details summary::before{content:"▶";font-size:10px;transition:transform .15s;display:inline-block}
      details[open] summary::before{transform:rotate(90deg)}
      .status-msg{font-size:11px;color:#888}
      .notes-area{width:100%;min-height:100px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5;margin-top:10px}
      .notes-hint{font-size:11px;color:#aaa;margin-top:4px}
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

        ${this._aiProvider !== "none" ? `
        <div class="section-card">
          <details>
            <summary>✨ AI Travel Assistant</summary>
            <ta-chat id="trip-chat" style="margin-top:12px;display:block"></ta-chat>
          </details>
        </div>` : ""}

        <div class="section-card">
          <details>
            <summary>📝 Trip Notes</summary>
            <textarea class="notes-area" id="trip-notes" placeholder="Add free-form notes for this trip…">${_esc(t.notes || "")}</textarea>
            <div class="notes-hint">Auto-saves on blur.</div>
          </details>
        </div>

        <div class="section-card">
          <details>
            <summary>➕ Add Segment</summary>
            ${this._renderAddLegForm()}
          </details>
        </div>

        <div class="section-card">
          <details>
            <summary>🏨 Add Stay</summary>
            ${this._renderAddStayForm()}
          </details>
        </div>

        <div class="reminders-card">
          <p class="section-title">🔔 Trip-level Reminders</p>
          <ta-reminder-editor id="trip-reminders"></ta-reminder-editor>
        </div>
      ` : ""}

      ${!this._loading && this._trips.length > 0 && this._view === "new-trip" ? this._renderNewTripForm() : ""}
    </main>`;

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

    // Mount itinerary view
    const itinerary = this.shadowRoot.getElementById("itinerary-view");
    if (itinerary && t) {
      itinerary.aiProvider = this._aiProvider;
      itinerary.legs  = t.legs  || [];
      itinerary.stays = t.stays || [];
      itinerary.addEventListener("data-changed",  () => this._refresh());
      itinerary.addEventListener("leg-updated",   () => this._refresh());
      itinerary.addEventListener("stay-updated",  () => this._refresh());
    }

    // Trip-level chat
    const chat = this.shadowRoot.getElementById("trip-chat");
    if (chat && t) {
      chat.tripId  = t.id;
      chat.history = t.chat_history || [];
      chat.addEventListener("data-changed", () => this._refresh());
    }

    // Trip notes auto-save
    const notesArea = this.shadowRoot.getElementById("trip-notes");
    if (notesArea && t) {
      notesArea.addEventListener("blur", async e => {
        try { await api.updateTrip(t.id, { notes: e.target.value }); } catch(err) { /* silent */ }
      });
    }

    // Mount trip reminders
    const tripRem = this.shadowRoot.getElementById("trip-reminders");
    if (tripRem && t) {
      tripRem.parentType = "trip";
      tripRem.parentId   = t.id;
      tripRem.reminders  = t.reminders || [];
    }

    this._wireNewTripForm();
    this._wireAddLegForm();
    this._wireAddStayForm();
    this._wireTripSettings();
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

  _renderAddLegForm() {
    return `
    <div class="leg-form" id="leg-form">
      <select id="leg-type">
        <option value="flight">✈️ Flight</option>
        <option value="bus">🚌 Bus</option>
        <option value="car">🚗 Car</option>
        <option value="train">🚆 Train</option>
        <option value="ferry">⛴️ Ferry</option>
        <option value="other">🧳 Other</option>
      </select>
      <input id="leg-origin"      type="text"           placeholder="Origin (e.g. MAD)">
      <input id="leg-destination" type="text"           placeholder="Destination (e.g. BOG)">
      <input id="leg-depart"      type="datetime-local" placeholder="Departure">
      <input id="leg-arrive"      type="datetime-local" placeholder="Arrival">
      <input id="leg-tz"          type="text"           placeholder="Timezone (e.g. Europe/Madrid)" list="__ta-tz-list">
      <input id="leg-carrier"     type="text"           placeholder="Carrier">
      <input id="leg-flight-num"  type="text"           placeholder="Flight / route number">
    </div>
    <div class="leg-form-actions">
      <button class="btn btn-primary" id="btn-add-leg">Add Segment</button>
      <span class="status-msg" id="add-leg-status"></span>
    </div>`;
  }

  _renderAddStayForm() {
    return `
    <div class="leg-form" id="stay-form">
      <input id="stay-name"    type="text"           placeholder="Hotel / property name">
      <input id="stay-loc"     type="text"           placeholder="City / location">
      <input id="stay-checkin" type="datetime-local" placeholder="Check-in">
      <input id="stay-checkout"type="datetime-local" placeholder="Check-out">
      <input id="stay-tz"      type="text"           placeholder="Timezone (e.g. Asia/Tokyo)" list="__ta-tz-list">
      <input id="stay-addr"    type="text"           placeholder="Address (optional)">
      <input id="stay-conf"    type="text"           placeholder="Confirmation # (optional)">
    </div>
    <div class="leg-form-actions">
      <button class="btn btn-primary" id="btn-add-stay">Add Stay</button>
      <span class="status-msg" id="add-stay-status"></span>
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

  _wireAddLegForm() {
    const btn = this.shadowRoot.getElementById("btn-add-leg");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const g = id => this.shadowRoot.getElementById(id)?.value;
      const st = this.shadowRoot.getElementById("add-leg-status");
      const origin = g("leg-origin")?.trim(), dest = g("leg-destination")?.trim();
      if (!origin || !dest) { if(st) st.textContent = "Origin and destination required."; return; }
      const body = {
        type:          g("leg-type") || "flight",
        origin,
        destination:   dest,
        depart_at:     g("leg-depart") ? new Date(g("leg-depart")).toISOString() : null,
        arrive_at:     g("leg-arrive") ? new Date(g("leg-arrive")).toISOString() : null,
        timezone:      g("leg-tz")?.trim() || null,
        carrier:       g("leg-carrier")?.trim() || null,
        flight_number: g("leg-flight-num")?.trim() || null,
      };
      if(st) st.textContent = "Adding…";
      try {
        await api.createLeg(this._selectedTripId, body);
        if(st) st.textContent = "✓ Added";
        await this._refresh();
      } catch(e) { if(st) st.textContent = `Error: ${e.message}`; }
    });
  }

  _wireAddStayForm() {
    const btn = this.shadowRoot.getElementById("btn-add-stay");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const g = id => this.shadowRoot.getElementById(id)?.value;
      const st = this.shadowRoot.getElementById("add-stay-status");
      const name = g("stay-name")?.trim();
      if (!name) { if(st) st.textContent = "Name required."; return; }
      const body = {
        name,
        location:            g("stay-loc")?.trim()  || null,
        check_in:            g("stay-checkin")  ? new Date(g("stay-checkin")).toISOString()  : null,
        check_out:           g("stay-checkout") ? new Date(g("stay-checkout")).toISOString() : null,
        timezone:            g("stay-tz")?.trim()   || null,
        address:             g("stay-addr")?.trim() || null,
        confirmation_number: g("stay-conf")?.trim() || null,
      };
      if(st) st.textContent = "Adding…";
      try {
        await api.createStay(this._selectedTripId, body);
        if(st) st.textContent = "✓ Added";
        await this._refresh();
      } catch(e) { if(st) st.textContent = `Error: ${e.message}`; }
    });
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
