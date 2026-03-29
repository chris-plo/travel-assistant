/**
 * ta-leg-card — full detail view for a single travel leg.
 *
 * Properties:
 *   leg      — full leg object (includes checklist_items_detail, documents_detail, reminders_detail)
 *   tripId   — string
 *   token    — HA auth token
 *   aiEnabled — boolean (show Chat tab)
 *   chatHistory — array
 */
import "./ta-checklist.js";
import "./ta-document-viewer.js";
import "./ta-reminder-editor.js";
import "./ta-chat.js";

const LEG_ICONS = {
  flight: "✈️", train: "🚆", bus: "🚌", drive: "🚗", ferry: "⛴️", other: "🧳",
};

const STATUS_COLORS = {
  upcoming:  "#2196F3", active: "#4CAF50", completed: "#9E9E9E", cancelled: "#F44336",
};

class TaLegCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._leg         = null;
    this._tripId      = null;
    this._token       = null;
    this._aiEnabled   = false;
    this._chatHistory = [];
    this._activeTab   = "checklist";
  }

  set leg(val)          { this._leg = val; this._render(); }
  set tripId(val)       { this._tripId = val; }
  set token(val)        { this._token = val; }
  set aiEnabled(val)    { this._aiEnabled = val; }
  set chatHistory(val)  { this._chatHistory = val || []; }

  connectedCallback() { this._render(); }

  _render() {
    const leg = this._leg;
    if (!leg) {
      this.shadowRoot.innerHTML = `<div style="padding:20px;color:#999">No leg selected.</div>`;
      return;
    }

    const icon   = LEG_ICONS[leg.type] || "🧳";
    const color  = STATUS_COLORS[leg.status] || "#607D8B";
    const depart = new Date(leg.depart_at).toLocaleString();
    const arrive = leg.arrive_at ? new Date(leg.arrive_at).toLocaleString() : null;
    const tabs   = ["checklist", "documents", "reminders", ...(this._aiEnabled ? ["chat"] : [])];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; background: var(--card-background-color,#fff); border-radius: 16px; overflow: hidden; }
        .header {
          padding: 18px 20px; display: flex; align-items: flex-start; gap: 14px;
          background: linear-gradient(135deg, ${color}22, ${color}08);
          border-bottom: 1px solid var(--divider-color,#eee);
        }
        .header-icon { font-size: 32px; line-height: 1; }
        .header-info { flex: 1; }
        .route { font-size: 20px; font-weight: 700; color: var(--primary-text-color,#222); }
        .carrier { font-size: 13px; color: var(--secondary-text-color,#666); margin-top: 2px; }
        .times { font-size: 12px; color: var(--secondary-text-color,#888); margin-top: 4px; }
        .status-badge {
          padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
          color: #fff; background: ${color}; align-self: flex-start; white-space: nowrap;
        }
        .notes { padding: 10px 20px 0; font-size: 12px; color: var(--secondary-text-color,#888); }
        .tab-bar {
          display: flex; padding: 0 20px; border-bottom: 1px solid var(--divider-color,#eee);
          gap: 4px; overflow-x: auto;
        }
        .tab {
          padding: 10px 16px; font-size: 13px; font-weight: 500; cursor: pointer;
          border: none; background: none; color: var(--secondary-text-color,#888);
          border-bottom: 2px solid transparent; white-space: nowrap;
        }
        .tab.active { color: var(--primary-color,#03a9f4); border-bottom-color: var(--primary-color,#03a9f4); }
        .tab-content { padding: 16px 20px; }
        .edit-row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
        .status-select {
          padding: 6px 10px; border: 1px solid var(--divider-color,#ccc); border-radius: 6px;
          font-size: 13px; background: var(--card-background-color,#fff); color: var(--primary-text-color,#333);
        }
        .save-btn {
          padding: 6px 14px; border: none; border-radius: 6px;
          background: var(--primary-color,#03a9f4); color: #fff; cursor: pointer; font-size: 13px;
        }
        .save-status { font-size: 11px; color: var(--secondary-text-color,#999); align-self: center; }
      </style>

      <div class="header">
        <div class="header-icon">${icon}</div>
        <div class="header-info">
          <div class="route">${_esc(leg.origin)} → ${_esc(leg.destination)}</div>
          <div class="carrier">
            ${leg.carrier ? _esc(leg.carrier) : ""}
            ${leg.flight_number ? `· ${_esc(leg.flight_number)}` : ""}
          </div>
          <div class="times">
            🛫 ${depart}${arrive ? ` &nbsp;→&nbsp; 🛬 ${arrive}` : ""}
          </div>
          <div class="edit-row">
            <select class="status-select" id="status-select">
              ${["upcoming","active","completed","cancelled"].map(s =>
                `<option value="${s}" ${s === leg.status ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
            <button class="save-btn" id="save-status">Update status</button>
            <span class="save-status" id="save-msg"></span>
          </div>
        </div>
        <div class="status-badge">${leg.status}</div>
      </div>

      ${leg.notes ? `<div class="notes">📝 ${_esc(leg.notes)}</div>` : ""}

      <div class="tab-bar">
        ${tabs.map(t => `
          <button class="tab ${t === this._activeTab ? "active" : ""}" data-tab="${t}">
            ${t === "checklist" ? "☑️ Checklist" : t === "documents" ? "📎 Documents" : t === "reminders" ? "🔔 Reminders" : "✨ Chat"}
          </button>
        `).join("")}
      </div>

      <div class="tab-content" id="tab-content"></div>
    `;

    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => {
        this._activeTab = btn.dataset.tab;
        this._renderTab();
        this.shadowRoot.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === this._activeTab));
      });
    });

    this.shadowRoot.getElementById("save-status").addEventListener("click", async () => {
      const status = this.shadowRoot.getElementById("status-select").value;
      const msg    = this.shadowRoot.getElementById("save-msg");
      msg.textContent = "Saving…";
      try {
        await fetch(`/api/travel_assistant/legs/${leg.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${this._token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        msg.textContent = "✓ Saved";
        this.dispatchEvent(new CustomEvent("status-changed", { detail: { legId: leg.id, status }, bubbles: true, composed: true }));
      } catch (err) { msg.textContent = `Error: ${err.message}`; }
    });

    this._renderTab();
  }

  _renderTab() {
    const leg     = this._leg;
    const content = this.shadowRoot.getElementById("tab-content");
    if (!content || !leg) return;

    content.innerHTML = "";

    if (this._activeTab === "checklist") {
      const el = document.createElement("ta-checklist");
      el.token  = this._token;
      el.legId  = leg.id;
      el.items  = leg.checklist_items_detail || [];
      content.appendChild(el);

    } else if (this._activeTab === "documents") {
      const el = document.createElement("ta-document-viewer");
      el.token     = this._token;
      el.legId     = leg.id;
      el.documents = leg.documents_detail || [];
      content.appendChild(el);

    } else if (this._activeTab === "reminders") {
      const el = document.createElement("ta-reminder-editor");
      el.token      = this._token;
      el.parentType = "leg";
      el.parentId   = leg.id;
      el.reminders  = leg.reminders_detail || [];
      content.appendChild(el);

    } else if (this._activeTab === "chat") {
      const el = document.createElement("ta-chat");
      el.token   = this._token;
      el.tripId  = this._tripId;
      el.history = this._chatHistory;
      el.addEventListener("data-changed", () => {
        this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
      });
      content.appendChild(el);
    }
  }
}

function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("ta-leg-card", TaLegCard);
