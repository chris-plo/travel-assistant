import { api } from "../api.js";

class TaReminderEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._reminders = [];
    this._parentType = "leg";
    this._parentId = null;
    this._postponingId = null;
  }
  set reminders(v)   { this._reminders = v || []; this._render(); }
  set parentType(v)  { this._parentType = v; }
  set parentId(v)    { this._parentId = v; }
  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML = `
    <style>
      :host{display:block}
      .list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
      .card{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;background:#f5f5f5;transition:opacity .2s}
      .card.done-card{opacity:.65;background:#f0f0f0}
      .ico{font-size:20px;flex-shrink:0}
      .info{flex:1;min-width:0}
      .label{font-size:13px;font-weight:500;word-break:break-word}
      .time{font-size:11px;color:#888;margin-top:2px}
      .badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
      .badge{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:500;color:#fff}
      .b-done{background:#9E9E9E}
      .b-fired{background:#9E9E9E}
      .b-pending{background:#03a9f4}
      .b-repeat{background:#FF9800}
      .actions{display:flex;flex-direction:column;gap:4px;flex-shrink:0}
      .act-btn{padding:3px 9px;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:500;white-space:nowrap}
      .done-btn{background:#4CAF50;color:#fff}
      .postpone-btn{background:#FF9800;color:#fff}
      .del-btn{background:none;color:#bbb;font-size:15px;border:none;cursor:pointer;padding:2px 4px}.del-btn:hover{color:#f44336}
      .postpone-form{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#fff3e0;border-radius:6px;margin-top:4px}
      .postpone-form input{padding:5px 8px;border:1px solid #ccc;border-radius:6px;font-size:12px;flex:1;min-width:140px}
      .save-btn{padding:5px 12px;border:none;border-radius:6px;background:#FF9800;color:#fff;cursor:pointer;font-size:12px}
      .cancel-btn{padding:5px 10px;border:none;border-radius:6px;background:none;color:#888;cursor:pointer;font-size:12px;border:1px solid #ddd}
      .empty{color:#aaa;font-size:13px;padding:4px 0 12px}
      .form{display:flex;flex-direction:column;gap:8px}
      .form h4{margin:0;font-size:13px;color:#666}
      .row{display:flex;gap:8px;flex-wrap:wrap}
      .row input{flex:1;min-width:140px;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px}
      .row input[type=number]{max-width:100px}
      .row label{font-size:12px;color:#666;display:flex;align-items:center;gap:6px;white-space:nowrap}
      .add-btn{padding:8px 18px;border:none;border-radius:6px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px}
      .status{font-size:11px;color:#888}
    </style>
    <div class="list">
      ${this._reminders.length === 0
        ? `<div class="empty">No reminders set.</div>`
        : this._reminders.map(r => this._cardHtml(r)).join("")}
    </div>
    <div class="form">
      <h4>Add reminder</h4>
      <div class="row">
        <input id="r-label" type="text" placeholder="Label, e.g. Check in online">
        <input id="r-time"  type="datetime-local">
      </div>
      <div class="row">
        <label>🔄 Repeat every <input id="r-repeat" type="number" min="0.5" step="0.5" placeholder="hours (optional)"> h</label>
      </div>
      <div class="row">
        <button class="add-btn" id="r-add">Set reminder</button>
        <span class="status" id="r-status"></span>
      </div>
    </div>`;

    // Delete buttons
    this.shadowRoot.querySelectorAll(".del-btn").forEach(b => b.addEventListener("click", () => this._delete(b.dataset.id)));

    // Done buttons
    this.shadowRoot.querySelectorAll(".done-btn").forEach(b => b.addEventListener("click", () => this._markDone(b.dataset.id)));

    // Postpone buttons
    this.shadowRoot.querySelectorAll(".postpone-btn").forEach(b => b.addEventListener("click", () => {
      this._postponingId = this._postponingId === b.dataset.id ? null : b.dataset.id;
      this._render();
    }));

    // Save postpone
    this.shadowRoot.querySelectorAll(".save-btn").forEach(b => b.addEventListener("click", () => this._savePostpone(b.dataset.id)));
    this.shadowRoot.querySelectorAll(".cancel-btn").forEach(b => b.addEventListener("click", () => { this._postponingId = null; this._render(); }));

    this.shadowRoot.getElementById("r-add").addEventListener("click", () => this._add());
  }

  _cardHtml(r) {
    const isPostponing = this._postponingId === r.id;
    const badges = [
      r.done   ? `<span class="badge b-done">✓ Done</span>` : r.fired ? `<span class="badge b-fired">Fired</span>` : `<span class="badge b-pending">Pending</span>`,
      r.repeat_interval_hours ? `<span class="badge b-repeat">🔄 ${r.repeat_interval_hours}h</span>` : "",
    ].join("");

    return `
    <div>
      <div class="card${r.done ? " done-card" : ""}">
        <div class="ico">🔔</div>
        <div class="info">
          <div class="label">${_esc(r.label)}</div>
          <div class="time">${new Date(r.fire_at).toLocaleString()}</div>
          <div class="badges">${badges}</div>
        </div>
        <div class="actions">
          ${!r.done ? `<button class="act-btn done-btn" data-id="${r.id}">✓ Done</button>` : ""}
          <button class="act-btn postpone-btn" data-id="${r.id}">⏰ Postpone</button>
          <button class="del-btn" data-id="${r.id}">✕</button>
        </div>
      </div>
      ${isPostponing ? `
        <div class="postpone-form">
          <input type="datetime-local" id="pp-time-${r.id}">
          <button class="save-btn" data-id="${r.id}">Save</button>
          <button class="cancel-btn">Cancel</button>
        </div>` : ""}
    </div>`;
  }

  async _delete(id) {
    await api.deleteReminder(id);
    this._reminders = this._reminders.filter(r => r.id !== id);
    if (this._postponingId === id) this._postponingId = null;
    this._render();
  }

  async _markDone(id) {
    try {
      const updated = await api.markReminderDone(id);
      const idx = this._reminders.findIndex(r => r.id === id);
      if (idx >= 0) this._reminders[idx] = updated;
      this._render();
    } catch(e) { console.error("markDone error", e); }
  }

  async _savePostpone(id) {
    const input = this.shadowRoot.getElementById(`pp-time-${id}`);
    if (!input?.value) return;
    try {
      const updated = await api.updateReminder(id, { fire_at: new Date(input.value).toISOString(), fired: false });
      const idx = this._reminders.findIndex(r => r.id === id);
      if (idx >= 0) this._reminders[idx] = updated;
      this._postponingId = null;
      this._render();
    } catch(e) { console.error("postpone error", e); }
  }

  async _add() {
    const label  = this.shadowRoot.getElementById("r-label").value.trim();
    const time   = this.shadowRoot.getElementById("r-time").value;
    const repeat = parseFloat(this.shadowRoot.getElementById("r-repeat").value) || null;
    const st     = this.shadowRoot.getElementById("r-status");
    if (!label || !time) { st.textContent = "Label and time required."; return; }
    st.textContent = "Saving…";
    try {
      const body = { parent_type: this._parentType, parent_id: this._parentId, label, fire_at: new Date(time).toISOString() };
      if (repeat) body.repeat_interval_hours = repeat;
      const r = await api.createReminder(body);
      this._reminders.push(r);
      st.textContent = "✓ Set";
      this._render();
    } catch(e) { st.textContent = `Error: ${e.message}`; }
  }
}

function _esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
customElements.define("ta-reminder-editor", TaReminderEditor);
