/**
 * ta-chat — AI chat assistant for a trip.
 *
 * Properties:
 *   tripId  — string
 *   token   — HA auth token
 *   history — array of {role, content, ts} message objects
 * Events:
 *   data-changed — fired when the AI modified the itinerary
 */

class TaChat extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tripId   = null;
    this._token    = null;
    this._messages = [];
    this._loading  = false;
  }

  set tripId(val)  { this._tripId = val; }
  set token(val)   { this._token = val; }
  set history(val) { this._messages = (val || []).map(m => ({ role: m.role, content: m.content })); this._render(); }

  connectedCallback() { this._render(); }

  async _api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this._token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  _render() {
    const msgs = this._messages;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; height: 420px; }
        .chat-header { display: flex; justify-content: space-between; align-items: center; padding: 0 0 8px; }
        .chat-title  { font-size: 13px; font-weight: 600; color: var(--secondary-text-color,#666); }
        .clear-btn   { background: none; border: none; font-size: 11px; color: var(--secondary-text-color,#aaa); cursor: pointer; }
        .clear-btn:hover { color: #f44336; }
        .messages {
          flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 0;
        }
        .bubble {
          max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5;
          white-space: pre-wrap; word-break: break-word;
        }
        .bubble.user {
          align-self: flex-end;
          background: var(--primary-color,#03a9f4); color: #fff;
          border-bottom-right-radius: 4px;
        }
        .bubble.assistant {
          align-self: flex-start;
          background: var(--secondary-background-color,#f0f0f0);
          color: var(--primary-text-color,#333);
          border-bottom-left-radius: 4px;
        }
        .actions-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .action-chip {
          font-size: 11px; padding: 3px 8px; border-radius: 10px;
          background: rgba(76,175,80,.15); color: #2e7d32;
          border: 1px solid rgba(76,175,80,.3);
        }
        .sources-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .source-chip {
          font-size: 10px; padding: 2px 6px; border-radius: 10px;
          background: rgba(33,150,243,.1); color: #1565c0;
          text-decoration: none;
        }
        .typing { align-self: flex-start; color: var(--secondary-text-color,#999); font-size: 12px; padding: 6px; }
        .empty-hint { align-self: center; margin: auto; color: var(--secondary-text-color,#bbb); font-size: 13px; text-align: center; }
        .input-row { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid var(--divider-color,#eee); }
        .chat-input {
          flex: 1; padding: 9px 12px; border: 1px solid var(--divider-color,#ccc); border-radius: 20px;
          font-size: 13px; background: var(--card-background-color,#fff);
          color: var(--primary-text-color,#333); outline: none; resize: none;
        }
        .send-btn {
          padding: 9px 16px; border: none; border-radius: 20px;
          background: var(--primary-color,#03a9f4); color: #fff;
          cursor: pointer; font-size: 13px; white-space: nowrap;
        }
        .send-btn:disabled { opacity: .5; cursor: default; }
      </style>

      <div class="chat-header">
        <span class="chat-title">✨ AI Travel Assistant</span>
        <button class="clear-btn" id="clear-btn">Clear history</button>
      </div>

      <div class="messages" id="messages">
        ${msgs.length === 0
          ? `<div class="empty-hint">Ask me anything about your trip,<br>or say "Add a reminder 1 hour before my flight"</div>`
          : msgs.map(m => this._renderBubble(m.role, m.content, m.actions, m.sources)).join("")}
        ${this._loading ? `<div class="typing" id="typing">Thinking…</div>` : ""}
      </div>

      <div class="input-row">
        <textarea class="chat-input" id="chat-input" rows="1" placeholder="Ask about your trip or make a change…"></textarea>
        <button class="send-btn" id="send-btn" ${this._loading ? "disabled" : ""}>Send</button>
      </div>
    `;

    const input = this.shadowRoot.getElementById("chat-input");
    const sendBtn = this.shadowRoot.getElementById("send-btn");

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
    sendBtn.addEventListener("click", () => this._send());

    this.shadowRoot.getElementById("clear-btn").addEventListener("click", () => this._clearHistory());

    // Auto-scroll to bottom
    const msgs_el = this.shadowRoot.getElementById("messages");
    if (msgs_el) msgs_el.scrollTop = msgs_el.scrollHeight;
  }

  _renderBubble(role, content, actions, sources) {
    const actionsHtml = actions?.length
      ? `<div class="actions-row">${actions.map(a => `<span class="action-chip">✓ ${_esc(a.summary)}</span>`).join("")}</div>`
      : "";
    const sourcesHtml = sources?.length
      ? `<div class="sources-row">${sources.map(s => `<a class="source-chip" href="${_esc(s)}" target="_blank" rel="noopener">🔗 ${_esc(_shortUrl(s))}</a>`).join("")}</div>`
      : "";
    return `
      <div>
        <div class="bubble ${role}">${_esc(content)}</div>
        ${actionsHtml}
        ${sourcesHtml}
      </div>
    `;
  }

  async _send() {
    const input   = this.shadowRoot.getElementById("chat-input");
    const message = input.value.trim();
    if (!message || this._loading) return;

    input.value = "";
    this._messages.push({ role: "user", content: message });
    this._loading = true;
    this._render();

    try {
      const res = await this._api("POST", "/api/travel_assistant/chat", {
        trip_id: this._tripId,
        message,
      });
      this._messages.push({
        role: "assistant",
        content: res.reply || "(no reply)",
        actions: res.actions || [],
        sources: res.sources || [],
      });
      if (res.data_changed) {
        this.dispatchEvent(new CustomEvent("data-changed", { bubbles: true, composed: true }));
      }
    } catch (err) {
      this._messages.push({ role: "assistant", content: `Error: ${err.message}` });
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _clearHistory() {
    if (!confirm("Clear all chat history for this trip?")) return;
    // Clear locally; backend will clear on next save cycle
    this._messages = [];
    try {
      // PATCH the trip to clear history via a workaround — just reset locally for now
      await this._api("PUT", `/api/travel_assistant/trips/${this._tripId}`, { clear_chat: true });
    } catch (_) { /* ignore */ }
    this._render();
  }
}

function _esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function _shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname.slice(0,24) : "");
  } catch { return url.slice(0, 30); }
}

customElements.define("ta-chat", TaChat);
