import { api } from "../api.js";
import { computeStatus, STATUS_COLORS, STATUS_LABELS, fmtDt, esc, attachNotesSave } from "../utils.js";
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

const TYPE_ICONS = { flight:"✈️", bus:"🚌", car:"🚗", train:"🚆", ferry:"⛴️", other:"🧳" };

class TaLegCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._leg                 = null;
    this._notesExpanded       = false;
    this._flightStatus        = null;
    this._flightStatusLoading = false;
    this._gcalEntity          = "";
    this._gcalMsg             = "";
    this._countdownTimer      = null;
  }

  set leg(v)        { this._leg = v; this._flightStatus = null; this._render(); }
  set gcalEntity(v) { this._gcalEntity = v; this._render(); }
  connectedCallback() {
    this._render();
    this._countdownTimer = setInterval(() => {
      if (this._leg && computeStatus(this._leg.depart_at, this._leg.arrive_at) === "upcoming") this._render();
    }, 60000);
  }
  disconnectedCallback() { clearInterval(this._countdownTimer); }

  _render() {
    if (!this._leg) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}</style><div style="color:#aaa;padding:24px;text-align:center">Select a segment to view details</div>`;
      return;
    }
    const l      = this._leg;
    const status = computeStatus(l.depart_at, l.arrive_at);
    const color  = STATUS_COLORS[status] || "#607D8B";
    const icon   = TYPE_ICONS[l.type] || "🧳";

    this.shadowRoot.innerHTML = `
    <style>
      :host{display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .hdr{padding:16px 20px;border-bottom:1px solid #eee;background:linear-gradient(135deg,#f8f9ff,#fff)}
      .route{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#222}
      .icon{font-size:24px}
      .arrow{color:#aaa;font-weight:300}
      .hdr-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
      .meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:12px;color:#666}
      .meta-item{display:flex;align-items:center;gap:4px}
      .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff}
      .edit-btn{margin-left:auto;padding:5px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .edit-btn:hover{background:#f5f5f5}
      .status-btn{padding:5px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .status-btn:hover{background:#f5f5f5}
      .gcal-btn{padding:5px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;color:#555}
      .gcal-btn:hover{background:#f5f5f5}
      .gcal-msg{font-size:11px;color:#4CAF50}
      .countdown{font-size:11px;font-weight:600;color:#03a9f4;background:#e3f2fd;padding:3px 8px;border-radius:10px}
      .flight-status-bar{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;padding:8px 12px;background:#f8f9ff;border-radius:8px;font-size:11px;color:#555;border-left:3px solid #03a9f4}
      .fs-item{display:flex;flex-direction:column;gap:1px}
      .fs-label{color:#aaa;font-size:10px;text-transform:uppercase}
      .fs-val{font-weight:600;color:#222}
      .fs-delay{color:#f44336;font-weight:700}
      /* Stacked sections */
      .sections{display:flex;flex-direction:column}
      .section{border-bottom:1px solid #f0f0f0}
      .section:last-child{border-bottom:none}
      .section-hdr{padding:12px 16px 4px;font-size:10px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:6px}
      .section-body{padding:0 16px 12px}
      .notes-add-btn{width:100%;padding:8px 12px;border:1px dashed #ddd;border-radius:8px;background:none;color:#aaa;font-size:13px;cursor:pointer;text-align:left}
      .notes-add-btn:hover{border-color:#bbb;color:#666;background:#fafafa}
      textarea{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;resize:none;box-sizing:border-box;line-height:1.5;overflow:hidden;min-height:36px}
      textarea:focus{outline:none;border-color:#03a9f4;box-shadow:0 0 0 2px rgba(3,169,244,.12)}
      .save-ind{font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:#aaa;margin-left:auto}
      .save-ind.saved{color:#4CAF50}
      .save-ind.error{color:#f44336}
    </style>
    <div class="hdr">
      <div class="route">
        <span class="icon">${icon}</span>
        <span>${esc(l.origin)}</span>
        <span class="arrow">→</span>
        <span>${esc(l.destination)}</span>
      </div>
      <div class="meta">
        ${l.depart_at    ? `<div class="meta-item">🛫 ${fmtDt(l.depart_at, l.depart_timezone)}${l.depart_timezone ? ` <span style="color:#bbb">${esc(l.depart_timezone)}</span>` : ""}</div>` : ""}
        ${l.arrive_at    ? `<div class="meta-item">🛬 ${fmtDt(l.arrive_at, l.arrive_timezone)}${l.arrive_timezone ? ` <span style="color:#bbb">${esc(l.arrive_timezone)}</span>` : ""}</div>` : ""}
        ${l.carrier      ? `<div class="meta-item">🏢 ${esc(l.carrier)}</div>` : ""}
        ${l.flight_number ? `<div class="meta-item">🔢 ${esc(l.flight_number)}</div>` : ""}
        ${l.seats        ? `<div class="meta-item">💺 ${esc(l.seats)}</div>` : ""}
        ${l.booking_url  ? `<div class="meta-item"><a href="${esc(l.booking_url)}" target="_blank" rel="noopener" style="color:#03a9f4;font-size:12px">🔗 Booking</a></div>` : ""}
      </div>
      <div class="hdr-actions">
        <span class="badge" style="background:${color}">${STATUS_LABELS[status] || status}</span>
        ${status === "upcoming" && _countdown(l.depart_at) ? `<span class="countdown">✈ ${_countdown(l.depart_at)}</span>` : ""}
        ${l.type === "flight" && l.flight_number ? `<button class="status-btn" id="flight-status-btn">${this._flightStatusLoading ? "…" : "🔄 Status"}</button>` : ""}
        ${this._gcalEntity ? `<button class="gcal-btn" id="gcal-btn" title="Export to Google Calendar">📅</button>` : ""}
        ${this._gcalMsg ? `<span class="gcal-msg">${esc(this._gcalMsg)}</span>` : ""}
        <button class="edit-btn" id="edit-btn">✏ Edit</button>
      </div>
      ${this._flightStatus ? this._flightStatusHtml(this._flightStatus) : ""}
    </div>
    <div class="sections" id="sections"></div>`;

    const statusBtn = this.shadowRoot.getElementById("flight-status-btn");
    if (statusBtn) statusBtn.addEventListener("click", () => this._fetchFlightStatus());

    const gcalBtn = this.shadowRoot.getElementById("gcal-btn");
    if (gcalBtn) gcalBtn.addEventListener("click", () => this._exportToGcal());

    this.shadowRoot.getElementById("edit-btn").addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("edit-requested", {
        detail: { type: "segment", item: this._leg },
        bubbles: true, composed: true,
      }));
    });

    this._mountSections();
  }

  _mountSections() {
    const container = this.shadowRoot.getElementById("sections");
    if (!container || !this._leg) return;
    container.innerHTML = "";
    const l = this._leg;

    // ── Tasks ──────────────────────────────────────────────────────────────
    const tasksWrap = this._makeSection("✅ Tasks");
    container.appendChild(tasksWrap.section);
    const taskEl = document.createElement("ta-tasks");
    tasksWrap.body.appendChild(taskEl);
    taskEl.parentType = "leg";
    taskEl.parentId   = l.id;
    taskEl.reminders  = l.reminders || [];
    taskEl.items      = l.checklist_items || [];

    // ── Documents ──────────────────────────────────────────────────────────
    const docsWrap = this._makeSection("📎 Documents");
    container.appendChild(docsWrap.section);
    const docEl = document.createElement("ta-document-viewer");
    docsWrap.body.appendChild(docEl);
    docEl.legId     = l.id;
    docEl.documents = l.documents || [];

    // ── Notes ──────────────────────────────────────────────────────────────
    const hasNotes = !!(l.notes && l.notes.trim());
    const showTA   = hasNotes || this._notesExpanded;
    const notesInd = document.createElement("span");
    notesInd.className = "save-ind";
    const notesWrap = this._makeSection("📝 Notes", notesInd);
    container.appendChild(notesWrap.section);

    if (showTA) {
      const ta = document.createElement("textarea");
      ta.placeholder = "Add free-form notes for this segment…";
      ta.value       = l.notes || "";
      notesWrap.body.appendChild(ta);
      requestAnimationFrame(() => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
      attachNotesSave(ta, notesInd, async value => {
        await api.updateLeg(l.id, { notes: value });
        this._leg = { ...this._leg, notes: value };
      });
    } else {
      const btn = document.createElement("button");
      btn.className   = "notes-add-btn";
      btn.textContent = "+ Add notes";
      notesWrap.body.appendChild(btn);
      btn.addEventListener("click", () => {
        this._notesExpanded = true;
        const ta = document.createElement("textarea");
        ta.placeholder = "Add free-form notes for this segment…";
        notesWrap.body.replaceChild(ta, btn);
        requestAnimationFrame(() => { ta.style.height = "36px"; ta.focus(); });
        ta.addEventListener("input", () => {
          ta.style.height = "auto";
          ta.style.height = ta.scrollHeight + "px";
        });
        attachNotesSave(ta, notesInd, async value => {
          await api.updateLeg(l.id, { notes: value });
          this._leg = { ...this._leg, notes: value };
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

  async _fetchFlightStatus() {
    if (this._flightStatusLoading) return;
    this._flightStatusLoading = true;
    this._render();
    try {
      this._flightStatus = await api.getFlightStatus(this._leg.id);
    } catch(e) {
      this._flightStatus = { error: e.message };
    } finally {
      this._flightStatusLoading = false;
      this._render();
    }
  }

  async _exportToGcal() {
    const btn = this.shadowRoot.getElementById("gcal-btn");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      await api.exportLegToGcal(this._leg.id);
      this._gcalMsg = "✓ Exported";
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 3000);
    } catch(e) {
      this._gcalMsg = `⚠ ${e.message}`;
      this._render();
      setTimeout(() => { this._gcalMsg = ""; this._render(); }, 4000);
    }
  }

  _flightStatusHtml(fs) {
    if (fs.error) return `<div class="flight-status-bar">⚠️ ${esc(fs.error)}</div>`;
    const items = [
      fs.flight_status      ? { l: "Status",    v: fs.flight_status }                          : null,
      fs.departure_gate     ? { l: "Gate",       v: fs.departure_gate }                         : null,
      fs.departure_terminal ? { l: "Terminal",   v: fs.departure_terminal }                     : null,
      fs.arrival_gate       ? { l: "Arr. Gate",  v: fs.arrival_gate }                           : null,
      fs.departure_delay    ? { l: "Dep. Delay", v: `+${fs.departure_delay}m`, cls:"fs-delay" } : null,
      fs.arrival_delay      ? { l: "Arr. Delay", v: `+${fs.arrival_delay}m`,  cls:"fs-delay" } : null,
    ].filter(Boolean);
    if (!items.length) return `<div class="flight-status-bar">No live status data available.</div>`;
    return `<div class="flight-status-bar">${items.map(i =>
      `<div class="fs-item"><span class="fs-label">${i.l}</span><span class="fs-val${i.cls?" "+i.cls:""}">${esc(String(i.v))}</span></div>`
    ).join("")}</div>`;
  }
}

customElements.define("ta-leg-card", TaLegCard);
