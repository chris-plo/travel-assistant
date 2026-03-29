/**
 * ta-document-viewer — document upload/view/delete for a travel leg.
 *
 * Properties:
 *   documents — array of document metadata objects
 *   legId     — string
 *   token     — HA auth token
 */

class TaDocumentViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._documents = [];
    this._legId = null;
    this._token = null;
  }

  set documents(val) { this._documents = val || []; this._render(); }
  set legId(val)     { this._legId = val; }
  set token(val)     { this._token = val; }

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
        .doc-list { display: flex; flex-direction: column; gap: 8px; }
        .doc-card {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 8px;
          background: var(--secondary-background-color, #f5f5f5);
        }
        .doc-icon { font-size: 24px; }
        .doc-info { flex: 1; }
        .doc-name { font-size: 13px; font-weight: 500; color: var(--primary-text-color,#333); }
        .doc-meta { font-size: 11px; color: var(--secondary-text-color,#888); }
        .btn { padding: 4px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; }
        .btn-view   { background: var(--primary-color,#03a9f4); color: #fff; }
        .btn-delete { background: transparent; color: var(--secondary-text-color,#999); }
        .btn-delete:hover { color: #f44336; }
        .upload-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
        .upload-row label {
          padding: 7px 16px; border-radius: 6px;
          background: var(--primary-color,#03a9f4); color: #fff;
          cursor: pointer; font-size: 13px;
        }
        .upload-row input[type=file] { display: none; }
        .upload-hint { font-size: 11px; color: var(--secondary-text-color,#999); }
        .empty { color: var(--secondary-text-color,#999); font-size: 13px; padding: 8px 0; }
        /* modal */
        .modal-overlay {
          display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6);
          z-index: 9999; align-items: center; justify-content: center;
        }
        .modal-overlay.open { display: flex; }
        .modal-box {
          background: var(--card-background-color,#fff);
          border-radius: 12px; padding: 16px;
          max-width: 90vw; max-height: 90vh;
          display: flex; flex-direction: column; gap: 10px;
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; }
        .modal-title { font-size: 14px; font-weight: 600; }
        .modal-close { background: none; border: none; font-size: 20px; cursor: pointer; }
        iframe.doc-frame { width: 80vw; height: 75vh; border: none; border-radius: 8px; }
        img.doc-img { max-width: 80vw; max-height: 75vh; border-radius: 8px; }
      </style>

      <div class="doc-list">
        ${this._documents.length === 0
          ? `<div class="empty">No documents attached.</div>`
          : this._documents.map(doc => `
          <div class="doc-card" data-id="${doc.id}">
            <div class="doc-icon">${_docIcon(doc.mime_type)}</div>
            <div class="doc-info">
              <div class="doc-name">${_esc(doc.filename)}</div>
              <div class="doc-meta">${doc.mime_type} · ${new Date(doc.uploaded_at).toLocaleDateString()}</div>
            </div>
            <button class="btn btn-view" data-id="${doc.id}" data-name="${_esc(doc.filename)}" data-mime="${doc.mime_type}">View</button>
            <button class="btn btn-delete" data-id="${doc.id}" title="Delete">✕</button>
          </div>
        `).join("")}
      </div>

      <div class="upload-row">
        <label>
          📎 Attach file
          <input type="file" id="file-input" accept="application/pdf,image/*">
        </label>
        <span class="upload-hint" id="upload-status"></span>
      </div>

      <div class="modal-overlay" id="modal">
        <div class="modal-box">
          <div class="modal-header">
            <span class="modal-title" id="modal-title"></span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-content"></div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll(".btn-view").forEach(btn => {
      btn.addEventListener("click", () => this._viewDocument(btn.dataset.id, btn.dataset.name, btn.dataset.mime));
    });

    this.shadowRoot.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", () => this._deleteDocument(btn.dataset.id));
    });

    this.shadowRoot.getElementById("file-input").addEventListener("change", (e) => {
      if (e.target.files[0]) this._uploadFile(e.target.files[0]);
    });

    this.shadowRoot.getElementById("modal-close").addEventListener("click", () => {
      this.shadowRoot.getElementById("modal").classList.remove("open");
    });
  }

  async _viewDocument(docId, filename, mimeType) {
    const statusEl = this.shadowRoot.getElementById("upload-status");
    statusEl.textContent = "Loading…";
    try {
      const data = await this._api("GET", `/api/travel_assistant/documents/${docId}`);
      const b64  = data.content;
      const dataUrl = `data:${mimeType};base64,${b64}`;

      const modal   = this.shadowRoot.getElementById("modal");
      const title   = this.shadowRoot.getElementById("modal-title");
      const content = this.shadowRoot.getElementById("modal-content");

      title.textContent = filename;
      content.innerHTML = "";

      if (mimeType === "application/pdf") {
        const iframe = document.createElement("iframe");
        iframe.className = "doc-frame";
        iframe.src = dataUrl;
        content.appendChild(iframe);
      } else {
        const img = document.createElement("img");
        img.className = "doc-img";
        img.src = dataUrl;
        content.appendChild(img);
      }

      modal.classList.add("open");
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  }

  async _deleteDocument(docId) {
    if (!confirm("Delete this document?")) return;
    await this._api("DELETE", `/api/travel_assistant/documents/${docId}`);
    this._documents = this._documents.filter(d => d.id !== docId);
    this._render();
  }

  async _uploadFile(file) {
    const status = this.shadowRoot.getElementById("upload-status");
    status.textContent = "Uploading…";
    try {
      const b64 = await _fileToBase64(file);
      const doc = await this._api("POST", `/api/travel_assistant/legs/${this._legId}/documents`, {
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        content: b64,
      });
      this._documents.push(doc);
      status.textContent = "✓ Uploaded";
      this._render();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // DataURL looks like "data:mime;base64,ABC123" — strip header
      const result = reader.result;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _docIcon(mime) {
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("image/")) return "🖼️";
  return "📎";
}

function _esc(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

customElements.define("ta-document-viewer", TaDocumentViewer);
