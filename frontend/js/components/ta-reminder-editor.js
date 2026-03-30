import { api } from "../api.js";

class TaReminderEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); this._reminders=[]; this._parentType="leg"; this._parentId=null; }
  set reminders(v)   { this._reminders=v||[]; this._render(); }
  set parentType(v)  { this._parentType=v; }
  set parentId(v)    { this._parentId=v; }
  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML=`
    <style>
      :host{display:block}
      .list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
      .card{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;background:#f5f5f5}
      .ico{font-size:20px}.info{flex:1}
      .label{font-size:13px;font-weight:500}.time{font-size:11px;color:#888;margin-top:2px}
      .fired{font-size:10px;padding:2px 6px;border-radius:10px;background:#9E9E9E;color:#fff}
      .pending{font-size:10px;padding:2px 6px;border-radius:10px;background:#03a9f4;color:#fff}
      .del{background:none;border:none;cursor:pointer;color:#bbb;font-size:16px}.del:hover{color:#f44336}
      .empty{color:#aaa;font-size:13px;padding:4px 0 12px}
      .form{display:flex;flex-direction:column;gap:8px}
      .form h4{margin:0;font-size:13px;color:#666}
      .row{display:flex;gap:8px;flex-wrap:wrap}
      .row input{flex:1;min-width:140px;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px}
      .add-btn{padding:8px 18px;border:none;border-radius:6px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px}
      .status{font-size:11px;color:#888}
    </style>
    <div class="list">
      ${this._reminders.length===0?`<div class="empty">No reminders set.</div>`:
        this._reminders.map(r=>`
        <div class="card">
          <div class="ico">🔔</div>
          <div class="info">
            <div class="label">${_esc(r.label)}</div>
            <div class="time">${new Date(r.fire_at).toLocaleString()}</div>
          </div>
          <span class="${r.fired?"fired":"pending"}">${r.fired?"fired":"pending"}</span>
          <button class="del" data-id="${r.id}">✕</button>
        </div>`).join("")}
    </div>
    <div class="form">
      <h4>Add reminder</h4>
      <div class="row">
        <input id="label" type="text" placeholder="Label, e.g. Check in online">
        <input id="time" type="datetime-local">
      </div>
      <div class="row">
        <button class="add-btn" id="add">Set reminder</button>
        <span class="status" id="status"></span>
      </div>
    </div>`;

    this.shadowRoot.querySelectorAll(".del").forEach(b=>b.addEventListener("click",async()=>{
      await api.deleteReminder(b.dataset.id); this._reminders=this._reminders.filter(r=>r.id!==b.dataset.id); this._render();
    }));
    this.shadowRoot.getElementById("add").addEventListener("click",()=>this._add());
  }

  async _add() {
    const label=this.shadowRoot.getElementById("label").value.trim();
    const time=this.shadowRoot.getElementById("time").value;
    const st=this.shadowRoot.getElementById("status");
    if(!label||!time){st.textContent="Label and time required.";return;}
    st.textContent="Saving…";
    try {
      const r=await api.createReminder({parent_type:this._parentType,parent_id:this._parentId,label,fire_at:new Date(time).toISOString()});
      this._reminders.push(r); st.textContent="✓ Set"; this._render();
    } catch(e){st.textContent=`Error: ${e.message}`;}
  }
}

function _esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
customElements.define("ta-reminder-editor",TaReminderEditor);
