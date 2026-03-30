import { api } from "../api.js";

class TaChecklist extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); this._items=[]; this._legId=null; }
  set items(v) { this._items=v||[]; this._render(); }
  set legId(v) { this._legId=v; }
  connectedCallback() { this._render(); }

  _render() {
    const total=this._items.length, done=this._items.filter(i=>i.checked).length;
    const pct=total?Math.round(done/total*100):0;
    this.shadowRoot.innerHTML=`
    <style>
      :host{display:block}
      .progress-bar{background:#e0e0e0;border-radius:4px;height:6px;margin-bottom:12px}
      .progress-fill{background:#03a9f4;height:100%;border-radius:4px;transition:width .3s}
      .summary{font-size:12px;color:#666;margin-bottom:8px}
      ul{list-style:none;margin:0;padding:0}
      li{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee}
      li:last-child{border-bottom:none}
      input[type=checkbox]{accent-color:#03a9f4;width:16px;height:16px;cursor:pointer}
      .label{flex:1;font-size:14px}
      .label.done{text-decoration:line-through;color:#aaa}
      .badge{font-size:10px;padding:2px 6px;border-radius:10px;background:#03a9f4;color:#fff;white-space:nowrap}
      .del{background:none;border:none;cursor:pointer;color:#bbb;font-size:16px;padding:0 4px}
      .del:hover{color:#f44336}
      .add-row{display:flex;gap:8px;margin-top:12px}
      .add-row input{flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px}
      .add-row button{padding:6px 14px;border:none;border-radius:6px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px}
    </style>
    <div class="summary">${done} / ${total} done</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <ul>${this._items.map(i=>`
      <li>
        <input type="checkbox" data-id="${i.id}" ${i.checked?"checked":""}>
        <span class="label ${i.checked?"done":""}">${_esc(i.label)}</span>
        ${i.due_offset_hours!=null?`<span class="badge">${i.due_offset_hours}h before</span>`:""}
        <button class="del" data-id="${i.id}">✕</button>
      </li>`).join("")}</ul>
    <div class="add-row">
      <input id="new-label" type="text" placeholder="Add checklist item…">
      <button id="add-btn">Add</button>
    </div>`;

    this.shadowRoot.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      cb.addEventListener("change",async e=>{
        const id=e.target.dataset.id, checked=e.target.checked;
        try { await api.patchItem(id,{checked}); const i=this._items.find(x=>x.id===id); if(i) i.checked=checked; this._render(); }
        catch { e.target.checked=!checked; }
      });
    });
    this.shadowRoot.querySelectorAll(".del").forEach(btn=>{
      btn.addEventListener("click",async()=>{ await api.deleteItem(btn.dataset.id); this._items=this._items.filter(i=>i.id!==btn.dataset.id); this._render(); });
    });
    this.shadowRoot.getElementById("add-btn").addEventListener("click",()=>this._add());
    this.shadowRoot.getElementById("new-label").addEventListener("keydown",e=>{ if(e.key==="Enter") this._add(); });
  }

  async _add() {
    const input=this.shadowRoot.getElementById("new-label"), label=input.value.trim();
    if(!label||!this._legId) return;
    const item=await api.addItem(this._legId,{label}); this._items.push(item); input.value=""; this._render();
  }
}

function _esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
customElements.define("ta-checklist",TaChecklist);
