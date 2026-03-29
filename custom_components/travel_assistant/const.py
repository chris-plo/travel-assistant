"""Constants for the Travel Assistant integration."""

DOMAIN = "travel_assistant"
STORAGE_KEY = "travel_assistant"
STORAGE_VERSION = 1

# Config entry keys
CONF_AI_PROVIDER = "ai_provider"
CONF_ANTHROPIC_API_KEY = "anthropic_api_key"
CONF_GOOGLE_API_KEY = "google_api_key"

AI_PROVIDER_CLAUDE = "claude"
AI_PROVIDER_GEMINI = "gemini"
AI_PROVIDER_NONE = "none"

# HA bus event names
EVENT_REMINDER = "travel_assistant_reminder"
EVENT_CHECKLIST_CHANGED = "travel_assistant_checklist_changed"
EVENT_LEG_STATUS_CHANGED = "travel_assistant_leg_status_changed"
EVENT_DATA_CHANGED = "travel_assistant_data_changed"

# HA service names
SERVICE_FIRE_REMINDER = "fire_reminder"
SERVICE_CHECK_ITEM = "check_item"
SERVICE_UNCHECK_ITEM = "uncheck_item"
SERVICE_ADD_CHECKLIST_ITEM = "add_checklist_item"
SERVICE_SET_LEG_STATUS = "set_leg_status"
SERVICE_ADD_REMINDER = "add_reminder"
SERVICE_DELETE_REMINDER = "delete_reminder"

ALL_SERVICES = [
    SERVICE_FIRE_REMINDER,
    SERVICE_CHECK_ITEM,
    SERVICE_UNCHECK_ITEM,
    SERVICE_ADD_CHECKLIST_ITEM,
    SERVICE_SET_LEG_STATUS,
    SERVICE_ADD_REMINDER,
    SERVICE_DELETE_REMINDER,
]

# Panel
PANEL_URL = "travel-assistant"
PANEL_TITLE = "Travel"
PANEL_ICON = "mdi:airplane"
PANEL_MODULE_URL = "/local/travel-assistant/travel-assistant-panel.js"
PANEL_COMPONENT_NAME = "travel-assistant-panel"

# Leg types
LEG_TYPE_FLIGHT = "flight"
LEG_TYPE_TRAIN = "train"
LEG_TYPE_BUS = "bus"
LEG_TYPE_DRIVE = "drive"
LEG_TYPE_FERRY = "ferry"
LEG_TYPE_OTHER = "other"

LEG_TYPES = [LEG_TYPE_FLIGHT, LEG_TYPE_TRAIN, LEG_TYPE_BUS, LEG_TYPE_DRIVE, LEG_TYPE_FERRY, LEG_TYPE_OTHER]

# Leg statuses
LEG_STATUS_UPCOMING = "upcoming"
LEG_STATUS_ACTIVE = "active"
LEG_STATUS_COMPLETED = "completed"
LEG_STATUS_CANCELLED = "cancelled"

LEG_STATUSES = [LEG_STATUS_UPCOMING, LEG_STATUS_ACTIVE, LEG_STATUS_COMPLETED, LEG_STATUS_CANCELLED]

# Document storage modes
DOC_STORAGE_BASE64 = "base64"
DOC_STORAGE_FILEPATH = "filepath"
DOC_MAX_BASE64_BYTES = 1_000_000  # 1 MB
DOCS_DIR_NAME = "travel_assistant_docs"

# Sensor unique IDs
SENSOR_NEXT_LEG = "travel_assistant_next_leg"
SENSOR_DAYS_UNTIL_DEPARTURE = "travel_assistant_days_until_departure"
SENSOR_CURRENT_LEG = "travel_assistant_current_leg"
SENSOR_TRIP_PROGRESS = "travel_assistant_trip_progress"

# Service attribute keys
ATTR_LEG_ID = "leg_id"
ATTR_TRIP_ID = "trip_id"
ATTR_ITEM_ID = "item_id"
ATTR_REMINDER_ID = "reminder_id"
ATTR_ORIGIN = "origin"
ATTR_DESTINATION = "destination"
ATTR_DEPART_AT = "depart_at"
ATTR_ARRIVE_AT = "arrive_at"
ATTR_CARRIER = "carrier"
ATTR_FLIGHT_NUMBER = "flight_number"
ATTR_STATUS = "status"
ATTR_CHECKLIST_TOTAL = "checklist_total"
ATTR_CHECKLIST_DONE = "checklist_done"
ATTR_TRIP_NAME = "trip_name"
ATTR_TOTAL_LEGS = "total_legs"
ATTR_COMPLETED_LEGS = "completed_legs"
ATTR_UPCOMING_LEGS = "upcoming_legs"
