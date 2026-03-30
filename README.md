# Travel Assistant — Home Assistant Add-on

A Home Assistant Supervisor add-on providing a full-featured travel itinerary manager with:

- **Interactive map + timeline** — Leaflet.js map with city markers and leg routes, synchronized with a scrollable timeline
- **Per-leg checklists** — progress bar, inline add/delete, check/uncheck
- **Document attachments** — upload boarding passes (PDF/image), view in modal, delete
- **Reminders** — set timed reminders that fire as HA events (usable in automations)
- **AI chat assistant** — Claude (Anthropic) or Gemini (Google) with web search, itinerary editing via natural language, and persistent rolling history

---

## Installation

### 1. Add the repository to Home Assistant

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**
2. Click the **⋮ menu** (top-right) → **Repositories**
3. Add the URL of this repository and click **Add**
4. Find **Travel Assistant** in the store and click **Install**

### 2. Configure the add-on

After installation, go to the add-on's **Configuration** tab:

| Option | Description | Default |
|---|---|---|
| `ai_provider` | AI chat provider: `"claude"`, `"gemini"`, or `"none"` | `"none"` |
| `anthropic_api_key` | Anthropic API key (required if `ai_provider = "claude"`) | `""` |
| `google_api_key` | Google AI API key (required if `ai_provider = "gemini"`) | `""` |

### 3. Start the add-on

Click **Start**. The panel will appear as **Travel** in the HA sidebar (✈ icon).

---

## Features

### Itinerary

The main view shows:
- **Map** — Leaflet.js map with a marker per city, colour-coded by leg status (blue=upcoming, green=active, grey=completed, red=cancelled). Flights use a curved arc, ground transport uses a dashed line.
- **Timeline** — Vertical spine with a node per leg showing icon, route, dates, status badge, and checklist mini-progress. Clicking a node pans the map and opens the leg detail card.

### Leg Detail Card

Tabs:
- **Checklist** — Per-leg checklist with progress bar. Add items inline. Due-offset badges shown if set.
- **Documents** — Upload PDFs or images (boarding passes, hotel confirmations, etc.). View in modal, delete.
- **Reminders** — Set date/time reminders. They fire `travel_assistant_reminder` HA events.
- **Chat** — AI chat tab (hidden when `ai_provider = "none"`).

Status can be changed from the leg card header (Upcoming → Active → Completed / Cancelled).

### AI Chat

Type naturally to:
- Ask about your itinerary, next flights, or what to pack
- Request web searches ("What are the entry requirements for Mexico?")
- Edit the itinerary ("Add a bus leg from Veracruz to Acayucan on April 20", "Mark the Madrid leg as completed", "Remind me 24h before the Bogotá flight to check in")

Tool-call confirmations appear as green chips in the chat. When data changes, the map and timeline refresh automatically.

Chat history is persisted per trip and summarised automatically when it grows long.

---

## HA Integration

### Events fired

| Event type | When |
|---|---|
| `travel_assistant_reminder` | A reminder's `fire_at` time is reached |

### Sensor entities (pushed to HA state machine)

| Entity | Value |
|---|---|
| `sensor.travel_next_leg` | "MAD → BOG" |
| `sensor.travel_days_until_departure` | Integer days |
| `sensor.travel_current_leg` | "BOG → MEX" (if active) |
| `sensor.travel_trip_progress` | 0–100 % of legs completed |

### Example automation

```yaml
trigger:
  - platform: event
    event_type: travel_assistant_reminder
action:
  - service: notify.mobile_app_my_phone
    data:
      message: "{{ trigger.event.data.label }}"
      title: "✈️ Travel Reminder"
```

---

## Pre-loaded Trip

On first start the add-on seeds the following itinerary:

**Madrid → Bogotá → CDMX → Veracruz → Acayucan → Guadalajara → CDMX → Bogotá → Madrid**

Each flight leg comes with a default checklist (passport, check-in, boarding pass, etc.). You can edit or delete legs and add new trips via the UI.

---

## Architecture

```
travel-assistant/
├── config.yaml          # HA add-on manifest
├── Dockerfile           # Python 3.11 container
├── run.sh               # Entrypoint (uvicorn)
├── requirements.txt
├── app/
│   ├── main.py          # FastAPI routes
│   ├── store.py         # JSON storage (/data/travel_assistant.json)
│   ├── models.py        # Dataclasses
│   ├── reminders.py     # asyncio-based scheduler
│   ├── ha_client.py     # Supervisor API calls (events + sensor states)
│   ├── chat.py          # Provider-agnostic ChatService
│   ├── seed.py          # Initial trip seed
│   └── ai_providers/
│       ├── claude_provider.py
│       └── gemini_provider.py
└── frontend/
    ├── index.html
    └── js/
        ├── api.js
        ├── city-coords.js
        ├── app.js                        # Root web component + routing
        └── components/
            ├── ta-itinerary-view.js      # Map + timeline
            ├── ta-map.js                 # Leaflet sub-component
            ├── ta-leg-card.js            # Leg detail + tabs
            ├── ta-checklist.js
            ├── ta-document-viewer.js
            ├── ta-reminder-editor.js
            └── ta-chat.js
```

Data is stored in `/data/travel_assistant.json` (persisted across restarts). Documents > 1 MB are stored as files in `/data/documents/`.
