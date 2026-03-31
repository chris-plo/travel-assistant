/**
 * ta-tasks — unified checklist + reminders component.
 * Each task row shows: checkbox | label | 🔔 (reminder) | ✕ delete
 * Clicking 🔔 expands an inline reminder panel per item.
 */
import { api } from "../api.js";

function _esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

class TaTasks extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items      = [];
    this._reminders  = [];
    this._parentType = "leg";
    this._parentId   = null;
    this._expanded   = null; // checklist item id whose reminder panel is open
  }

  set items(v)      { this._items = v || []; this._render(); }
  set reminders(v)  { this._reminders = v || []; this._render(); }
  set parentType(v) { this._parentType = v; }
  set parentId(v)   { this._parentId = v; }
  connectedCallback() { this._render(); }

  _reminderForItem(itemId) {
    return this._reminders.find(r => r.checklist_item_id === itemId) || null;
  }

  _render() {
    const total = this._items.length;
    const done  = this._items.filter(i => i.checked).length;
    const pct   = total ? Math.round(done / total * 100) : 0;

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:block}
      .summary{font-size:12px;color:#666;margin-bottom:6px}
      .progress-bar{background:#e0e0e0;border-radius:4px;height:6px;margin-bottom:12px}
      .progress-fill{background:#03a9f4;height:100%;border-radius:4px;transition:width .3s}
      ul{list-style:none;margin:0;padding:0}
      li.task-row{border-bottom:1px solid #f0f0f0}
      li.task-row:last-child{border-bottom:none}
      .row-main{display:flex;align-items:center;gap:8px;padding:7px 0}
      input[type=checkbox]{accent-color:#03a9f4;width:16px;height:16px;cursor:pointer;flex-shrink:0}
      .label{flex:1;font-size:14px;word-break:break-word}
      .label.done{text-decoration:line-through;color:#aaa}
      .icon-btn{background:none;border:none;cursor:pointer;font-size:16px;padding:2px 4px;border-radius:6px;transition:background .1s;flex-shrink:0;line-height:1}
      .icon-btn:hover{background:#f0f0f0}
      .bell-btn{color:#aaa}
      .bell-btn.has-reminder{color:#FF9800}
      .del-btn{color:#bbb}
      .del-btn:hover{color:#f44336}
      /* inline reminder panel */
      .reminder-panel{margin:0 0 8px 24px;padding:10px 12px;background:#fff8e1;border-radius:8px;border-left:3px solid #FF9800;display:flex;flex-direction:column;gap:8px}
      .rp-info{font-size:12px;color:#555}
      .rp-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
      .badge{font-size:10px;padding:2px 7px;border-radius:10px;color:#fff;font-weight:500}
      .b-done{background:#9E9E9E}.b-pending{background:#03a9f4}.b-repeat{background:#FF9800}
      .rp-actions{display:flex;gap:6px;flex-wrap:wrap}
      .rp-btn{padding:4px 10px;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:500}
      .rp-done{background:#4CAF50;color:#fff}
      .rp-del{background:none;color:#f44336;border:1px solid #fcc}
      /* mini form to create reminder */
      .rp-form{display:flex;flex-direction:column;gap:6px}
      .rp-form label{font-size:11px;color:#777}
      .rp-form input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px}
      .rp-form .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .rp-form .row input{flex:1;min-width:140px}
      .rp-form .row input[type=number]{max-width:90px}
      .rp-save{padding:5px 14px;border:none;border-radius:6px;background:#FF9800;color:#fff;cursor:pointer;font-size:12px}
      .rp-cancel{padding:5px 10px;border:none;border-radius:6px;background:none;color:#888;border:1px solid #ddd;cursor:pointer;font-size:12px}
      .rp-status{font-size:11px;color:#888}
      /* add task row */
      .add-row{display:flex;gap:8px;margin-top:12px}
      .add-row input{flex:1;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px}
      .add-row button{padding:7px 14px;border:none;border-radius:6px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
      .empty{color:#aaa;font-size:13px;padding:4px 0 8px}
    </style>

    ${total > 0 ? `
      <div class="summary">${done} / ${total} done</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    ` : `<div class="empty">No tasks yet.</div>`}

    <ul>
      ${this._items.map(item => this._itemHtml(item)).join("")}
    </ul>

    <div class="add-row">
      <input id="new-task" type="text" placeholder="Add task…">
      <button id="add-task-btn">Add</button>
    </div>`;

    // Checkbox toggles
    this.shadowRoot.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", async e => {
        const id = e.target.dataset.id;
        const checked = e.target.checked;
        try {
          await api.patchItem(id, { checked });
          const item = this._items.find(x => x.id === id);
          if (item) item.checked = checked;
          this._render();
        } catch { e.target.checked = !checked; }
      });
    });

    // Delete task
    this.shadowRoot.querySelectorAll(".del-btn[data-item]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await api.deleteItem(btn.dataset.item);
        this._items = this._items.filter(i => i.id !== btn.dataset.item);
        // also drop linked reminders
        this._reminders = this._reminders.filter(r => r.checklist_item_id !== btn.dataset.item);
        if (this._expanded === btn.dataset.item) this._expanded = null;
        this._render();
      });
    });

    // Bell toggle
    this.shadowRoot.querySelectorAll(".bell-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.item;
        this._expanded = this._expanded === id ? null : id;
        this._render();
      });
    });

    // Reminder actions (done, delete) inside panels
    this.shadowRoot.querySelectorAll(".rp-done").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rid = btn.dataset.rid;
        try {
          const updated = await api.markReminderDone(rid);
          const idx = this._reminders.findIndex(r => r.id === rid);
          if (idx >= 0) this._reminders[idx] = updated;
          this._render();
        } catch(e) { console.error("markDone error", e); }
      });
    });
    this.shadowRoot.querySelectorAll(".rp-del").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rid = btn.dataset.rid;
        await api.deleteReminder(rid);
        this._reminders = this._reminders.filter(r => r.id !== rid);
        this._render();
      });
    });

    // Save new reminder from mini-form
    this.shadowRoot.querySelectorAll(".rp-save").forEach(btn => {
      btn.addEventListener("click", () => this._saveReminderForItem(btn.dataset.item));
    });
    this.shadowRoot.querySelectorAll(".rp-cancel").forEach(btn => {
      btn.addEventListener("click", () => { this._expanded = null; this._render(); });
    });

    // Add task
    const addBtn   = this.shadowRoot.getElementById("add-task-btn");
    const newInput = this.shadowRoot.getElementById("new-task");
    const doAdd = () => this._addTask(newInput);
    addBtn.addEventListener("click", doAdd);
    newInput.addEventListener("keydown", e => { if (e.key === "Enter") doAdd(); });
  }

  _itemHtml(item) {
    const rem     = this._reminderForItem(item.id);
    const isOpen  = this._expanded === item.id;
    const hasBell = !!rem;

    return `
    <li class="task-row">
      <div class="row-main">
        <input type="checkbox" data-id="${item.id}" ${item.checked ? "checked" : ""}>
        <span class="label${item.checked ? " done" : ""}">${_esc(item.label)}</span>
        <button class="icon-btn bell-btn${hasBell ? " has-reminder" : ""}" data-item="${item.id}" title="${hasBell ? "View reminder" : "Add reminder"}">🔔</button>
        <button class="icon-btn del-btn" data-item="${item.id}" title="Delete task">✕</button>
      </div>
      ${isOpen ? (rem ? this._reminderInfoHtml(item.id, rem) : this._reminderFormHtml(item.id)) : ""}
    </li>`;
  }

  _reminderInfoHtml(itemId, rem) {
    const badges = [
      rem.done ? `<span class="badge b-done">✓ Done</span>` : `<span class="badge b-pending">Pending</span>`,
      rem.repeat_interval_hours ? `<span class="badge b-repeat">🔄 ${rem.repeat_interval_hours}h</span>` : "",
    ].join("");
    return `
    <div class="reminder-panel">
      <div class="rp-info">
        🔔 ${_esc(rem.label || "")}
        <br><span style="font-size:11px;color:#999">${new Date(rem.fire_at).toLocaleString()}</span>
        <div class="rp-badges">${badges}</div>
      </div>
      <div class="rp-actions">
        ${!rem.done ? `<button class="rp-btn rp-done" data-rid="${rem.id}">✓ Done</button>` : ""}
        <button class="rp-btn rp-del" data-rid="${rem.id}">🗑 Delete</button>
      </div>
    </div>`;
  }

  _reminderFormHtml(itemId) {
    return `
    <div class="reminder-panel">
      <div class="rp-form">
        <label>Remind at</label>
        <div class="row">
          <input type="datetime-local" id="rp-time-${itemId}">
          <input type="number" id="rp-repeat-${itemId}" min="0.5" step="0.5" placeholder="repeat (h, opt.)">
        </div>
        <div class="row">
          <button class="rp-save" data-item="${itemId}">Set reminder</button>
          <button class="rp-cancel">Cancel</button>
          <span class="rp-status" id="rp-st-${itemId}"></span>
        </div>
      </div>
    </div>`;
  }

  async _saveReminderForItem(itemId) {
    const item   = this._items.find(i => i.id === itemId);
    const timeEl = this.shadowRoot.getElementById(`rp-time-${itemId}`);
    const repEl  = this.shadowRoot.getElementById(`rp-repeat-${itemId}`);
    const stEl   = this.shadowRoot.getElementById(`rp-st-${itemId}`);
    if (!timeEl?.value) { if (stEl) stEl.textContent = "Time required."; return; }
    if (stEl) stEl.textContent = "Saving…";
    try {
      const body = {
        parent_type: this._parentType,
        parent_id:   this._parentId,
        label:       item ? item.label : "Reminder",
        fire_at:     new Date(timeEl.value).toISOString(),
        checklist_item_id: itemId,
      };
      const repeat = parseFloat(repEl?.value);
      if (repeat > 0) body.repeat_interval_hours = repeat;
      const r = await api.createReminder(body);
      this._reminders.push(r);
      this._expanded = null;
      this._render();
    } catch(e) { if (stEl) stEl.textContent = `Error: ${e.message}`; }
  }

  async _addTask(input) {
    const label = input?.value.trim();
    if (!label || !this._parentId) return;
    const item = this._parentType === "stay"
      ? await api.addStayChecklistItem(this._parentId, { label })
      : await api.addItem(this._parentId, { label });
    this._items.push(item);
    if (input) input.value = "";
    this._render();
  }
}

customElements.define("ta-tasks", TaTasks);
