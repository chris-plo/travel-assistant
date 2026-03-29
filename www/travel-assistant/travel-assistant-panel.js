/**
 * travel-assistant-panel — root HA panel web component.
 *
 * Registered as a full-page sidebar panel by panel.py.
 * Handles trip listing, routing, and data fetching.
 */
import "./components/ta-itinerary-view.js";

class TravelAssistantPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass      = null;
    this._trips     = [];
    this._trip      = null;     // full trip detail
    this._loading   = false;
    this._error     = null;
    this._showNewTripForm = false;
  }

  // HA sets this property on every state update
  set hass(hass) {
    this._hass = hass;
    if (!this._initialised) {
      this._initialised = true;
      this._loadTrips();
    }
  }

  get _token() {
    return this._hass?.auth?.data?.access_token ?? "";
  }

  get _aiEnabled() {
    // Expose a flag we can check by calling a lightweight probe endpoint
    return this._trip !== null; // always enable if trip loaded (backend decides)
  }

  connectedCallback() {
    this._render();
  }

  async _api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this._token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json().catch(() => ({}));
  }

  async _loadTrips() {
    this._loading = true;
    this._error   = null;
    this._render();
    try {
      this._trips = await this._api("GET", "/api/travel_assistant/trips");
      if (this._trips.length > 0) {
        await this._loadTrip(this._trips[0].id);
      } else {
        this._loading = false;
        this._render();
      }
    } catch (err) {
      this._error   = err.message;
      this._loading = false;
      this._render();
    }
  }

  async _loadTrip(tripId) {
    this._loading = true;
    this._render();
    try {
      this._trip    = await this._api("GET", `/api/travel_assistant/trips/${tripId}`);
      this._loading = false;
      this._render();
    } catch (err) {
      this._error   = err.message;
      this._loading = false;
      this._render();
    }
  }

  async _createTrip(name, description) {
    const trip = await this._api("POST", "/api/travel_assistant/trips", { name, description });
    await this._loadTrips();
    await this._loadTrip(trip.id);
  }

  async _deleteTrip(tripId) {
    if (!confirm("Delete this trip and all its legs?")) return;
    await this._api("DELETE", `/api/travel_assistant/trips/${tripId}`);
    this._trip = null;
    await this._loadTrips();
  }

  _render() {
    const root = this.shadowRoot;

    root.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          background: var(--primary-background-color, #fafafa);
          color: var(--primary-text-color, #333);
          overflow-y: auto;
        }
        .topbar {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 20px;
          background: var(--app-header-background-color, var(--primary-color, #03a9f4));
          color: var(--app-header-text-color, #fff);
          box-shadow: 0 2px 6px rgba(0,0,0,.15);
          position: sticky; top: 0; z-index: 10;
        }
        .topbar-title { font-size: 18px; font-weight: 600; flex: 1; }
        .topbar-actions { display: flex; gap: 8px; align-items: center; }
        .trip-select {
          padding: 5px 10px; border: 1px solid rgba(255,255,255,.5); border-radius: 6px;
          background: rgba(255,255,255,.15); color: inherit; font-size: 13px; cursor: pointer;
        }
        .icon-btn {
          background: rgba(255,255,255,.2); border: none; border-radius: 6px;
          color: inherit; cursor: pointer; padding: 6px 10px; font-size: 14px;
        }
        .icon-btn:hover { background: rgba(255,255,255,.35); }
        .main { max-width: 960px; margin: 0 auto; padding: 20px; }
        .loading { text-align: center; padding: 60px 0; color: var(--secondary-text-color,#999); font-size: 14px; }
        .error   { color: #f44336; padding: 20px; font-size: 13px; }
        .empty   { text-align: center; padding: 60px 20px; color: var(--secondary-text-color,#bbb); }
        .new-trip-form {
          background: var(--card-background-color,#fff); border-radius: 12px;
          padding: 20px; margin-bottom: 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,.08);
          display: flex; flex-direction: column; gap: 10px;
        }
        .new-trip-form h3 { margin: 0; font-size: 15px; }
        .new-trip-form input {
          padding: 8px 12px; border: 1px solid var(--divider-color,#ccc); border-radius: 8px;
          font-size: 13px; background: var(--primary-background-color,#fafafa);
          color: var(--primary-text-color,#333);
        }
        .form-btns { display: flex; gap: 8px; }
        .btn-primary {
          padding: 8px 20px; border: none; border-radius: 8px;
          background: var(--primary-color,#03a9f4); color: #fff; cursor: pointer; font-size: 13px;
        }
        .btn-secondary {
          padding: 8px 16px; border: 1px solid var(--divider-color,#ccc); border-radius: 8px;
          background: none; color: var(--secondary-text-color,#666); cursor: pointer; font-size: 13px;
        }
        .trip-header {
          display: flex; align-items: flex-start; gap: 12px;
          background: var(--card-background-color,#fff); border-radius: 12px;
          padding: 16px 20px; margin-bottom: 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,.08);
        }
        .trip-title { font-size: 18px; font-weight: 700; flex: 1; }
        .trip-desc  { font-size: 13px; color: var(--secondary-text-color,#888); margin-top: 2px; }
        .trip-actions { display: flex; gap: 8px; align-self: flex-start; }
        .danger-btn {
          padding: 5px 12px; border: 1px solid #f44336; border-radius: 6px;
          color: #f44336; background: none; cursor: pointer; font-size: 12px;
        }
        .itinerary-card {
          background: var(--card-background-color,#fff); border-radius: 16px;
          padding: 20px; box-shadow: 0 1px 6px rgba(0,0,0,.08);
        }
      </style>

      <div class="topbar">
        <span class="topbar-title">✈️ Travel</span>
        <div class="topbar-actions">
          ${this._trips.length > 1 ? `
            <select class="trip-select" id="trip-select">
              ${this._trips.map(t => `<option value="${t.id}" ${this._trip?.id === t.id ? "selected" : ""}>${_esc(t.name)}</option>`).join("")}
            </select>
          ` : ""}
          <button class="icon-btn" id="new-trip-btn" title="New trip">＋ Trip</button>
          <button class="icon-btn" id="refresh-btn" title="Refresh">↻</button>
        </div>
      </div>

      <div class="main">
        ${this._error ? `<div class="error">⚠️ ${_esc(this._error)}</div>` : ""}
        ${this._loading ? `<div class="loading">Loading…</div>` : ""}

        ${!this._loading && this._showNewTripForm ? `
          <div class="new-trip-form" id="new-trip-form">
            <h3>New Trip</h3>
            <input id="trip-name" type="text" placeholder="Trip name *" />
            <input id="trip-desc" type="text" placeholder="Description (optional)" />
            <div class="form-btns">
              <button class="btn-primary"  id="create-trip-btn">Create</button>
              <button class="btn-secondary" id="cancel-trip-btn">Cancel</button>
            </div>
          </div>
        ` : ""}

        ${!this._loading && !this._trip && !this._showNewTripForm ? `
          <div class="empty">
            <div style="font-size:48px">✈️</div>
            <p style="font-size:16px;margin:10px 0 4px">No trips yet</p>
            <p style="font-size:13px">Click <strong>+ Trip</strong> to get started</p>
          </div>
        ` : ""}

        ${!this._loading && this._trip ? `
          <div class="trip-header">
            <div style="flex:1">
              <div class="trip-title">${_esc(this._trip.name)}</div>
              ${this._trip.description ? `<div class="trip-desc">${_esc(this._trip.description)}</div>` : ""}
            </div>
            <div class="trip-actions">
              <button class="danger-btn" id="delete-trip-btn">Delete trip</button>
            </div>
          </div>
          <div class="itinerary-card" id="itinerary-card"></div>
        ` : ""}
      </div>
    `;

    // Wire up events
    const tripSelect = root.getElementById("trip-select");
    if (tripSelect) {
      tripSelect.addEventListener("change", () => this._loadTrip(tripSelect.value));
    }

    root.getElementById("new-trip-btn")?.addEventListener("click", () => {
      this._showNewTripForm = !this._showNewTripForm;
      this._render();
    });

    root.getElementById("refresh-btn")?.addEventListener("click", () => {
      if (this._trip) this._loadTrip(this._trip.id);
      else this._loadTrips();
    });

    root.getElementById("cancel-trip-btn")?.addEventListener("click", () => {
      this._showNewTripForm = false;
      this._render();
    });

    root.getElementById("create-trip-btn")?.addEventListener("click", async () => {
      const name = root.getElementById("trip-name")?.value.trim();
      const desc = root.getElementById("trip-desc")?.value.trim();
      if (!name) return;
      this._showNewTripForm = false;
      await this._createTrip(name, desc || null);
    });

    root.getElementById("delete-trip-btn")?.addEventListener("click", () => {
      if (this._trip) this._deleteTrip(this._trip.id);
    });

    // Mount itinerary view
    const itCard = root.getElementById("itinerary-card");
    if (itCard && this._trip) {
      const view = document.createElement("ta-itinerary-view");
      view.token     = this._token;
      view.aiEnabled = true;
      view.trip      = this._trip;
      view.addEventListener("data-changed", () => {
        if (this._trip) this._loadTrip(this._trip.id);
      });
      itCard.appendChild(view);
    }
  }
}

function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("travel-assistant-panel", TravelAssistantPanel);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "travel-assistant-panel",
  name: "Travel Assistant",
  description: "Multi-city trip planner with checklists, documents, reminders, and AI chat",
});
