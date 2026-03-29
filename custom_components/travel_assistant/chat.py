"""ChatService — provider-agnostic AI chat for Travel Assistant."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from homeassistant.util import dt as dt_util

from .const import AI_PROVIDER_CLAUDE, AI_PROVIDER_GEMINI, CONF_ANTHROPIC_API_KEY, CONF_GOOGLE_API_KEY

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

# Max chat_history entries before we summarise
_MAX_HISTORY_MESSAGES = 30
# Approximate token limit before summary kick-in
_SUMMARY_TOKEN_ESTIMATE = 8000

# ---------------------------------------------------------------------------
# Itinerary tool definitions (shared between providers)
# ---------------------------------------------------------------------------

ITINERARY_TOOLS = [
    {
        "name": "create_leg",
        "description": "Add a new travel leg to the trip.",
        "parameters": {
            "type": "object",
            "properties": {
                "trip_id": {"type": "string", "description": "Trip ID to add the leg to"},
                "type": {"type": "string", "enum": ["flight", "train", "bus", "drive", "ferry", "other"]},
                "origin": {"type": "string", "description": "Origin city or IATA code"},
                "destination": {"type": "string", "description": "Destination city or IATA code"},
                "depart_at": {"type": "string", "description": "ISO-8601 departure datetime with timezone"},
                "arrive_at": {"type": "string", "description": "ISO-8601 arrival datetime with timezone (optional)"},
                "carrier": {"type": "string", "description": "Airline or transport operator (optional)"},
                "flight_number": {"type": "string", "description": "Flight or service number (optional)"},
                "notes": {"type": "string", "description": "Free-text notes (optional)"},
            },
            "required": ["trip_id", "origin", "destination", "depart_at"],
        },
    },
    {
        "name": "update_leg",
        "description": "Update fields on an existing travel leg.",
        "parameters": {
            "type": "object",
            "properties": {
                "leg_id": {"type": "string"},
                "type": {"type": "string", "enum": ["flight", "train", "bus", "drive", "ferry", "other"]},
                "origin": {"type": "string"},
                "destination": {"type": "string"},
                "depart_at": {"type": "string", "description": "ISO-8601 datetime with timezone"},
                "arrive_at": {"type": "string"},
                "carrier": {"type": "string"},
                "flight_number": {"type": "string"},
                "notes": {"type": "string"},
                "status": {"type": "string", "enum": ["upcoming", "active", "completed", "cancelled"]},
            },
            "required": ["leg_id"],
        },
    },
    {
        "name": "delete_leg",
        "description": "Delete a travel leg from the trip.",
        "parameters": {
            "type": "object",
            "properties": {"leg_id": {"type": "string"}},
            "required": ["leg_id"],
        },
    },
    {
        "name": "set_leg_status",
        "description": "Change the status of a travel leg.",
        "parameters": {
            "type": "object",
            "properties": {
                "leg_id": {"type": "string"},
                "status": {"type": "string", "enum": ["upcoming", "active", "completed", "cancelled"]},
            },
            "required": ["leg_id", "status"],
        },
    },
    {
        "name": "add_checklist_item",
        "description": "Add a checklist item to a travel leg.",
        "parameters": {
            "type": "object",
            "properties": {
                "leg_id": {"type": "string"},
                "label": {"type": "string", "description": "Checklist item description"},
                "due_offset_hours": {"type": "integer", "description": "Hours before departure when this is due (optional)"},
            },
            "required": ["leg_id", "label"],
        },
    },
    {
        "name": "check_item",
        "description": "Mark a checklist item as done.",
        "parameters": {
            "type": "object",
            "properties": {"item_id": {"type": "string"}},
            "required": ["item_id"],
        },
    },
    {
        "name": "uncheck_item",
        "description": "Mark a checklist item as not done.",
        "parameters": {
            "type": "object",
            "properties": {"item_id": {"type": "string"}},
            "required": ["item_id"],
        },
    },
    {
        "name": "add_reminder",
        "description": "Add a reminder to a trip or leg.",
        "parameters": {
            "type": "object",
            "properties": {
                "parent_type": {"type": "string", "enum": ["trip", "leg"]},
                "parent_id": {"type": "string"},
                "label": {"type": "string"},
                "fire_at": {"type": "string", "description": "ISO-8601 datetime when the reminder fires"},
            },
            "required": ["parent_type", "parent_id", "label", "fire_at"],
        },
    },
    {
        "name": "delete_reminder",
        "description": "Delete a reminder.",
        "parameters": {
            "type": "object",
            "properties": {"reminder_id": {"type": "string"}},
            "required": ["reminder_id"],
        },
    },
]


# ---------------------------------------------------------------------------
# ChatService
# ---------------------------------------------------------------------------


class ChatService:
    """Provider-agnostic chat service with itinerary tool execution and history summarisation."""

    def __init__(self, entry: "ConfigEntry", store: "TravelStore") -> None:
        self._entry = entry
        self._store = store
        self._provider = self._build_provider()

    def _build_provider(self) -> Any | None:
        data = self._entry.data
        provider_name = data.get("ai_provider", "none")
        if provider_name == AI_PROVIDER_CLAUDE:
            from .ai_providers.claude_provider import ClaudeProvider
            return ClaudeProvider(data[CONF_ANTHROPIC_API_KEY])
        elif provider_name == AI_PROVIDER_GEMINI:
            from .ai_providers.gemini_provider import GeminiProvider
            return GeminiProvider(data[CONF_GOOGLE_API_KEY])
        return None

    @property
    def enabled(self) -> bool:
        return self._provider is not None

    async def async_chat(self, trip_id: str, user_message: str) -> dict:
        """
        Send a user message and return:
        {
            "reply": str,
            "sources": list[str],
            "data_changed": bool,
            "actions": list[{"tool": str, "summary": str}],
            "summary_updated": bool,
        }
        """
        if not self.enabled:
            return {"reply": "AI chat is not configured.", "sources": [], "data_changed": False, "actions": [], "summary_updated": False}

        trip = self._store.get_trip(trip_id)
        if trip is None:
            return {"reply": "Trip not found.", "sources": [], "data_changed": False, "actions": [], "summary_updated": False}

        # Build system prompt
        now = datetime.now(tz=timezone.utc)
        trip_context = self._store.get_trip_context(trip_id)
        system_prompt = _build_system_prompt(trip_context, now, trip.chat_summary)

        # Build message history
        messages = []
        if trip.chat_summary:
            messages.append({"role": "user", "content": f"[Previous conversation summary: {trip.chat_summary}]"})
            messages.append({"role": "assistant", "content": "Understood, I have the context of our previous conversation."})

        for entry in trip.chat_history:
            messages.append({"role": entry["role"], "content": entry["content"]})

        messages.append({"role": "user", "content": user_message})

        # Call provider
        result = await self._provider.chat(
            system_prompt=system_prompt,
            messages=messages,
            tools=ITINERARY_TOOLS,
        )

        reply = result.get("reply", "")
        sources = result.get("sources", [])
        tool_calls = result.get("tool_calls", [])

        # Execute itinerary tool calls
        data_changed = False
        actions = []
        from .const import EVENT_DATA_CHANGED

        for tc in tool_calls:
            tool_name = tc["name"]
            tool_input = tc.get("input", {})
            summary = await self._execute_tool(tool_name, tool_input)
            if summary:
                data_changed = True
                actions.append({"tool": tool_name, "summary": summary})

        if data_changed:
            self._store._schedule_save()

        # Update chat history
        trip.chat_history.append({"role": "user", "content": user_message, "ts": now.isoformat()})
        trip.chat_history.append({"role": "assistant", "content": reply, "ts": datetime.now(tz=timezone.utc).isoformat()})

        # Summarise if history is getting long
        summary_updated = False
        if len(trip.chat_history) >= _MAX_HISTORY_MESSAGES:
            await self._summarise_history(trip_id)
            summary_updated = True
        else:
            self._store._schedule_save()

        return {
            "reply": reply,
            "sources": sources,
            "data_changed": data_changed,
            "actions": actions,
            "summary_updated": summary_updated,
        }

    async def _execute_tool(self, name: str, args: dict) -> str | None:
        """Execute an itinerary tool and return a human-readable summary."""
        try:
            if name == "create_leg":
                trip_id = args.get("trip_id")
                if not trip_id:
                    return None
                depart_at = dt_util.parse_datetime(args["depart_at"])
                if depart_at and depart_at.tzinfo is None:
                    depart_at = dt_util.as_utc(depart_at)
                arrive_at = None
                if args.get("arrive_at"):
                    arrive_at = dt_util.parse_datetime(args["arrive_at"])
                    if arrive_at and arrive_at.tzinfo is None:
                        arrive_at = dt_util.as_utc(arrive_at)
                leg = await self._store.async_create_leg(
                    trip_id=trip_id,
                    type=args.get("type", "flight"),
                    origin=args["origin"],
                    destination=args["destination"],
                    depart_at=depart_at,
                    arrive_at=arrive_at,
                    carrier=args.get("carrier"),
                    flight_number=args.get("flight_number"),
                    notes=args.get("notes"),
                )
                return f"Created leg: {leg.origin} → {leg.destination} ({leg.type})"

            elif name == "update_leg":
                leg_id = args.get("leg_id")
                if not leg_id:
                    return None
                kwargs: dict = {}
                for field in ("type", "origin", "destination", "carrier", "flight_number", "notes", "status"):
                    if field in args:
                        kwargs[field] = args[field]
                for dt_field in ("depart_at", "arrive_at"):
                    if args.get(dt_field):
                        dt = dt_util.parse_datetime(args[dt_field])
                        if dt and dt.tzinfo is None:
                            dt = dt_util.as_utc(dt)
                        kwargs[dt_field] = dt
                leg = await self._store.async_update_leg(leg_id, **kwargs)
                return f"Updated leg: {leg.origin} → {leg.destination}"

            elif name == "delete_leg":
                leg = self._store.get_leg(args["leg_id"])
                label = f"{leg.origin} → {leg.destination}" if leg else args["leg_id"]
                await self._store.async_delete_leg(args["leg_id"])
                return f"Deleted leg: {label}"

            elif name == "set_leg_status":
                leg = await self._store.async_update_leg(args["leg_id"], status=args["status"])
                return f"Set {leg.origin} → {leg.destination} to {args['status']}"

            elif name == "add_checklist_item":
                item = await self._store.async_add_checklist_item(
                    args["leg_id"], args["label"], args.get("due_offset_hours")
                )
                leg = self._store.get_leg(item.leg_id)
                leg_label = f"{leg.origin} → {leg.destination}" if leg else item.leg_id
                return f"Added checklist item \"{item.label}\" to {leg_label}"

            elif name == "check_item":
                item = await self._store.async_set_checklist_item_checked(args["item_id"], True)
                return f"Checked off \"{item.label}\""

            elif name == "uncheck_item":
                item = await self._store.async_set_checklist_item_checked(args["item_id"], False)
                return f"Unchecked \"{item.label}\""

            elif name == "add_reminder":
                fire_at = dt_util.parse_datetime(args["fire_at"])
                if fire_at and fire_at.tzinfo is None:
                    fire_at = dt_util.as_utc(fire_at)
                reminder = await self._store.async_create_reminder(
                    parent_type=args["parent_type"],
                    parent_id=args["parent_id"],
                    label=args["label"],
                    fire_at=fire_at,
                )
                return f"Added reminder \"{reminder.label}\" at {fire_at}"

            elif name == "delete_reminder":
                reminder = self._store._reminders.get(args["reminder_id"])
                label = reminder.label if reminder else args["reminder_id"]
                await self._store.async_delete_reminder(args["reminder_id"])
                return f"Deleted reminder \"{label}\""

        except Exception as exc:
            _LOGGER.error("Tool %s failed: %s", name, exc)
        return None

    async def _summarise_history(self, trip_id: str) -> None:
        """Ask the model to summarise the chat history and replace it."""
        trip = self._store.get_trip(trip_id)
        if trip is None:
            return

        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in trip.chat_history
        )
        summary_prompt = (
            "Please summarise this conversation in 3-5 sentences, focusing on decisions made, "
            "itinerary changes, and important context for future messages:\n\n" + history_text
        )
        result = await self._provider.chat(
            system_prompt="You are a concise summariser.",
            messages=[{"role": "user", "content": summary_prompt}],
            tools=[],
        )
        trip.chat_summary = result.get("reply", "")
        trip.chat_history = []
        await self._store.async_save()


def _build_system_prompt(trip_context: dict, now: datetime, summary: str | None) -> str:
    lines = [
        "You are a helpful travel assistant embedded in Home Assistant.",
        f"Today's date/time (UTC): {now.isoformat()}",
        "",
        "Current trip:",
        json.dumps(trip_context, indent=2),
        "",
        "You can answer questions about the itinerary, search the web for travel information,",
        "and edit the itinerary using the provided tools.",
        "When making changes, always confirm what you did.",
        "Keep responses concise and helpful.",
    ]
    if summary:
        lines.insert(3, f"\nPrevious conversation context: {summary}\n")
    return "\n".join(lines)
