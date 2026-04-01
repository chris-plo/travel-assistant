import { api } from "../api.js";

class TaChat extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); this._tripId=null; this._msgs=[]; this._loading=false; this._importMode=false; }
  set tripId(v)  { this._tripId=v; }
  set history(v) { this._msgs=(v||[]).map(m=>({role:m.role,content:m.content})); this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML=`
    <style>
      :host{display:flex;flex-direction:column;height:420px}
      .hdr{display:flex;justify-content:space-between;align-items:center;padding:0 0 8px}
      .title{font-size:13px;font-weight:600;color:#666}
      .clear{background:none;border:none;font-size:11px;color:#bbb;cursor:pointer}.clear:hover{color:#f44336}
      .msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 0}
      .bubble{max-width:85%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
      .bubble.user{align-self:flex-end;background:#03a9f4;color:#fff;border-bottom-right-radius:4px}
      .bubble.assistant{align-self:flex-start;background:#f0f0f0;color:#333;border-bottom-left-radius:4px}
      .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
      .action-chip{font-size:11px;padding:3px 8px;border-radius:10px;background:rgba(76,175,80,.15);color:#2e7d32;border:1px solid rgba(76,175,80,.3)}
      .sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
      .src{font-size:10px;padding:2px 6px;border-radius:10px;background:rgba(33,150,243,.1);color:#1565c0;text-decoration:none}
      .typing{align-self:flex-start;color:#aaa;font-size:12px;padding:6px}
      .hint{align-self:center;margin:auto;color:#ccc;font-size:13px;text-align:center}
      .input-row{display:flex;gap:8px;padding-top:10px;border-top:1px solid #eee}
      textarea{flex:1;padding:9px 12px;border:1px solid #ccc;border-radius:20px;font-size:13px;resize:none;outline:none}
      .send{padding:9px 16px;border:none;border-radius:20px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
      .send:disabled{opacity:.5;cursor:default}
      .import-btn{padding:6px 12px;border:1px solid #ddd;border-radius:20px;background:none;color:#666;cursor:pointer;font-size:12px}
      .import-btn.active{background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7}
      .import-area{display:flex;flex-direction:column;gap:6px;padding:8px 0}
      .import-area textarea{border-radius:10px;min-height:90px;resize:vertical}
      .import-hint{font-size:11px;color:#aaa}
    </style>
    <div class="hdr"><span class="title">✨ AI Travel Assistant</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="import-btn${this._importMode?" active":""}" id="import-toggle">📧 Import</button>
        <button class="clear" id="clear">Clear</button>
      </div>
    </div>
    <div class="msgs" id="msgs">
      ${this._msgs.length===0?`<div class="hint">Ask me anything about your trip,<br>or say "Remind me to check in 24h before the flight"</div>`:
        this._msgs.map(m=>this._bubble(m.role,m.content,m.actions,m.sources)).join("")}
      ${this._loading?`<div class="typing">Thinking…</div>`:""}
    </div>
    ${this._importMode ? `
    <div class="import-area">
      <div class="import-hint">Paste a booking confirmation email or itinerary text below. The AI will extract and create the segments/stays.</div>
      <textarea id="import-input" placeholder="Paste email content here…"></textarea>
    </div>` : ""}
    <div class="input-row">
      <textarea id="input" rows="1" placeholder="${this._importMode?"Add a note (optional)…":"Ask about your trip or make a change…"}"></textarea>
      <button class="send" id="send" ${this._loading?"disabled":""}>Send</button>
    </div>`;

    const input=this.shadowRoot.getElementById("input");
    this.shadowRoot.getElementById("send").addEventListener("click",()=>this._send());
    input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();this._send();}});
    this.shadowRoot.getElementById("clear").addEventListener("click",()=>{this._msgs=[];this._render();});
    this.shadowRoot.getElementById("import-toggle").addEventListener("click",()=>{this._importMode=!this._importMode;this._render();});
    const m=this.shadowRoot.getElementById("msgs"); if(m) m.scrollTop=m.scrollHeight;
  }

  _bubble(role,content,actions,sources) {
    const acts=actions?.length?`<div class="actions">${actions.map(a=>`<span class="action-chip">✓ ${_esc(a.summary)}</span>`).join("")}</div>`:"";
    const srcs=sources?.length?`<div class="sources">${sources.map(s=>`<a class="src" href="${_esc(s)}" target="_blank" rel="noopener">🔗 ${_esc(_short(s))}</a>`).join("")}</div>`:"";
    return `<div><div class="bubble ${role}">${_esc(content)}</div>${acts}${srcs}</div>`;
  }

  async _send() {
    const input=this.shadowRoot.getElementById("input");
    const importInput=this.shadowRoot.getElementById("import-input");
    let msg=input.value.trim();
    if(this._importMode && importInput?.value.trim()) {
      const pasted=importInput.value.trim();
      const prefix="Extract all travel booking information from the following text and create the corresponding segments and/or stays in the itinerary using your tools. Confirm what was created.\n\n";
      msg=prefix+pasted+(msg?"\n\n"+msg:"");
    }
    if(!msg||this._loading) return;
    input.value="";
    if(importInput) importInput.value="";
    this._importMode=false;
    this._msgs.push({role:"user",content:msg});
    this._loading=true; this._render();
    try {
      const res=await api.chat(this._tripId,msg);
      this._msgs.push({role:"assistant",content:res.reply||"(no reply)",actions:res.actions||[],sources:res.sources||[]});
      if(res.data_changed) this.dispatchEvent(new CustomEvent("data-changed",{bubbles:true,composed:true}));
    } catch(e){
      this._msgs.push({role:"assistant",content:`Error: ${e.message}`});
    } finally { this._loading=false; this._render(); }
  }
}

function _esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function _short(url){try{const u=new URL(url);return u.hostname+(u.pathname!=="/"?u.pathname.slice(0,24):"");}catch{return url.slice(0,30);}}
customElements.define("ta-chat",TaChat);
