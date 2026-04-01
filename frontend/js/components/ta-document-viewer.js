import { api } from "../api.js";

class TaDocumentViewer extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); this._docs=[]; this._legId=null; this._parentType="leg"; }
  set documents(v)  { this._docs=v||[]; this._render(); }
  set legId(v)      { this._legId=v; }
  set parentType(v) { this._parentType=v; }
  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML=`
    <style>
      :host{display:block}
      .list{display:flex;flex-direction:column;gap:8px}
      .card{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:#f5f5f5}
      .icon{font-size:24px}.info{flex:1}
      .name{font-size:13px;font-weight:500}.meta{font-size:11px;color:#888;margin-top:2px}
      .btn{padding:4px 10px;border:none;border-radius:6px;cursor:pointer;font-size:12px}
      .view{background:#03a9f4;color:#fff}.del{background:none;color:#aaa}.del:hover{color:#f44336}
      .empty{color:#aaa;font-size:13px;padding:4px 0 12px}
      .upload{display:flex;gap:8px;margin-top:12px;align-items:center}
      .upload label{padding:7px 16px;border-radius:6px;background:#03a9f4;color:#fff;cursor:pointer;font-size:13px}
      .upload input[type=file]{display:none}
      .status{font-size:11px;color:#888}
      .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center}
      .modal.open{display:flex}
      .modal-box{background:#fff;border-radius:12px;padding:16px;max-width:96vw;max-height:96vh;display:flex;flex-direction:column;gap:10px}
      .modal-hdr{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .modal-title{font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .close-btn{background:none;border:none;font-size:20px;cursor:pointer;flex-shrink:0}
      .open-tab-btn{padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:12px;cursor:pointer;color:#03a9f4;flex-shrink:0}
      .open-tab-btn:hover{background:#e3f2fd}
      iframe.frame{width:85vw;height:80vh;border:none;border-radius:8px}
      img.img{max-width:85vw;max-height:80vh;border-radius:8px}
    </style>
    <div class="list">
      ${this._docs.length===0?`<div class="empty">No documents attached.</div>`:
        this._docs.map(d=>`
        <div class="card">
          <div class="icon">${_icon(d.mime_type)}</div>
          <div class="info">
            <div class="name">${_esc(d.filename)}</div>
            <div class="meta">${d.mime_type} · ${new Date(d.uploaded_at).toLocaleDateString()}</div>
          </div>
          <button class="btn view" data-id="${d.id}" data-name="${_esc(d.filename)}" data-mime="${d.mime_type}">View</button>
          <button class="btn del" data-id="${d.id}">✕</button>
        </div>`).join("")}
    </div>
    <div class="upload">
      <label>📎 Attach file<input type="file" id="file-input" accept="application/pdf,image/*"></label>
      <span class="status" id="status"></span>
    </div>
    <div class="modal" id="modal">
      <div class="modal-box">
        <div class="modal-hdr">
          <span class="modal-title" id="modal-title"></span>
          <a class="open-tab-btn" id="open-tab" target="_blank" rel="noopener" style="display:none">↗ New tab</a>
          <button class="close-btn" id="close">✕</button>
        </div>
        <div id="modal-content"></div>
      </div>
    </div>`;

    this.shadowRoot.querySelectorAll(".view").forEach(b=>b.addEventListener("click",()=>this._view(b.dataset.id,b.dataset.name,b.dataset.mime)));
    this.shadowRoot.querySelectorAll(".del").forEach(b=>b.addEventListener("click",()=>this._delete(b.dataset.id)));
    this.shadowRoot.getElementById("file-input").addEventListener("change",e=>{ if(e.target.files[0]) this._upload(e.target.files[0]); });
    this.shadowRoot.getElementById("close").addEventListener("click",()=>{
      const modal=this.shadowRoot.getElementById("modal");
      modal.classList.remove("open");
      // Clear iframe src to stop background rendering/network activity
      const f=modal.querySelector("iframe");
      if(f) f.src="";
    });
  }

  async _view(id,name,mime) {
    const st=this.shadowRoot.getElementById("status");
    const modal=this.shadowRoot.getElementById("modal");
    const cnt=this.shadowRoot.getElementById("modal-content");
    const titleEl=this.shadowRoot.getElementById("modal-title");
    const openTab=this.shadowRoot.getElementById("open-tab");
    titleEl.textContent=name; cnt.innerHTML="";

    if(mime==="application/pdf") {
      // Serve via raw endpoint — avoids browser data: URL iframe restrictions
      const rawUrl=`./api/documents/${id}/raw`;
      openTab.href=rawUrl; openTab.style.display="";
      const f=document.createElement("iframe");
      f.className="frame"; f.src=rawUrl; cnt.appendChild(f);
      modal.classList.add("open"); st.textContent="";
    } else {
      openTab.style.display="none";
      st.textContent="Loading…";
      try {
        const data=await api.getDocument(id);
        const i=document.createElement("img");
        i.className="img"; i.src=`data:${mime};base64,${data.content}`; cnt.appendChild(i);
        modal.classList.add("open"); st.textContent="";
      } catch(e){ st.textContent=`Error: ${e.message}`; }
    }
  }

  async _delete(id) {
    if(!confirm("Delete this document?")) return;
    await api.deleteDocument(id); this._docs=this._docs.filter(d=>d.id!==id); this._render();
  }

  async _upload(file) {
    const st=this.shadowRoot.getElementById("status"); st.textContent="Uploading…";
    try {
      const b64=await _toBase64(file);
      const uploadFn = this._parentType === "stay" ? api.uploadStayDocument : api.uploadDocument;
      const doc=await uploadFn(this._legId,{filename:file.name,mime_type:file.type||"application/octet-stream",content:b64});
      this._docs.push(doc); st.textContent="✓ Uploaded"; this._render();
    } catch(e){ st.textContent=`Error: ${e.message}`; }
  }
}

function _toBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const s=r.result,c=s.indexOf(",");res(c>=0?s.slice(c+1):s);};r.onerror=rej;r.readAsDataURL(file);});}
function _icon(m){return m==="application/pdf"?"📄":m.startsWith("image/")?"🖼️":"📎";}
function _esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
customElements.define("ta-document-viewer",TaDocumentViewer);
