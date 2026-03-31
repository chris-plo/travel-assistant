/**
 * ta-item-modal — create/edit modal for segments and stays.
 * Mobile: full-screen slide-up sheet.
 * Desktop: centered dialog with backdrop.
 *
 * Usage:
 *   const modal = document.createElement("ta-item-modal");
 *   modal.aiProvider = "claude";
 *   document.body.appendChild(modal);
 *   modal.open({ mode: "segment", tripId: "...", item: null });
 *   modal.open({ mode: "stay",    tripId: "...", item: existingStay });
 */
import { api } from "../api.js";
import { isoToLocalInput, esc } from "../utils.js";

const TZ_LIST_ID = "__ta-tz-list";

function ensureTzDatalist() {
  if (document.getElementById(TZ_LIST_ID)) return;
  const TZ_LIST = [
    "UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
    "America/Toronto","America/Vancouver","America/Mexico_City","America/Bogota",
    "America/Lima","America/Santiago","America/Sao_Paulo","America/Buenos_Aires",
    "America/Caracas","America/Halifax","America/Anchorage","America/Phoenix",
    "Europe/London","Europe/Dublin","Europe/Lisbon","Europe/Paris","Europe/Berlin",
    "Europe/Madrid","Europe/Rome","Europe/Amsterdam","Europe/Brussels","Europe/Stockholm",
    "Europe/Oslo","Europe/Copenhagen","Europe/Helsinki","Europe/Athens","Europe/Warsaw",
    "Europe/Prague","Europe/Vienna","Europe/Zurich","Europe/Moscow","Europe/Istanbul",
    "Europe/Bucharest","Europe/Budapest","Europe/Belgrade","Europe/Sofia",
    "Asia/Dubai","Asia/Karachi","Asia/Kolkata","Asia/Dhaka","Asia/Colombo",
    "Asia/Kathmandu","Asia/Bangkok","Asia/Singapore","Asia/Kuala_Lumpur",
    "Asia/Jakarta","Asia/Shanghai","Asia/Hong_Kong","Asia/Taipei","Asia/Tokyo",
    "Asia/Seoul","Asia/Manila","Asia/Tehran","Asia/Riyadh","Asia/Baghdad",
    "Asia/Beirut","Asia/Jerusalem","Asia/Rangoon","Asia/Almaty","Asia/Tashkent",
    "Africa/Cairo","Africa/Johannesburg","Africa/Lagos","Africa/Nairobi","Africa/Casablanca",
    "Pacific/Auckland","Pacific/Sydney","Pacific/Melbourne","Pacific/Fiji",
    "Pacific/Honolulu","Pacific/Guam",
  ];
  const dl = document.createElement("datalist");
  dl.id = TZ_LIST_ID;
  TZ_LIST.forEach(tz => { const o = document.createElement("option"); o.value = tz; dl.appendChild(o); });
  document.body.appendChild(dl);
}

class TaItemModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config    = null;  // { mode, tripId, item }
    this._activeTab = "manual";
    this._busy      = false;
    this._extractedFields = null;
  }

  set aiProvider(v) { this._aiProvider = v; }

  connectedCallback() {
    ensureTzDatalist();
    this._renderClosed();
  }

  /** Open the modal. config = { mode: "segment"|"stay", tripId, item: null|existing } */
  open(config) {
    this._config = config;
    this._activeTab = "manual";
    this._extractedFields = null;
    this._busy = false;
    this._renderOpen();
  }

  _close() {
    this._config = null;
    this._renderClosed();
    this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
  }

  _renderClosed() {
    this.shadowRoot.innerHTML = `<style>:host{display:none}</style>`;
  }

  _renderOpen() {
    const { mode, item } = this._config;
    const isEdit   = !!item;
    const isStay   = mode === "stay";
    const hasAI    = this._aiProvider && this._aiProvider !== "none";
    const title    = isEdit ? `Edit ${isStay ? "Stay" : "Segment"}` : `Add ${isStay ? "Stay" : "Segment"}`;

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:block;position:fixed;inset:0;z-index:2000}
      .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
      .sheet{position:absolute;left:50%;bottom:0;transform:translateX(-50%);
             width:100%;max-width:600px;background:#fff;border-radius:20px 20px 0 0;
             display:flex;flex-direction:column;max-height:92vh;overflow:hidden;
             animation:slideUp .25s ease}
      @keyframes slideUp{from{transform:translateX(-50%) translateY(100%)}to{transform:translateX(-50%) translateY(0)}}
      @media(min-height:600px) and (min-width:641px){
        .sheet{bottom:auto;top:50%;transform:translate(-50%,-50%);border-radius:16px;
               max-height:85vh;animation:fadeIn .2s ease}
        @keyframes fadeIn{from{opacity:0;transform:translate(-50%,-52%)}to{opacity:1;transform:translate(-50%,-50%)}}
      }
      .modal-hdr{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;flex-shrink:0}
      .modal-title{font-size:16px;font-weight:700;color:#222;flex:1}
      .close-btn{background:none;border:none;font-size:22px;cursor:pointer;color:#aaa;padding:0 4px;line-height:1}
      .close-btn:hover{color:#333}
      .modal-tabs{display:flex;border-bottom:1px solid #eee;flex-shrink:0}
      .mtab{flex:1;padding:10px 0;border:none;background:none;font-size:13px;font-weight:500;
            cursor:pointer;color:#999;border-bottom:2px solid transparent}
      .mtab.active{color:#03a9f4;border-bottom-color:#03a9f4}
      .modal-body{flex:1;overflow-y:auto;padding:16px 20px}
      .form-grid{display:flex;flex-direction:column;gap:10px}
      .field-row{display:flex;flex-direction:column;gap:4px}
      .field-row label{font-size:12px;color:#666;font-weight:500}
      .field-row input,.field-row select,.field-row textarea{
        padding:9px 11px;border:1px solid #ccc;border-radius:8px;font-size:14px;
        font-family:inherit;width:100%;box-sizing:border-box;outline:none}
      .field-row input:focus,.field-row select:focus,.field-row textarea:focus{border-color:#03a9f4;box-shadow:0 0 0 2px rgba(3,169,244,.15)}
      .field-row textarea{min-height:72px;resize:vertical}
      .dt-tz-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .dt-tz-row input{width:100%;box-sizing:border-box}
      .section-label{font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin:6px 0 -2px}
      .modal-footer{padding:14px 20px;border-top:1px solid #eee;display:flex;gap:10px;align-items:center;flex-shrink:0}
      .btn{padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
      .btn-primary{background:#03a9f4;color:#fff;flex:1}.btn-primary:hover{background:#0288d1}
      .btn-delete{background:none;color:#f44336;border:1px solid #fcc;padding:9px 16px}
      .btn-delete:hover{background:#ffeaea}
      .btn-cancel{background:none;color:#666;border:1px solid #ddd;padding:9px 16px}
      .btn-cancel:hover{background:#f5f5f5}
      .status-msg{font-size:12px;color:#888;flex:1;text-align:right}
      /* Extract tab */
      .upload-zone{border:2px dashed #ddd;border-radius:12px;padding:32px;text-align:center;color:#aaa;cursor:pointer;transition:border-color .15s}
      .upload-zone:hover{border-color:#03a9f4;color:#555}
      .upload-zone input{display:none}
      .preview-img{max-width:100%;max-height:200px;border-radius:8px;margin-top:12px}
      .extract-result{background:#f0f9ff;border:1px solid #b3e5fc;border-radius:8px;padding:12px;font-size:12px;color:#555;margin-top:12px;white-space:pre-wrap}
      .spinner{display:inline-block;width:18px;height:18px;border:2px solid #ccc;border-top-color:#03a9f4;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style>
    <div class="backdrop" id="backdrop"></div>
    <div class="sheet">
      <div class="modal-hdr">
        <span class="modal-title">${title}</span>
        <button class="close-btn" id="close-btn">✕</button>
      </div>
      ${hasAI ? `
      <div class="modal-tabs">
        <button class="mtab${this._activeTab==="manual"?" active":""}" data-tab="manual">✏️ Manual</button>
        <button class="mtab${this._activeTab==="extract"?" active":""}" data-tab="extract">📷 From Document</button>
      </div>` : ""}
      <div class="modal-body" id="modal-body"></div>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn btn-delete" id="delete-btn">🗑 Delete</button>` : ""}
        <button class="btn btn-cancel" id="cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="save-btn" ${this._busy?"disabled":""}>
          ${this._busy ? '<span class="spinner"></span>' : (isEdit ? "Save changes" : `Add ${isStay?"Stay":"Segment"}`)}
        </button>
        <span class="status-msg" id="status-msg"></span>
      </div>
    </div>`;

    // Tab switching
    this.shadowRoot.querySelectorAll(".mtab").forEach(btn => {
      btn.addEventListener("click", () => { this._activeTab = btn.dataset.tab; this._renderOpen(); });
    });
    this.shadowRoot.getElementById("backdrop").addEventListener("click", () => this._close());
    this.shadowRoot.getElementById("close-btn").addEventListener("click", () => this._close());
    this.shadowRoot.getElementById("cancel-btn").addEventListener("click", () => this._close());
    this.shadowRoot.getElementById("save-btn").addEventListener("click", () => this._save());

    const delBtn = this.shadowRoot.getElementById("delete-btn");
    if (delBtn) delBtn.addEventListener("click", () => this._delete());

    // Mount tab body
    const body = this.shadowRoot.getElementById("modal-body");
    if (this._activeTab === "extract") {
      this._mountExtractTab(body);
    } else {
      isStay ? this._mountStayForm(body) : this._mountSegmentForm(body);
    }
  }

  _mountSegmentForm(body) {
    const item = this._config?.item;
    const f = this._extractedFields || {};
    // Merge: extracted fields override item fields for pre-population
    const v = (field, fallback = "") => f[field] ?? item?.[field] ?? fallback;

    body.innerHTML = `
    <div class="form-grid">
      <div class="field-row">
        <label>Type</label>
        <select id="f-type">
          ${["flight","train","bus","ferry","car","other"].map(t =>
            `<option value="${t}"${v("type","flight")===t?" selected":""}>${{flight:"✈️ Flight",train:"🚆 Train",bus:"🚌 Bus",ferry:"⛴️ Ferry",car:"🚗 Car",other:"🧳 Other"}[t]}</option>`
          ).join("")}
        </select>
      </div>
      <div class="field-row">
        <label>Origin *</label>
        <input id="f-origin" type="text" placeholder="City or airport code (e.g. MAD)" value="${esc(v("origin"))}">
      </div>
      <div class="field-row">
        <label>Destination *</label>
        <input id="f-destination" type="text" placeholder="City or airport code (e.g. BOG)" value="${esc(v("destination"))}">
      </div>
      <div class="section-label">Departure</div>
      <div class="field-row">
        <label>Date &amp; time → Timezone</label>
        <div class="dt-tz-row">
          <input id="f-depart-at" type="datetime-local" value="${v("depart_at") ? (item?.depart_at ? isoToLocalInput(item.depart_at, item.depart_timezone) : v("depart_at")) : ""}">
          <input id="f-depart-tz" type="text" placeholder="e.g. Europe/Madrid" list="${TZ_LIST_ID}" value="${esc(v("depart_timezone", item?.depart_timezone || ""))}">
        </div>
      </div>
      <div class="section-label">Arrival</div>
      <div class="field-row">
        <label>Date &amp; time → Timezone</label>
        <div class="dt-tz-row">
          <input id="f-arrive-at" type="datetime-local" value="${v("arrive_at") ? (item?.arrive_at ? isoToLocalInput(item.arrive_at, item.arrive_timezone) : v("arrive_at")) : ""}">
          <input id="f-arrive-tz" type="text" placeholder="e.g. America/Bogota" list="${TZ_LIST_ID}" value="${esc(v("arrive_timezone", item?.arrive_timezone || ""))}">
        </div>
      </div>
      <div class="field-row">
        <label>Carrier</label>
        <input id="f-carrier" type="text" placeholder="Airline or company" value="${esc(v("carrier"))}">
      </div>
      <div class="field-row">
        <label>Flight / Route number</label>
        <input id="f-flight-num" type="text" placeholder="e.g. IB6840" value="${esc(v("flight_number"))}">
      </div>
      <div class="field-row">
        <label>Confirmation #</label>
        <input id="f-confirmation" type="text" placeholder="Booking reference" value="${esc(v("confirmation_number"))}">
      </div>
      <div class="field-row">
        <label>Seats</label>
        <input id="f-seats" type="text" placeholder="e.g. 23A, 23B" value="${esc(v("seats"))}">
      </div>
      <div class="field-row">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Any additional notes…">${esc(v("notes"))}</textarea>
      </div>
    </div>`;
  }

  _mountStayForm(body) {
    const item = this._config?.item;
    const f = this._extractedFields || {};
    const v = (field, fallback = "") => f[field] ?? item?.[field] ?? fallback;
    const tz = v("timezone", item?.timezone || "");

    body.innerHTML = `
    <div class="form-grid">
      <div class="field-row">
        <label>Hotel / Property name *</label>
        <input id="f-name" type="text" placeholder="e.g. Hotel Gran Vía" value="${esc(v("name"))}">
      </div>
      <div class="field-row">
        <label>City / Location</label>
        <input id="f-location" type="text" placeholder="e.g. Madrid, Spain" value="${esc(v("location"))}">
      </div>
      <div class="field-row">
        <label>Timezone</label>
        <input id="f-tz" type="text" placeholder="e.g. Europe/Madrid" list="${TZ_LIST_ID}" value="${esc(tz)}">
      </div>
      <div class="section-label">Check-in / Check-out</div>
      <div class="field-row">
        <label>Check-in</label>
        <input id="f-checkin" type="datetime-local" value="${item?.check_in ? isoToLocalInput(item.check_in, item.timezone) : v("check_in")}">
      </div>
      <div class="field-row">
        <label>Check-out</label>
        <input id="f-checkout" type="datetime-local" value="${item?.check_out ? isoToLocalInput(item.check_out, item.timezone) : v("check_out")}">
      </div>
      <div class="field-row">
        <label>Address</label>
        <input id="f-address" type="text" placeholder="Street address" value="${esc(v("address"))}">
      </div>
      <div class="field-row">
        <label>Confirmation #</label>
        <input id="f-confirmation" type="text" placeholder="Booking reference" value="${esc(v("confirmation_number"))}">
      </div>
      <div class="field-row">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Any additional notes…">${esc(v("notes"))}</textarea>
      </div>
    </div>`;
  }

  _mountExtractTab(body) {
    body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <p style="font-size:13px;color:#666;margin:0">Upload a photo of your boarding pass, booking confirmation, or hotel voucher. The AI will extract the details automatically.</p>
      <label class="upload-zone" id="upload-zone">
        <input type="file" id="file-input" accept="image/*,application/pdf">
        <div>📷 Tap to upload or take a photo</div>
        <div style="font-size:11px;margin-top:4px">JPEG, PNG, or PDF</div>
      </label>
      <div id="extract-status" style="font-size:13px;color:#888"></div>
    </div>`;

    body.querySelector("#file-input").addEventListener("change", e => {
      if (e.target.files[0]) this._extract(e.target.files[0], body);
    });
  }

  async _extract(file, body) {
    const status = body.querySelector("#extract-status");
    const zone   = body.querySelector("#upload-zone");
    status.innerHTML = '<span class="spinner"></span> Extracting…';
    try {
      const b64 = await _toBase64(file);
      const mime = file.type || "image/jpeg";
      const docType = this._config.mode === "stay" ? "stay" : "segment";
      const result = await api.extract({ content: b64, mime_type: mime, doc_type: docType });
      const fields = result.fields || {};
      this._extractedFields = fields;

      // Show thumbnail for images
      const previewHtml = file.type.startsWith("image/")
        ? `<img class="preview-img" src="${URL.createObjectURL(file)}">`
        : `<div style="font-size:12px;margin-top:8px">📄 ${esc(file.name)}</div>`;

      const fieldsSummary = Object.entries(fields)
        .filter(([,v]) => v)
        .map(([k,v]) => `${k}: ${v}`)
        .join("\n") || "(no fields extracted)";

      zone.innerHTML = `${previewHtml}<div class="extract-result">${esc(fieldsSummary)}</div>`;
      status.innerHTML = "✓ Fields extracted. Switch to <b>Manual</b> tab to review and save.";
    } catch(e) {
      status.textContent = `Error: ${e.message}`;
    }
  }

  async _save() {
    const { mode, tripId, item } = this._config;
    const isStay = mode === "stay";
    const isEdit = !!item;
    const g = id => this.shadowRoot.getElementById(id)?.value?.trim();
    const status = this.shadowRoot.getElementById("status-msg");

    let body;
    if (isStay) {
      const name = g("f-name");
      if (!name) { status.textContent = "Name required."; return; }
      const tz = g("f-tz") || null;
      body = {
        name, tz,
        location:            g("f-location") || null,
        check_in:            g("f-checkin")  || null,
        check_out:           g("f-checkout") || null,
        timezone:            tz,
        address:             g("f-address") || null,
        confirmation_number: g("f-confirmation") || null,
        notes:               g("f-notes") || null,
      };
    } else {
      const origin = g("f-origin"), dest = g("f-destination");
      if (!origin || !dest) { status.textContent = "Origin and destination required."; return; }
      body = {
        type:             g("f-type") || "flight",
        origin, destination: dest,
        depart_at:        g("f-depart-at") || null,
        depart_timezone:  g("f-depart-tz") || null,
        arrive_at:        g("f-arrive-at") || null,
        arrive_timezone:  g("f-arrive-tz") || null,
        carrier:          g("f-carrier") || null,
        flight_number:    g("f-flight-num") || null,
        confirmation_number: g("f-confirmation") || null,
        seats:            g("f-seats") || null,
        notes:            g("f-notes") || null,
      };
    }

    this._busy = true;
    status.textContent = "Saving…";
    try {
      let saved;
      if (isEdit) {
        saved = isStay
          ? await api.updateStay(item.id, body)
          : await api.updateLeg(item.id, body);
      } else {
        saved = isStay
          ? await api.createStay(tripId, body)
          : await api.createLeg(tripId, body);
      }
      this.dispatchEvent(new CustomEvent("saved", { detail: saved, bubbles: true, composed: true }));
      this._close();
    } catch(e) {
      status.textContent = `Error: ${e.message}`;
      this._busy = false;
    }
  }

  async _delete() {
    const { mode, item } = this._config;
    const isStay = mode === "stay";
    const label  = isStay ? item.name : `${item.origin} → ${item.destination}`;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      if (isStay) await api.deleteStay(item.id);
      else        await api.deleteLeg(item.id);
      this.dispatchEvent(new CustomEvent("deleted", { detail: { id: item.id, type: mode }, bubbles: true, composed: true }));
      this._close();
    } catch(e) {
      const s = this.shadowRoot.getElementById("status-msg");
      if (s) s.textContent = `Error: ${e.message}`;
    }
  }
}

function _toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = r.result, c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

customElements.define("ta-item-modal", TaItemModal);
