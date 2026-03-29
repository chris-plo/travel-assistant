"""REST API views for Travel Assistant."""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import DOC_MAX_BASE64_BYTES, DOC_STORAGE_BASE64, DOC_STORAGE_FILEPATH, DOCS_DIR_NAME

if TYPE_CHECKING:
    from .reminders import ReminderScheduler
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)


def _docs_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.config_dir) / DOCS_DIR_NAME


def _safe_doc_path(hass: HomeAssistant, doc_id: str, filename: str) -> Path:
    """Return safe absolute path for a document file."""
    docs = _docs_dir(hass)
    safe_name = f"{doc_id}_{Path(filename).name}"
    path = (docs / safe_name).resolve()
    if not str(path).startswith(str(docs.resolve())):
        raise PermissionError("Path traversal detected")
    return path


def register_views(
    hass: HomeAssistant,
    store: "TravelStore",
    scheduler: "ReminderScheduler",
    chat_service: Any = None,
) -> None:
    """Register all REST API views."""
    hass.http.register_view(TravelTripListView(store))
    hass.http.register_view(TravelTripDetailView(store))
    hass.http.register_view(TravelLegListView(store))
    hass.http.register_view(TravelLegDetailView(store))
    hass.http.register_view(TravelChecklistView(store))
    hass.http.register_view(TravelChecklistItemView(store))
    hass.http.register_view(TravelDocumentListView(hass, store))
    hass.http.register_view(TravelDocumentDetailView(hass, store))
    hass.http.register_view(TravelReminderListView(store, scheduler))
    hass.http.register_view(TravelReminderDetailView(store, scheduler))
    hass.http.register_view(TravelChatView(store, chat_service))


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------


class TravelTripListView(HomeAssistantView):
    url = "/api/travel_assistant/trips"
    name = "api:travel_assistant:trips"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def get(self, request: web.Request) -> web.Response:
        trips = self._store.get_all_trips()
        result = []
        for trip in trips:
            legs = self._store.get_legs_for_trip(trip.id)
            d = trip.to_dict()
            d.pop("chat_history", None)
            d["leg_count"] = len(legs)
            d["legs_summary"] = [
                {"id": l.id, "origin": l.origin, "destination": l.destination,
                 "depart_at": l.depart_at.isoformat(), "status": l.status, "type": l.type}
                for l in legs
            ]
            result.append(d)
        return self.json(result)

    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)
        name = body.get("name", "").strip()
        if not name:
            return self.json_message("name is required", HTTPStatus.BAD_REQUEST)
        trip = await self._store.async_create_trip(name, body.get("description"))
        return self.json(trip.to_dict(), HTTPStatus.CREATED)


