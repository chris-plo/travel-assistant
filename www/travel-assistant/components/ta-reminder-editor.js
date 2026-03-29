/**
 * ta-reminder-editor — add/delete reminders for a leg or trip.
 *
 * Properties:
 *   reminders  — array of reminder objects
 *   parentType — "trip" | "leg"
 *   parentId   — string
 *   token      — HA auth token
 */

class TaReminderEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._reminders   = [];
    this._parentType  = "leg";
    this._parentId    = null;
    this._token       = null;
  }

  set reminders(val)   { this._reminders = val || []; this._render(); }
  set parentType(val)  { this._parentType = val; }
  set parentId(val)    { this._parentId = val; }
  set token(val)       { this._token = val; }

  connectedCallback() { this._render(); }

  async _api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this._token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .reminder-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .rem-card {
          display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
          border-radius: 8px; background: var(--secondary-background-color, #f5f5f5);
        }
        .rem-icon { font-size: 20px; }
        .rem-info { flex: 1; }
        .rem-label { font-size: 13px; font-weight: 500; color: var(--primary-text-color,#333); }
        .rem-time  { font-size: 11px; color: var(--secondary-text-color,#888); margin-top: 2px; }
        .fired-badge {
          font-size: 10px; padding: 2px 6px; border-radius: 10px;
          background: #9E9E9E; color: #fff;
        }
        .pending-badge {
          font-size: 10px; padding: 2px 6px; border-radius: 10px;
          background: var(--primary-color,#03a9f4); color: #fff;
        }
        .delete-btn { background: none; border: none; cursor: pointer; color: var(--secondary-text-color,#999); font-size: 16px; }
        .delete-btn:hover { color: #f44336; }
        .empty { color: var(--secondary-text-color,#999); font-size: 13px; padding: 4px 0 12px; }
        .add-form { display: flex; flex-direction: column; gap: 8px; }
        .add-form h4 { margin: 0; font-size: 13px; color: var(--secondary-text-color,#666); }
        .form-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .form-row input, .form-row select {
          flex: 1; min-width: 140px; padding: 7px 10px;
          border: 1px solid var(--divider-color,#ccc); border-radius: 6px;
          font-size: 13px; background: var(--card-background-color,#fff);
          color: var(--primary-text-color,#333);
        }
        .add-btn {
          padding: 8px 18px; border: none; border-radius: 6px;
          background: var(--primary-color,#03a9f4); color: #fff; cursor: pointer; font-size: 13px;
        }
        .status-msg { font-size: 11px; color: var(--secondary-text-color,#999); }
      </style>

      <div class="reminder-list">
        ${this._reminders.length === 0
          ? `<div class="empty">No reminders set.</div>`
          : this._reminders.map(r => `
          <div class="rem-card" data-id="${r.id}">
            <div class="rem-icon">🔔</div>
            <div class="rem-info">
              <div class="rem-label">${_esc(r.label)}</div>
              <div class="rem-time">${new Date(r.fire_at).toLocaleString()}</div>
            </div>
            <span class="${r.fired ? "fired-badge" : "pending-badge"}">${r.fired ? "fired" : "pending"}</span>
            <button class="delete-btn" data-id="${r.id}" title="Delete">✕</button>
          </div>
        `).join("")}
      </div>

      <div class="add-form">
        <h4>Add reminder</h4>
        <div class="form-row">
          <input id="rem-label" type="text" placeholder="Label, e.g. Check in online">
          <input id="rem-time" type="datetime-local">
        </div>
        <div class="form-row">
          <button class="add-btn" id="add-btn">Set reminder</button>
          <span class="status-msg" id="status-msg"></span>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", () => this._deleteReminder(btn.dataset.id));
    });

    this.shadowRoot.getElementById("add-btn").addEventListener("click", () => this._addReminder());
  }

  async _addReminder() {
    const label  = this.shadowRoot.getElementById("rem-label").value.trim();
    const timeEl = this.shadowRoot.getElementById("rem-time").value;
    const status = this.shadowRoot.getElementById("status-msg");

    if (!label || !timeEl) { status.textContent = "Label and time required."; return; }

    // datetime-local gives "YYYY-MM-DDTHH:mm" — append timezone offset
    const fire_at = new Date(timeEl).toISOString();

    status.textContent = "Saving…";
    try {
      const r = await this._api("POST", "/api/travel_assistant/reminders", {
        parent_type: this._parentType,
        parent_id:   this._parentId,
        label,
        fire_at,
      });
      this._reminders.push(r);
      status.textContent = "✓ Reminder set";
      this._render();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }

  async _deleteReminder(id) {
    await this._api("DELETE", `/api/travel_assistant/reminders/${id}`);
    this._reminders = this._reminders.filter(r => r.id !== id);
    this._render();
  }
}

function _esc(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("ta-reminder-editor", TaReminderEditor);
