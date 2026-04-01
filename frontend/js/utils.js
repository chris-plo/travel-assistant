/**
 * Shared utilities for Travel Assistant frontend.
 */

/**
 * Compute segment/stay status from start and end ISO timestamps.
 * Returns "upcoming" | "active" | "completed".
 * Ignores the stored `status` field — always derived from current time.
 */
export function computeStatus(startIso, endIso) {
  const now   = Date.now();
  const start = startIso ? new Date(startIso).getTime() : null;
  const end   = endIso   ? new Date(endIso).getTime()   : null;
  if (!start) return "upcoming";
  if (now < start) return "upcoming";
  if (!end || now <= end) return "active";
  return "completed";
}

/** Status badge colors */
export const STATUS_COLORS = {
  upcoming:  "#2196F3",
  active:    "#4CAF50",
  completed: "#9E9E9E",
  cancelled: "#F44336",
};

/** Status display labels */
export const STATUS_LABELS = {
  upcoming:  "Upcoming",
  active:    "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Format a UTC ISO datetime string for display.
 * @param {string|null} iso  — UTC ISO string
 * @param {string|null} tz   — IANA timezone (e.g. "Europe/Madrid"). Falls back to browser local.
 */
export function fmtDt(iso, tz) {
  if (!iso) return "";
  try {
    const opts = { dateStyle: "short", timeStyle: "short" };
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/**
 * Format just the date portion of a UTC ISO datetime string.
 */
export function fmtDate(iso, tz) {
  if (!iso) return "";
  try {
    const opts = { month: "short", day: "numeric" };
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Convert a UTC ISO string back to a "YYYY-MM-DDTHH:MM" local string
 * for use in a datetime-local input, displayed in the given timezone.
 */
export function isoToLocalInput(iso, tz) {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    const opts = {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: tz || undefined,
    };
    // Format: "04/15/2026, 14:30" → need "2026-04-15T14:30"
    const parts = new Intl.DateTimeFormat("en-CA", { ...opts, dateStyle: undefined, timeStyle: undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return "";
  }
}

/**
 * Attach auto-save behaviour to a textarea.
 * - On input: shows unsaved state
 * - On blur: calls saveFn(value), shows saved state on success
 *
 * @param {HTMLElement} textarea
 * @param {HTMLElement} indicator  — element to show save state (e.g. a <span>)
 * @param {function}    saveFn     — async function(value) => void
 */
export function attachNotesSave(textarea, indicator, saveFn) {
  if (!textarea) return;

  const showUnsaved = () => {
    if (!indicator) return;
    indicator.textContent = "";
    indicator.className = "save-indicator";
  };

  const showSaved = () => {
    if (!indicator) return;
    indicator.textContent = "✓ Saved";
    indicator.className = "save-indicator saved";
    // Fade out after 3 seconds
    clearTimeout(indicator._fadeTimer);
    indicator._fadeTimer = setTimeout(() => {
      if (indicator.className.includes("saved")) indicator.textContent = "";
    }, 3000);
  };

  const showError = () => {
    if (!indicator) return;
    indicator.textContent = "⚠ Save failed";
    indicator.className = "save-indicator error";
  };

  textarea.addEventListener("input", showUnsaved);

  textarea.addEventListener("blur", async e => {
    try {
      await saveFn(e.target.value);
      showSaved();
    } catch (err) {
      console.error("Notes save failed:", err);
      showError();
    }
  });
}

/**
 * Format just the time portion of a UTC ISO datetime string (no timezone label).
 */
export function fmtTime(iso, tz) {
  if (!iso) return "";
  try {
    const opts = { hour: "numeric", minute: "2-digit" };
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * Format the duration between two ISO timestamps as "Xh Ym".
 */
export function fmtDuration(depIso, arrIso) {
  if (!depIso || !arrIso) return "";
  const mins = Math.round((new Date(arrIso) - new Date(depIso)) / 60000);
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * Convert a UTC ISO string to "YYYY-MM-DD" in the given timezone,
 * for use in a date-only <input type="date">.
 */
export function isoToDateInput(iso, tz) {
  if (!iso) return "";
  try {
    const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
    if (tz) opts.timeZone = tz;
    const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(new Date(iso));
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return "";
  }
}

/** HTML-escape a string. */
export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
