/**
 * ta-checklist — checklist component for a travel leg.
 *
 * Properties:
 *   items   — array of checklist item objects
 *   legId   — string
 *   token   — HA auth token
 */

class TaChecklist extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items = [];
    this._legId = null;
    this._token = null;
  }

  set items(val)  { this._items = val || []; this._render(); }
  set legId(val)  { this._legId = val; }
  set token(val)  { this._token = val; }

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
    const total = this._items.length;
    const done  = this._items.filter(i => i.checked).length;
    const pct   = total ? Math.round((done / total) * 100) : 0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .progress-bar { background: var(--divider-color, #e0e0e0); border-radius: 4px; height: 6px; margin-bottom: 12px; }
        .progress-fill { background: var(--primary-color, #03a9f4); height: 100%; border-radius: 4px; transition: width .3s; }
        .summary { font-size: 12px; color: var(--secondary-text-color, #666); margin-bottom: 8px; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--divider-color, #eee); }
        li:last-child { border-bottom: none; }
        input[type=checkbox] { accent-color: var(--primary-color, #03a9f4); width: 16px; height: 16px; cursor: pointer; }
        .label { flex: 1; font-size: 14px; }
        .label.done { text-decoration: line-through; color: var(--secondary-text-color, #999); }
        .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: var(--primary-color,#03a9f4); color: #fff; white-space: nowrap; }
        .delete-btn { background: none; border: none; cursor: pointer; color: var(--secondary-text-color,#999); font-size: 16px; padding: 0 4px; }
        .delete-btn:hover { color: #f44336; }
        .add-row { display: flex; gap: 8px; margin-top: 12px; }
        .add-row input { flex: 1; padding: 6px 10px; border: 1px solid var(--divider-color,#ccc); border-radius: 6px; font-size: 13px; background: var(--card-background-color,#fff); color: var(--primary-text-color,#333); }
        .add-row button { padding: 6px 14px; border: none; border-radius: 6px; background: var(--primary-color,#03a9f4); color: #fff; cursor: pointer; font-size: 13px; }
      </style>
      <div class="summary">${done} / ${total} done</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <ul id="list">
        ${this._items.map(item => `
          <li data-id="${item.id}">
            <input type="checkbox" ${item.checked ? "checked" : ""} data-id="${item.id}">
            <span class="label ${item.checked ? "done" : ""}">${_esc(item.label)}</span>
            ${item.due_offset_hours != null ? `<span class="badge">${item.due_offset_hours}h before</span>` : ""}
            <button class="delete-btn" data-id="${item.id}" title="Remove">✕</button>
          </li>
        `).join("")}
      </ul>
      <div class="add-row">
        <input id="new-label" type="text" placeholder="Add checklist item…" />
        <button id="add-btn">Add</button>
      </div>
    `;

    this.shadowRoot.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener("change", async (e) => {
        const id = e.target.dataset.id;
        const checked = e.target.checked;
        try {
          await this._api("PATCH", `/api/travel_assistant/checklist/${id}`, { checked });
          const item = this._items.find(i => i.id === id);
          if (item) item.checked = checked;
          this._render();
        } catch { e.target.checked = !checked; }
      });
    });

    this.shadowRoot.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await this._api("DELETE", `/api/travel_assistant/checklist/${id}`);
        this._items = this._items.filter(i => i.id !== id);
        this._render();
      });
    });

    this.shadowRoot.getElementById("add-btn").addEventListener("click", () => this._addItem());
    this.shadowRoot.getElementById("new-label").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._addItem();
    });
  }

  async _addItem() {
    const input = this.shadowRoot.getElementById("new-label");
    const label = input.value.trim();
    if (!label || !this._legId) return;
    const item = await this._api("POST", `/api/travel_assistant/legs/${this._legId}/checklist`, { label });
    this._items.push(item);
    input.value = "";
    this._render();
  }
}

function _esc(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("ta-checklist", TaChecklist);