class TravelTripDetailView(HomeAssistantView):
    url = "/api/travel_assistant/trips/{trip_id}"
    name = "api:travel_assistant:trip"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def get(self, request: web.Request, trip_id: str) -> web.Response:
        trip = self._store.get_trip(trip_id)
        if trip is None:
            return self.json_message("Trip not found", HTTPStatus.NOT_FOUND)
        legs = self._store.get_legs_for_trip(trip_id)
        legs_out = []
        for leg in legs:
            ld = leg.to_dict()
            items = self._store.get_checklist_items_for_leg(leg.id)
            ld["checklist_items_detail"] = [i.to_dict() for i in items]
            docs = self._store.get_documents_for_leg(leg.id)
            ld["documents_detail"] = [d.to_meta_dict() for d in docs]
            rems = self._store.get_reminders_for_parent(leg.id)
            ld["reminders_detail"] = [r.to_dict() for r in rems]
            legs_out.append(ld)
        d = trip.to_dict()
        d["legs_detail"] = legs_out
        return self.json(d)

    async def put(self, request: web.Request, trip_id: str) -> web.Response:
        trip = self._store.get_trip(trip_id)
        if trip is None:
            return self.json_message("Trip not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)
        allowed = {"name", "description"}
        kwargs = {k: v for k, v in body.items() if k in allowed}
        trip = await self._store.async_update_trip(trip_id, **kwargs)
        return self.json(trip.to_dict())

    async def delete(self, request: web.Request, trip_id: str) -> web.Response:
        if self._store.get_trip(trip_id) is None:
            return self.json_message("Trip not found", HTTPStatus.NOT_FOUND)
        await self._store.async_delete_trip(trip_id)
        return self.json_message("Deleted", HTTPStatus.OK)


# ---------------------------------------------------------------------------
# Legs
# ---------------------------------------------------------------------------


class TravelLegListView(HomeAssistantView):
    url = "/api/travel_assistant/trips/{trip_id}/legs"
    name = "api:travel_assistant:legs"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def post(self, request: web.Request, trip_id: str) -> web.Response:
        if self._store.get_trip(trip_id) is None:
            return self.json_message("Trip not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)

        required = {"origin", "destination", "depart_at"}
        missing = required - body.keys()
        if missing:
            return self.json_message(f"Missing fields: {missing}", HTTPStatus.BAD_REQUEST)

        try:
            depart_at = dt_util.parse_datetime(body["depart_at"])
            arrive_at = dt_util.parse_datetime(body["arrive_at"]) if body.get("arrive_at") else None
        except Exception as exc:
            return self.json_message(f"Invalid datetime: {exc}", HTTPStatus.BAD_REQUEST)

        if depart_at is None:
            return self.json_message("Invalid depart_at", HTTPStatus.BAD_REQUEST)
        if depart_at.tzinfo is None:
            depart_at = dt_util.as_utc(depart_at)
        if arrive_at and arrive_at.tzinfo is None:
            arrive_at = dt_util.as_utc(arrive_at)

        leg = await self._store.async_create_leg(
            trip_id=trip_id,
            type=body.get("type", "flight"),
            origin=body["origin"],
            destination=body["destination"],
            depart_at=depart_at,
            arrive_at=arrive_at,
            carrier=body.get("carrier"),
            flight_number=body.get("flight_number"),
            notes=body.get("notes"),
            status=body.get("status", "upcoming"),
        )
        return self.json(leg.to_dict(), HTTPStatus.CREATED)


class TravelLegDetailView(HomeAssistantView):
    url = "/api/travel_assistant/legs/{leg_id}"
    name = "api:travel_assistant:leg"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def get(self, request: web.Request, leg_id: str) -> web.Response:
        leg = self._store.get_leg(leg_id)
        if leg is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        ld = leg.to_dict()
        ld["checklist_items_detail"] = [i.to_dict() for i in self._store.get_checklist_items_for_leg(leg_id)]
        ld["documents_detail"] = [d.to_meta_dict() for d in self._store.get_documents_for_leg(leg_id)]
        ld["reminders_detail"] = [r.to_dict() for r in self._store.get_reminders_for_parent(leg_id)]
        return self.json(ld)

    async def put(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)

        allowed = {"type", "origin", "destination", "depart_at", "arrive_at",
                   "carrier", "flight_number", "notes", "status", "sequence"}
        kwargs: dict[str, Any] = {}
        for key in allowed:
            if key in body:
                if key in ("depart_at", "arrive_at") and body[key]:
                    dt = dt_util.parse_datetime(body[key])
                    if dt and dt.tzinfo is None:
                        dt = dt_util.as_utc(dt)
                    kwargs[key] = dt
                else:
                    kwargs[key] = body[key]

        leg = await self._store.async_update_leg(leg_id, **kwargs)
        return self.json(leg.to_dict())

    async def delete(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        await self._store.async_delete_leg(leg_id)
        return self.json_message("Deleted", HTTPStatus.OK)


# ---------------------------------------------------------------------------
# Checklist
# ---------------------------------------------------------------------------


class TravelChecklistView(HomeAssistantView):
    url = "/api/travel_assistant/legs/{leg_id}/checklist"
    name = "api:travel_assistant:checklist"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def get(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        items = self._store.get_checklist_items_for_leg(leg_id)
        return self.json([i.to_dict() for i in items])

    async def post(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)
        label = body.get("label", "").strip()
        if not label:
            return self.json_message("label is required", HTTPStatus.BAD_REQUEST)
        item = await self._store.async_add_checklist_item(
            leg_id, label, body.get("due_offset_hours")
        )
        return self.json(item.to_dict(), HTTPStatus.CREATED)


class TravelChecklistItemView(HomeAssistantView):
    url = "/api/travel_assistant/checklist/{item_id}"
    name = "api:travel_assistant:checklist_item"
    requires_auth = True

    def __init__(self, store: "TravelStore") -> None:
        self._store = store

    async def patch(self, request: web.Request, item_id: str) -> web.Response:
        if item_id not in self._store._checklist_items:
            return self.json_message("Item not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)
        if "checked" in body:
            item = await self._store.async_set_checklist_item_checked(item_id, bool(body["checked"]))
        if "label" in body:
            self._store._checklist_items[item_id].label = body["label"]
            self._store._schedule_save()
            item = self._store._checklist_items[item_id]
        return self.json(item.to_dict())

    async def delete(self, request: web.Request, item_id: str) -> web.Response:
        if item_id not in self._store._checklist_items:
            return self.json_message("Item not found", HTTPStatus.NOT_FOUND)
        await self._store.async_delete_checklist_item(item_id)
        return self.json_message("Deleted", HTTPStatus.OK)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


class TravelDocumentListView(HomeAssistantView):
    url = "/api/travel_assistant/legs/{leg_id}/documents"
    name = "api:travel_assistant:documents"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: "TravelStore") -> None:
        self._hass = hass
        self._store = store

    async def get(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        docs = self._store.get_documents_for_leg(leg_id)
        return self.json([d.to_meta_dict() for d in docs])

    async def post(self, request: web.Request, leg_id: str) -> web.Response:
        if self._store.get_leg(leg_id) is None:
            return self.json_message("Leg not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)

        filename = body.get("filename", "").strip()
        mime_type = body.get("mime_type", "application/octet-stream")
        content: str = body.get("content", "")

        if not filename or not content:
            return self.json_message("filename and content are required", HTTPStatus.BAD_REQUEST)

        # Decide storage mode
        storage_mode = body.get("storage_mode", DOC_STORAGE_BASE64)
        if len(content.encode()) > DOC_MAX_BASE64_BYTES:
            storage_mode = DOC_STORAGE_FILEPATH

        if storage_mode == DOC_STORAGE_FILEPATH:
            # Write to filesystem
            from uuid import uuid4
            doc_id_tmp = str(uuid4())
            docs_dir = _docs_dir(self._hass)
            docs_dir.mkdir(parents=True, exist_ok=True)
            file_path = _safe_doc_path(self._hass, doc_id_tmp, filename)
            try:
                file_bytes = base64.b64decode(content)
                file_path.write_bytes(file_bytes)
            except Exception as exc:
                return self.json_message(f"Failed to write file: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)

            doc = await self._store.async_add_document(
                leg_id, filename, mime_type, DOC_STORAGE_FILEPATH, str(file_path)
            )
            # Rename to use real doc id
            new_path = _safe_doc_path(self._hass, doc.id, filename)
            try:
                file_path.rename(new_path)
                await self._store.async_update_leg(leg_id)  # no-op to trigger save
                self._store._documents[doc.id].content = str(new_path)
                self._store._schedule_save()
            except Exception:
                pass
        else:
            doc = await self._store.async_add_document(
                leg_id, filename, mime_type, DOC_STORAGE_BASE64, content
            )

        return self.json(doc.to_meta_dict(), HTTPStatus.CREATED)


class TravelDocumentDetailView(HomeAssistantView):
    url = "/api/travel_assistant/documents/{doc_id}"
    name = "api:travel_assistant:document"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: "TravelStore") -> None:
        self._hass = hass
        self._store = store

    async def get(self, request: web.Request, doc_id: str) -> web.Response:
        doc = self._store._documents.get(doc_id)
        if doc is None:
            return self.json_message("Document not found", HTTPStatus.NOT_FOUND)

        if doc.storage_mode == DOC_STORAGE_FILEPATH:
            try:
                path = Path(doc.content).resolve()
                docs_dir = _docs_dir(self._hass).resolve()
                if not str(path).startswith(str(docs_dir)):
                    return self.json_message("Access denied", HTTPStatus.FORBIDDEN)
                content_b64 = base64.b64encode(path.read_bytes()).decode()
            except Exception as exc:
                return self.json_message(f"Failed to read file: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)
        else:
            content_b64 = doc.content

        result = doc.to_meta_dict()
        result["content"] = content_b64
        return self.json(result)

    async def delete(self, request: web.Request, doc_id: str) -> web.Response:
        doc = self._store._documents.get(doc_id)
        if doc is None:
            return self.json_message("Document not found", HTTPStatus.NOT_FOUND)

        if doc.storage_mode == DOC_STORAGE_FILEPATH:
            try:
                Path(doc.content).unlink(missing_ok=True)
            except Exception:
                pass

        await self._store.async_delete_document(doc_id)
        return self.json_message("Deleted", HTTPStatus.OK)


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------


class TravelReminderListView(HomeAssistantView):
    url = "/api/travel_assistant/reminders"
    name = "api:travel_assistant:reminders"
    requires_auth = True

    def __init__(self, store: "TravelStore", scheduler: "ReminderScheduler") -> None:
        self._store = store
        self._scheduler = scheduler

    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)

        required = {"parent_type", "parent_id", "label", "fire_at"}
        missing = required - body.keys()
        if missing:
            return self.json_message(f"Missing fields: {missing}", HTTPStatus.BAD_REQUEST)

        fire_at = dt_util.parse_datetime(body["fire_at"])
        if fire_at is None:
            return self.json_message("Invalid fire_at datetime", HTTPStatus.BAD_REQUEST)
        if fire_at.tzinfo is None:
            fire_at = dt_util.as_utc(fire_at)

        reminder = await self._store.async_create_reminder(
            parent_type=body["parent_type"],
            parent_id=body["parent_id"],
            label=body["label"],
            fire_at=fire_at,
            event_data=body.get("event_data", {}),
        )
        self._scheduler.schedule_reminder(reminder)
        return self.json(reminder.to_dict(), HTTPStatus.CREATED)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


class TravelChatView(HomeAssistantView):
    url = "/api/travel_assistant/chat"
    name = "api:travel_assistant:chat"
    requires_auth = True

    def __init__(self, store: "TravelStore", chat_service: Any) -> None:
        self._store = store
        self._chat = chat_service

    async def post(self, request: web.Request) -> web.Response:
        if self._chat is None or not self._chat.enabled:
            return self.json_message("AI chat is not configured", HTTPStatus.SERVICE_UNAVAILABLE)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)
        trip_id = body.get("trip_id", "").strip()
        message = body.get("message", "").strip()
        if not trip_id or not message:
            return self.json_message("trip_id and message are required", HTTPStatus.BAD_REQUEST)
        try:
            result = await self._chat.async_chat(trip_id, message)
            return self.json(result)
        except Exception as exc:
            _LOGGER.error("Chat error: %s", exc)
            return self.json_message(f"Chat error: {exc}", HTTPStatus.INTERNAL_SERVER_ERROR)


class TravelReminderDetailView(HomeAssistantView):
    url = "/api/travel_assistant/reminders/{reminder_id}"
    name = "api:travel_assistant:reminder"
    requires_auth = True

    def __init__(self, store: "TravelStore", scheduler: "ReminderScheduler") -> None:
        self._store = store
        self._scheduler = scheduler

    async def put(self, request: web.Request, reminder_id: str) -> web.Response:
        reminder = self._store._reminders.get(reminder_id)
        if reminder is None:
            return self.json_message("Reminder not found", HTTPStatus.NOT_FOUND)
        try:
            body = await request.json()
        except Exception:
            return self.json_message("Invalid JSON", HTTPStatus.BAD_REQUEST)

        if "label" in body:
            reminder.label = body["label"]
        if "fire_at" in body:
            fire_at = dt_util.parse_datetime(body["fire_at"])
            if fire_at is None:
                return self.json_message("Invalid fire_at", HTTPStatus.BAD_REQUEST)
            if fire_at.tzinfo is None:
                fire_at = dt_util.as_utc(fire_at)
            reminder.fire_at = fire_at
            reminder.fired = False
            self._scheduler.schedule_reminder(reminder)

        self._store._schedule_save()
        return self.json(reminder.to_dict())

    async def delete(self, request: web.Request, reminder_id: str) -> web.Response:
        if reminder_id not in self._store._reminders:
            return self.json_message("Reminder not found", HTTPStatus.NOT_FOUND)
        self._scheduler.cancel_reminder(reminder_id)
        await self._store.async_delete_reminder(reminder_id)
        return self.json_message("Deleted", HTTPStatus.OK)
