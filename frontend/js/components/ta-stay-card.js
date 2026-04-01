import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, STATUS_LABELS, fmtDate, esc, attachNotesSave } from "../utils.js";
import "./ta-tasks.js";
import "./ta-document-viewer.js";

function _countdown(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0 || diff > 7 * 24 * 3600 * 1000) return null;
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hrs  = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs  > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function _mapsUrl(address, city) {
  if (!address && !city) return null;
  // Append city to query if it's not already contained in the address string
  const query = (address && city && !address.toLowerCase().includes(city.toLowerCase()))
    ? `${address}, ${city}`
    : (address || city);
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

class TaStayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stay           = null;
    this._notesExpanded  = false;
    this._countdownTimer = null;
    this._gcalEntity     = "";
    this._gcalMsg        = "";
  }

  set stay(v)       { this._stay = v; this._render(); }
  set gcalEntity(v) { this._gcalEntity = v; this._render(); }
  connectedCallback() {
    this._render();
    this._countdownTimer = setInterval(() => {
      if (this._stay && computeStatus(this._stay.check_in, this._stay.check_out) === "upcoming") this._render();
    }, 60000);
  }
  disconnectedCallback() { clearInterval(this._countdownTimer); }

  _render() {
    if (!this._stay) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a stay to view details</div>`;
      return;
    }
    const s      = this._stay;
    const status = computeStatus(s.check_in, s.check_out);
    const color  = STATUS_COLORS[status] || "#FF9800";
    const mapHref = _mapsUrl(s.address, s.location);

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#fff8f0,#fff)}
      .title-row{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .hotel-icon{font-size:26px}
      .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .hdr-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
      .edit-btn{margin-left:auto;padding:5px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .edit-btn:hover{background:#f5f5f5}
      .gcal-btn{padding:5px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .gcal-btn:hover{background:#f5f5f5}
      .gcal-msg{font-size:11px;color:#4CAF50}
      .maps-link{color:#FF9800;text-decoration:none;margin-left:4px}
      .maps-link:hover{text-decoration:underline}
      .countdown{font-size:11px;font-weight:600;color:#FF9800;background:#fff3e0;padding:3px 8px;border-radius:10px}
      /* Stacked sections */
      .sections{display:flex;flex-direction:column}
      .section{border-bottom:1px solid #f0f0f0}
      .section:last-child{border-bottom:none}
      .section-hdr{padding:12px 16px 4px;font-size:10px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:6px}
      .section-body{padding:0 16px 12px}
      /* Notes */
      .notes-add-btn{width:100%;padding:8px 12px;border:1px dashed #ddd;border-radius:8px;background:none;color:#aaa;font-size:13px;cursor:pointer;text-align:left}
      .notes-add-btn:hover{border-color:#bbb;color:#666;background:#fafafa}
      textarea{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:none;box-sizing:border-box;line-height:1.5;overflow:hidden;min-height:36px}
      textarea:focus{outline:none;border-color:#FF9800;box-shadow:0 0 0 2px rgba(255,152,0,.12)}
      .save-ind{font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:#aaa;margin-left:auto}
      .save-ind.saved{color:#4CAF50}
      .save-ind.error{color:#f44336}
    </style>
    <div class="hdr">
      <div class="title-row">
        <span class="hotel-icon">🏨</span>
        <span>${esc(s.name)}</span>
      </div>
      <div class="meta">
        ${s.location  ? `<div class="meta-item">📍 ${esc(s.location)}</div>` : ""}
        ${s.check_in  ? `<div class="meta-item">📅 In: ${fmtDate(s.check_in, s.timezone)}</div>` : ""}
        ${s.check_out ? `<div class="meta-item">📅 Out: ${fmtDate(s.check_out, s.timezone)}</div>` : ""}
        ${s.address   ? `<div class="meta-item">🗺️ ${esc(s.address)}${mapHref ? `<a class="maps-link" href="${mapHref}" target="_blank" rel="noopener">↗ Maps</a>` : ""}</div>` : ""}
        ${!s.address && mapHref ? `<div class="meta-item"><a class="maps-link" href="${mapHref}" target="_blank" rel="noopener">🗺️ Maps</a></div>` : ""}
        ${s.confirmation_number ? `<div class="meta-item">🔖 ${esc(s.confirmation_number)}</div>` : ""}
        ${s.timezone  ? `<div class="meta-item">🕐 ${esc(s.timezone)}</div>` : ""}
        ${s.booking_url ? `<div class="meta-item"><a href="${esc(s.booking_url)}" target="_blank" rel="noopener" style="color:#FF9800;font-size:12px">🔗 Booking</a></div>` : ""}
      </div>
      <div class="hdr-actions">
        <span class="badge" style="background:${color}">${STATUS_LABELS[status] || status}</span>
        ${status === "upcoming" && _countdown(s.check_in) ? `<span class="countdown">🏨 ${_countdown(s.check_in)}</span>` : ""}
        ${this._gcalEntity ? `<button class="gcal-btn" id="gcal-btn" title="Export to Google Calendar">📅</button>` : ""}
        ${this._gcalMsg    ? `<span class="gcal-msg">${esc(this._gcalMsg)}</span>` : ""}
        <button class="edit-btn" id="edit-btn">✏ Edit</button>
      </div>
    </div>
    <div class="sections" id="sections"></div>`;

    this.shadowRoot.getElementById("edit-btn").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("edit-requested", {
        detail: { type: "stay", item: this._stay },
        bubbles: true, composed: true,
      }));
    });

    const gcalBtn = this.shadowRoot.getElementById("gcal-btn");
    if (gcalBtn) gcalBtn.addEventListener("click", () => this._exportToGcal());

    this._mountSections();
  }

  _mountSections() {
    const container = this.shadowRoot.getElementById("sections");
    if (!container || !this._stay) return;
    container.innerHTML = "";
    const s = this._stay;

    // ── Tasks ──────────────────────────────────────────────────────────────
    const tasksWrap = this._makeSection("✅ Tasks");
    container.appendChild(tasksWrap.section);
    const taskEl = document.createElement("ta-tasks");
    tasksWrap.body.appendChild(taskEl);
    taskEl.parentType = "stay";
    taskEl.parentId   = s.id;
    taskEl.reminders  = s.reminders || [];
    taskEl.items      = s.checklist_items || [];

    // ── Documents ──────────────────────────────────────────────────────────
    const docsWrap = this._makeSection("📎 Documents");
    container.appendChild(docsWrap.section);
    const docEl = document.createElement("ta-document-viewer");
    docsWrap.body.appendChild(docEl);
    docEl.parentType = "stay";
    docEl.legId      = s.id;
    docEl.documents  = s.documents || [];

    // ── Notes ──────────────────────────────────────────────────────────────
    const hasNotes = !!(s.notes && s.notes.trim());
    const showTA   = hasNotes || this._notesExpanded;
    const notesInd = document.createElement("span");
    notesInd.className = "save-ind";
    notesInd.id = "save-ind";
    const notesWrap = this._makeSection("📝 Notes", notesInd);
    container.appendChild(notesWrap.section);

    if (showTA) {
      const ta = document.createElement("textarea");
      ta.placeholder = "Add free-form notes for this stay…";
      ta.value       = s.notes || "";
      notesWrap.body.appendChild(ta);
      // Auto-height
      requestAnimationFrame(() => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
      attachNotesSave(ta, notesInd, async value => {
        await api.updateStay(s.id, { notes: value });
        this._stay = { ...this._stay, notes: value };
      });
    } else {
      const btn = document.createElement("button");
      btn.className   = "notes-add-btn";
      btn.textContent = "+ Add notes";
      notesWrap.body.appendChild(btn);
      btn.addEventListener("click", () => {
        this._notesExpanded = true;
        // Replace button with textarea in-place (no full re-render)
        const ta = document.createElement("textarea");
        ta.placeholder = "Add free-form notes for this stay…";
        notesWrap.body.replaceChild(ta, btn);
        requestAnimationFrame(() => { ta.style.height = "36px"; ta.focus(); });
        ta.addEventListener("input", () => {
          ta.style.height = "auto";
          ta.style.height = ta.scrollHeight + "px";
        });
        attachNotesSave(ta, notesInd, async value => {
          await api.updateStay(s.id, { notes: value });
          this._stay = { ...this._stay, notes: value };
        });
      });
    }
  }

  _makeSection(label, extraEl) {
    const section = document.createElement("div");
    section.className = "section";
    const hdr = document.createElement("div");
    hdr.className = "section-hdr";
    hdr.textContent = label;
    if (extraEl) hdr.appendChild(extraEl);
    const body = document.createElement("div");
    body.className = "section-body";
    section.appendChild(hdr);
    section.appendChild(body);
    return { section, body };
  }

  async _exportToGcal() {
    const btn = this.shadowRoot.getElementById("gcal-btn");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      await api.exportStayToGcal(this._stay.id);
      this._gcalMsg = "✓ Exported";
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 3000);
    } catch(e) {
      this._gcalMsg = `⚠ ${e.message}`;
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 4000);
    }
  }
}

customElements.define("ta-stay-card", TaStayCard);
