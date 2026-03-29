# Travel Assistant — Home Assistant Custom Integration

A full-featured travel planner that lives inside Home Assistant, built for multi-city trips.

## Features

- **Interactive map** — Leaflet.js route map with city markers and animated flight arcs
- **Timeline itinerary** — vertical spine with leg cards showing status, dates, and checklist progress
- **Per-leg checklists** — checkboxes, progress bar, due-offset badges; pre-seeded for flights and buses
- **Document attachments** — upload boarding passes (PDF/image), view inline, delete
- **Reminders** — fire HA bus events at a scheduled time; automations can listen to `travel_assistant_reminder`
- **4 HA sensor entities** — next leg, days until departure, current leg, trip progress %
- **7 HA services** — callable from automations to check items, change leg status, fire reminders, etc.
- **AI chat assistant** — Claude (Anthropic) or Gemini (Google) with web search; can edit the itinerary via natural language
- **Persistent chat history** — rolling summary keeps context across sessions

---

## Installation

### 1. Copy files into your HA config

```
/config/
├── custom_components/
│   └── travel_assistant/       ← copy this folder
└── www/
    └── travel-assistant/       ← copy this folder
```

### 2. Add the integration

1. Go to **Settings → Integrations → Add Integration**
2. Search for **Travel Assistant**
3. Follow the setup wizard:
   - Step 1: Confirm setup (no config needed)
   - Step 2: Choose AI provider (Claude / Gemini / None) and enter API key

On first run, the **Madrid → Bogotá → CDMX → Veracruz → Acayucan → Guadalajara → CDMX → Bogotá → Madrid** itinerary is pre-loaded with default checklists.

### 3. Open the panel

Click **Travel** in the HA sidebar (airplane icon).

---

## Sensor Entities

| Entity | Description |
|---|---|
| `sensor.travel_next_leg` | Origin → Destination of next upcoming leg |
| `sensor.travel_days_until_departure` | Integer days until next departure |
| `sensor.travel_current_leg` | Origin → Destination of active leg |
| `sensor.travel_trip_progress` | % of legs completed |

---

## HA Services

| Service | Parameters | Description |
|---|---|---|
| `travel_assistant.check_item` | `item_id` | Mark checklist item done |
| `travel_assistant.uncheck_item` | `item_id` | Unmark checklist item |
| `travel_assistant.add_checklist_item` | `leg_id, label, due_offset_hours?` | Add item to a leg |
| `travel_assistant.set_leg_status` | `leg_id, status` | Set leg status |
| `travel_assistant.fire_reminder` | `reminder_id` | Fire a reminder immediately |
| `travel_assistant.add_reminder` | `parent_type, parent_id, label, fire_at, event_data?` | Schedule a reminder |
| `travel_assistant.delete_reminder` | `reminder_id` | Cancel and delete a reminder |

---

## Automation Integration

### Listen to reminders

```yaml
automation:
  - alias: "Travel reminder notification"
    trigger:
      - platform: event
        event_type: travel_assistant_reminder
    action:
      - service: notify.mobile_app_my_phone
        data:
          title: "Travel Reminder"
          message: "{{ trigger.event.data.label }}"
```

### Automatically mark leg active when departing

```yaml
automation:
  - alias: "Mark current leg active"
    trigger:
      - platform: numeric_state
        entity_id: sensor.travel_days_until_departure
        below: 0.05   # ~1 hour away
    action:
      - service: travel_assistant.set_leg_status
        data:
          leg_id: "{{ state_attr('sensor.travel_next_leg', 'leg_id') }}"
          status: active
```

---

## AI Chat

The chat assistant can:
- Answer questions about the itinerary ("When does my Bogotá flight land?")
- Search the web ("What are visa requirements for Mexico from Colombia?")
- Edit the itinerary ("Add a checklist item 'print boarding pass' to the Madrid leg")
- Create and delete legs, reminders, checklist items

**To enable:** enter an API key during setup.
- Claude: get one at console.anthropic.com
- Gemini: get one at aistudio.google.com

---

## REST API

All endpoints are under `/api/travel_assistant/` and require HA authentication.

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/trips` | List / create trips |
| GET/PUT/DELETE | `/trips/{id}` | Trip detail / update / delete |
| POST | `/trips/{id}/legs` | Add a leg |
| GET/PUT/DELETE | `/legs/{id}` | Leg detail / update / delete |
| GET/POST | `/legs/{id}/checklist` | List / add checklist items |
| PATCH/DELETE | `/checklist/{id}` | Update / delete item |
| GET/POST | `/legs/{id}/documents` | List / upload documents |
| GET/DELETE | `/documents/{id}` | View (with content) / delete |
| POST | `/reminders` | Create reminder |
| PUT/DELETE | `/reminders/{id}` | Update / delete reminder |
| POST | `/chat` | Send AI chat message |

---

## Timezones

All departure/arrival times are stored as timezone-aware ISO-8601 strings. The pre-seeded itinerary uses:

| Route | Timezone |
|---|---|
| Madrid | UTC+2 (CEST) |
| Bogotá | UTC-5 |
| CDMX / Veracruz / Acayucan / Guadalajara | UTC-6 |
