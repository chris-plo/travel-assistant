"""Provider-agnostic AI chat service for Travel Assistant."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

_MAX_HISTORY  = 30
_SUMMARY_WORDS = 8000  # rough token proxy

ITINERARY_TOOLS = [
    {"name": "create_leg", "description": "Add a new travel leg to the trip.",
     "parameters": {"type": "object", "required": ["trip_id", "origin", "destination", "depart_at"],
                    "properties": {
                        "trip_id":       {"type": "string"},
                        "type":          {"type": "string", "enum": ["flight","train","bus","drive","ferry","other"]},
                        "origin":        {"type": "string"},
                        "destination":   {"type": "string"},
                        "depart_at":     {"type": "string", "description": "ISO-8601 with timezone"},
                        "arrive_at":     {"type": "string"},
                        "carrier":       {"type": "string"},
                        "flight_number": {"type": "string"},
                        "notes":         {"type": "string"},
                    }}},
    {"name": "update_leg", "description": "Update fields on an existing transport leg (flight, bus, train, car, ferry). For hotels/accommodations use update_stay instead.",
     "parameters": {"type": "object", "required": ["leg_id"],
                    "properties": {
                        "leg_id":        {"type": "string"},
                        "type":          {"type": "string"},
                        "origin":        {"type": "string"},
                        "destination":   {"type": "string"},
                        "depart_at":     {"type": "string"},
                        "arrive_at":     {"type": "string"},
                        "carrier":       {"type": "string"},
                        "flight_number": {"type": "string"},
                        "notes":         {"type": "string"},
                        "status":        {"type": "string", "enum": ["upcoming","active","completed","cancelled"]},
                    }}},
    {"name": "delete_leg", "description": "Delete a travel leg.",
     "parameters": {"type": "object", "required": ["leg_id"],
                    "properties": {"leg_id": {"type": "string"}}}},
    {"name": "set_leg_status", "description": "Change the status of a leg.",
     "parameters": {"type": "object", "required": ["leg_id", "status"],
                    "properties": {
                        "leg_id": {"type": "string"},
                        "status": {"type": "string", "enum": ["upcoming","active","completed","cancelled"]},
                    }}},
    {"name": "add_checklist_item", "description": "Add a checklist item to a leg.",
     "parameters": {"type": "object", "required": ["leg_id", "label"],
                    "properties": {
                        "leg_id":           {"type": "string"},
                        "label":            {"type": "string"},
                        "due_offset_hours": {"type": "integer"},
                    }}},
    {"name": "check_item",   "description": "Mark a checklist item as done.",
     "parameters": {"type": "object", "required": ["item_id"],
                    "properties": {"item_id": {"type": "string"}}}},
    {"name": "uncheck_item", "description": "Mark a checklist item as not done.",
     "parameters": {"type": "object", "required": ["item_id"],
                    "properties": {"item_id": {"type": "string"}}}},
    {"name": "add_reminder", "description": "Add a reminder to a trip or leg.",
     "parameters": {"type": "object", "required": ["parent_type","parent_id","label","fire_at"],
                    "properties": {
                        "parent_type": {"type": "string", "enum": ["trip","leg"]},
                        "parent_id":   {"type": "string"},
                        "label":       {"type": "string"},
                        "fire_at":     {"type": "string"},
                    }}},
    {"name": "delete_reminder", "description": "Delete a reminder.",
     "parameters": {"type": "object", "required": ["reminder_id"],
                    "properties": {"reminder_id": {"type": "string"}}}},
    {"name": "create_stay", "description": "Add a new hotel or accommodation stay to the trip.",
     "parameters": {"type": "object", "required": ["trip_id", "name"],
                    "properties": {
                        "trip_id":             {"type": "string"},
                        "name":               {"type": "string", "description": "Hotel or property name"},
                        "location":           {"type": "string"},
                        "check_in":           {"type": "string", "description": "Date in YYYY-MM-DD format"},
                        "check_out":          {"type": "string", "description": "Date in YYYY-MM-DD format"},
                        "address":            {"type": "string"},
                        "confirmation_number": {"type": "string"},
                        "notes":              {"type": "string"},
                    }}},
    {"name": "update_stay", "description": "Update fields on an existing hotel/accommodation stay. Use stay_id from the trip context. Do NOT use this for transport legs.",
     "parameters": {"type": "object", "required": ["stay_id"],
                    "properties": {
                        "stay_id":            {"type": "string", "description": "ID of the stay to update"},
                        "name":               {"type": "string"},
                        "location":           {"type": "string"},
                        "check_in":           {"type": "string", "description": "Date in YYYY-MM-DD format"},
                        "check_out":          {"type": "string", "description": "Date in YYYY-MM-DD format"},
                        "address":            {"type": "string"},
                        "confirmation_number": {"type": "string"},
                        "notes":              {"type": "string"},
                    }}},
    {"name": "delete_stay", "description": "Delete a hotel/accommodation stay.",
     "parameters": {"type": "object", "required": ["stay_id"],
                    "properties": {"stay_id": {"type": "string"}}}},
]


class ChatService:
    def __init__(self, options: dict, store: TravelStore) -> None:
        self._store    = store
        self._provider = self._build_provider(options)

    def _build_provider(self, options: dict) -> Any | None:
        provider = options.get("ai_provider", "none")
        if provider == "claude":
            key = options.get("anthropic_api_key", "")
            if key:
                from .ai_providers.claude_provider import ClaudeProvider
                return ClaudeProvider(key, model=options.get("claude_model", "") or None)
        elif provider == "gemini":
            key = options.get("google_api_key", "")
            if key:
                from .ai_providers.gemini_provider import GeminiProvider
                return GeminiProvider(key)
        return None

    @property
    def enabled(self) -> bool:
        return self._provider is not None

    @property
    def provider(self) -> Any | None:
        return self._provider

    async def async_chat(self, trip_id: str, user_message: str) -> dict:
        if not self.enabled:
            return {"reply": "AI chat is not configured. Set an AI provider in the add-on options.",
                    "sources": [], "data_changed": False, "actions": [], "summary_updated": False}

        trip = self._store.get_trip(trip_id)
        if not trip:
            return {"reply": "Trip not found.", "sources": [], "data_changed": False,
                    "actions": [], "summary_updated": False}

        now           = datetime.now(tz=timezone.utc)
        system_prompt = _build_system_prompt(self._store.get_trip_context(trip_id), now, trip.chat_summary)

        messages = []
        if trip.chat_summary:
            messages += [
                {"role": "user", "content": f"[Previous conversation summary: {trip.chat_summary}]"},
                {"role": "assistant", "content": "Understood, I have context from our previous conversation."},
            ]
        for entry in trip.chat_history:
            messages.append({"role": entry["role"], "content": entry["content"]})
        messages.append({"role": "user", "content": user_message})

        result       = await self._provider.chat(system_prompt, messages, ITINERARY_TOOLS)
        reply        = result.get("reply", "")
        sources      = result.get("sources", [])
        tool_calls   = result.get("tool_calls", [])

        data_changed = False
        actions:     list[dict] = []
        for tc in tool_calls:
            summary = await self._execute_tool(tc["name"], tc.get("input", {}))
            if summary:
                data_changed = True
                actions.append({"tool": tc["name"], "summary": summary})

        if data_changed:
            self._store.schedule_save()

        trip.chat_history.append({"role": "user",      "content": user_message,  "ts": now.isoformat()})
        trip.chat_history.append({"role": "assistant", "content": reply,
                                   "ts": datetime.now(tz=timezone.utc).isoformat()})

        summary_updated = False
        if len(trip.chat_history) >= _MAX_HISTORY:
            await self._summarise(trip_id)
            summary_updated = True
        else:
            self._store.schedule_save()

        return {"reply": reply, "sources": sources,
                "data_changed": data_changed, "actions": actions, "summary_updated": summary_updated}

    async def _execute_tool(self, name: str, args: dict) -> str | None:
        from datetime import datetime as _dt
        try:
            if name == "create_leg":
                depart = _dt.fromisoformat(args["depart_at"])
                arrive = _dt.fromisoformat(args["arrive_at"]) if args.get("arrive_at") else None
                leg = await self._store.async_create_leg(
                    trip_id=args["trip_id"], type=args.get("type","flight"),
                    origin=args["origin"], destination=args["destination"],
                    depart_at=depart, arrive_at=arrive,
                    carrier=args.get("carrier"), flight_number=args.get("flight_number"),
                    notes=args.get("notes"),
                )
                return f"Created leg: {leg.origin} → {leg.destination}"
            elif name == "update_leg":
                kwargs = {k: v for k, v in args.items() if k != "leg_id"}
                for f in ("depart_at", "arrive_at"):
                    if kwargs.get(f): kwargs[f] = _dt.fromisoformat(kwargs[f])
                leg = await self._store.async_update_leg(args["leg_id"], **kwargs)
                return f"Updated leg: {leg.origin} → {leg.destination}"
            elif name == "delete_leg":
                leg = self._store.get_leg(args["leg_id"])
                lbl = f"{leg.origin} → {leg.destination}" if leg else args["leg_id"]
                await self._store.async_delete_leg(args["leg_id"])
                return f"Deleted leg: {lbl}"
            elif name == "set_leg_status":
                leg = await self._store.async_update_leg(args["leg_id"], status=args["status"])
                return f"Set {leg.origin} → {leg.destination} to {args['status']}"
            elif name == "add_checklist_item":
                item = await self._store.async_add_checklist_item(
                    args["leg_id"], args["label"], args.get("due_offset_hours"))
                leg  = self._store.get_leg(item.leg_id)
                lbl  = f"{leg.origin} → {leg.destination}" if leg else item.leg_id
                return f"Added checklist item \"{item.label}\" to {lbl}"
            elif name == "check_item":
                item = await self._store.async_set_item_checked(args["item_id"], True)
                return f"Checked off \"{item.label}\""
            elif name == "uncheck_item":
                item = await self._store.async_set_item_checked(args["item_id"], False)
                return f"Unchecked \"{item.label}\""
            elif name == "add_reminder":
                fire_at  = _dt.fromisoformat(args["fire_at"])
                reminder = await self._store.async_create_reminder(
                    args["parent_type"], args["parent_id"], args["label"], fire_at)
                return f"Added reminder \"{reminder.label}\""
            elif name == "delete_reminder":
                r   = self._store._reminders.get(args["reminder_id"])
                lbl = r.label if r else args["reminder_id"]
                await self._store.async_delete_reminder(args["reminder_id"])
                return f"Deleted reminder \"{lbl}\""
            elif name == "create_stay":
                from datetime import timezone as _utctz
                def _parse_date(s: str):
                    dt = _dt.fromisoformat(s.strip())
                    return dt.replace(tzinfo=_utctz.utc) if dt.tzinfo is None else dt
                stay = await self._store.async_create_stay(
                    trip_id=args["trip_id"], name=args["name"],
                    location=args.get("location"),
                    check_in=_parse_date(args["check_in"]) if args.get("check_in") else None,
                    check_out=_parse_date(args["check_out"]) if args.get("check_out") else None,
                    address=args.get("address"),
                    confirmation_number=args.get("confirmation_number"),
                    notes=args.get("notes"),
                )
                return f"Created stay: {stay.name}"
            elif name == "update_stay":
                from datetime import timezone as _utctz
                def _parse_date(s: str):
                    dt = _dt.fromisoformat(s.strip())
                    return dt.replace(tzinfo=_utctz.utc) if dt.tzinfo is None else dt
                kwargs = {k: v for k, v in args.items() if k != "stay_id"}
                for f in ("check_in", "check_out"):
                    if kwargs.get(f):
                        kwargs[f] = _parse_date(kwargs[f])
                stay = await self._store.async_update_stay(args["stay_id"], **kwargs)
                return f"Updated stay: {stay.name}"
            elif name == "delete_stay":
                stay = self._store.get_stay(args["stay_id"])
                lbl  = stay.name if stay else args["stay_id"]
                await self._store.async_delete_stay(args["stay_id"])
                return f"Deleted stay: {lbl}"
        except Exception as exc:
            _LOGGER.error("Tool %s failed: %s", name, exc)
        return None

    async def _summarise(self, trip_id: str) -> None:
        trip = self._store.get_trip(trip_id)
        if not trip: return
        history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in trip.chat_history)
        prompt = ("Summarise this conversation in 3-5 sentences, focusing on decisions made "
                  "and itinerary changes:\n\n" + history_text)
        result = await self._provider.chat("You are a concise summariser.",
                                           [{"role": "user", "content": prompt}], [])
        trip.chat_summary = result.get("reply", "")
        trip.chat_history = []
        await self._store.async_save()


def _build_system_prompt(trip_context: dict, now: datetime, summary: str | None) -> str:
    lines = [
        "You are a helpful travel assistant.",
        f"Today's date/time (UTC): {now.isoformat()}",
        "",
        "Current trip:",
        json.dumps(trip_context, indent=2),
        "",
        "You can answer questions about the itinerary, search the web, and edit the itinerary using tools.",
        "When making changes, confirm what you did. Be concise.",
    ]
    if summary:
        lines.insert(3, f"\nPrevious conversation context: {summary}\n")
    return "\n".join(lines)
