"""Travel Assistant — FastAPI application entry point."""
from __future__ import annotations

import base64
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .chat import ChatService
from .ha_client import fire_event, push_all_sensors
from .models import Leg
from .reminders import ReminderScheduler
from .seed import seed_initial_trip
from .store import DOCS_DIR, TravelStore

_LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App state
# ---------------------------------------------------------------------------

store:     TravelStore     | None = None
scheduler: ReminderScheduler | None = None
chat_svc:  ChatService     | None = None


def _options() -> dict:
    try:
        return json.loads(Path("/data/options.json").read_text())
    except Exception:
        return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store, scheduler, chat_svc

    store = TravelStore()
    await store.async_load()
    await seed_initial_trip(store)

    scheduler = ReminderScheduler(store)
    await scheduler.async_schedule_all()

    opts     = _options()
    chat_svc = ChatService(opts, store)

    # Push initial sensor states to HA
    await push_all_sensors(store)

    _LOGGER.info("Travel Assistant started")
    yield

    if scheduler:
        scheduler.shutdown()
    if store:
        await store.async_save()
    _LOGGER.info("Travel Assistant stopped")


app = FastAPI(title="Travel Assistant", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _store() -> TravelStore:
    if store is None:
        raise HTTPException(503, "Store not ready")
    return store


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(content=data, status_code=status)


def err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse(content={"error": msg}, status_code=status)


# ---------------------------------------------------------------------------
# Config (AI provider info for frontend)
# ---------------------------------------------------------------------------

@app.get("/api/config")
async def get_config():
    opts = _options()
    return ok({"ai_provider": opts.get("ai_provider", "none")})


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------

@app.get("/api/trips")
async def list_trips():
    s = _store()
    result = []
    for trip in s.get_all_trips():
        legs = s.get_legs_for_trip(trip.id)
        d = trip.to_dict()
        d.pop("chat_history", None)
        d["legs_summary"] = [
            {"id": l.id, "origin": l.origin, "destination": l.destination,
             "depart_at": l.depart_at.isoformat(), "status": l.status, "type": l.type}
            for l in legs
        ]
        result.append(d)
    return ok(result)


@app.post("/api/trips", status_code=201)
async def create_trip(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        return err("name is required")
    t = await _store().async_create_trip(name, body.get("description"))
    return ok(t.to_dict(), 201)


@app.get("/api/trips/{trip_id}")
async def get_trip(trip_id: str):
    s    = _store()
    trip = s.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    legs = s.get_legs_for_trip(trip_id)
    legs_out = []
    for leg in legs:
        ld = leg.to_dict()
        ld["checklist_items_detail"] = [i.to_dict() for i in s.get_checklist_items_for_leg(leg.id)]
        ld["documents_detail"]       = [d.to_meta_dict() for d in s.get_documents_for_leg(leg.id)]
        ld["reminders_detail"]       = [r.to_dict() for r in s.get_reminders_for_parent(leg.id)]
        legs_out.append(ld)
    d = trip.to_dict()
    d["legs_detail"] = legs_out
    return ok(d)


@app.put("/api/trips/{trip_id}")
async def update_trip(trip_id: str, request: Request):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    body    = await request.json()
    allowed = {"name", "description"}
    kwargs  = {k: v for k, v in body.items() if k in allowed}
    trip    = await s.async_update_trip(trip_id, **kwargs)
    return ok(trip.to_dict())


@app.delete("/api/trips/{trip_id}")
async def delete_trip(trip_id: str):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    await s.async_delete_trip(trip_id)
    await push_all_sensors(s)
    return ok({"status": "deleted"})


# ---------------------------------------------------------------------------
# Legs
# ---------------------------------------------------------------------------

@app.post("/api/trips/{trip_id}/legs", status_code=201)
async def create_leg(trip_id: str, request: Request):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    body = await request.json()
    for f in ("origin", "destination", "depart_at"):
        if not body.get(f):
            return err(f"{f} is required")
    depart_at = _parse_dt(body["depart_at"])
    arrive_at = _parse_dt(body.get("arrive_at"))
    leg = await s.async_create_leg(
        trip_id=trip_id, type=body.get("type","flight"),
        origin=body["origin"], destination=body["destination"],
        depart_at=depart_at, arrive_at=arrive_at,
        carrier=body.get("carrier"), flight_number=body.get("flight_number"),
        notes=body.get("notes"), status=body.get("status","upcoming"),
    )
    await push_all_sensors(s)
    return ok(leg.to_dict(), 201)


@app.get("/api/legs/{leg_id}")
async def get_leg(leg_id: str):
    s   = _store()
    leg = s.get_leg(leg_id)
    if not leg:
        raise HTTPException(404, "Leg not found")
    ld = leg.to_dict()
    ld["checklist_items_detail"] = [i.to_dict() for i in s.get_checklist_items_for_leg(leg_id)]
    ld["documents_detail"]       = [d.to_meta_dict() for d in s.get_documents_for_leg(leg_id)]
    ld["reminders_detail"]       = [r.to_dict() for r in s.get_reminders_for_parent(leg_id)]
    return ok(ld)


@app.put("/api/legs/{leg_id}")
async def update_leg(leg_id: str, request: Request):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    body    = await request.json()
    allowed = {"type","origin","destination","depart_at","arrive_at","carrier",
               "flight_number","notes","status","sequence"}
    kwargs: dict[str, Any] = {}
    for k in allowed:
        if k in body:
            kwargs[k] = _parse_dt(body[k]) if k in ("depart_at","arrive_at") and body[k] else body[k]
    leg = await s.async_update_leg(leg_id, **kwargs)
    await push_all_sensors(s)
    return ok(leg.to_dict())


@app.delete("/api/legs/{leg_id}")
async def delete_leg(leg_id: str):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    await s.async_delete_leg(leg_id)
    await push_all_sensors(s)
    return ok({"status": "deleted"})


# ---------------------------------------------------------------------------
# Checklist
# ---------------------------------------------------------------------------

@app.get("/api/legs/{leg_id}/checklist")
async def list_checklist(leg_id: str):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    return ok([i.to_dict() for i in s.get_checklist_items_for_leg(leg_id)])


@app.post("/api/legs/{leg_id}/checklist", status_code=201)
async def add_checklist_item(leg_id: str, request: Request):
    s    = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    body  = await request.json()
    label = (body.get("label") or "").strip()
    if not label:
        return err("label is required")
    item = await s.async_add_checklist_item(leg_id, label, body.get("due_offset_hours"))
    await fire_event("travel_assistant_checklist_changed", {"item_id": item.id, "leg_id": leg_id})
    return ok(item.to_dict(), 201)


@app.patch("/api/checklist/{item_id}")
async def patch_checklist_item(item_id: str, request: Request):
    s = _store()
    if item_id not in s._checklist_items:
        raise HTTPException(404, "Item not found")
    body = await request.json()
    item = s._checklist_items[item_id]
    if "checked" in body:
        item = await s.async_set_item_checked(item_id, bool(body["checked"]))
    if "label" in body:
        item.label = body["label"]
        s.schedule_save()
    await fire_event("travel_assistant_checklist_changed", {"item_id": item_id})
    return ok(item.to_dict())


@app.delete("/api/checklist/{item_id}")
async def delete_checklist_item(item_id: str):
    s = _store()
    if item_id not in s._checklist_items:
        raise HTTPException(404, "Item not found")
    await s.async_delete_checklist_item(item_id)
    return ok({"status": "deleted"})


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@app.get("/api/legs/{leg_id}/documents")
async def list_documents(leg_id: str):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    return ok([d.to_meta_dict() for d in s.get_documents_for_leg(leg_id)])


@app.post("/api/legs/{leg_id}/documents", status_code=201)
async def upload_document(leg_id: str, request: Request):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    body     = await request.json()
    filename = (body.get("filename") or "").strip()
    content  = body.get("content", "")
    if not filename or not content:
        return err("filename and content are required")

    mime_type    = body.get("mime_type", "application/octet-stream")
    storage_mode = "base64"
    final_content = content

    if len(content.encode()) > 1_000_000:
        # Write to file
        storage_mode = "filepath"
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        import uuid
        doc_id_tmp = str(uuid.uuid4())
        file_path  = DOCS_DIR / f"{doc_id_tmp}_{Path(filename).name}"
        file_path.write_bytes(base64.b64decode(content))
        final_content = str(file_path)

    doc = await s.async_add_document(leg_id, filename, mime_type, storage_mode, final_content)

    if storage_mode == "filepath":
        # Rename to use real doc id
        new_path = DOCS_DIR / f"{doc.id}_{Path(filename).name}"
        Path(final_content).rename(new_path)
        s._documents[doc.id].content = str(new_path)
        s.schedule_save()

    return ok(doc.to_meta_dict(), 201)


@app.get("/api/documents/{doc_id}")
async def get_document(doc_id: str):
    s   = _store()
    doc = s._documents.get(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.storage_mode == "filepath":
        path = Path(doc.content)
        if not str(path.resolve()).startswith(str(DOCS_DIR.resolve())):
            raise HTTPException(403, "Access denied")
        content_b64 = base64.b64encode(path.read_bytes()).decode()
    else:
        content_b64 = doc.content
    result = doc.to_meta_dict()
    result["content"] = content_b64
    return ok(result)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    s = _store()
    if doc_id not in s._documents:
        raise HTTPException(404, "Document not found")
    await s.async_delete_document(doc_id)
    return ok({"status": "deleted"})


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

@app.post("/api/reminders", status_code=201)
async def create_reminder(request: Request):
    s    = _store()
    body = await request.json()
    for f in ("parent_type","parent_id","label","fire_at"):
        if not body.get(f):
            return err(f"{f} is required")
    fire_at = _parse_dt(body["fire_at"])
    if not fire_at:
        return err("Invalid fire_at")
    reminder = await s.async_create_reminder(
        body["parent_type"], body["parent_id"], body["label"],
        fire_at, body.get("event_data", {}),
    )
    if scheduler:
        scheduler.schedule_reminder(reminder)
    return ok(reminder.to_dict(), 201)


@app.put("/api/reminders/{reminder_id}")
async def update_reminder(reminder_id: str, request: Request):
    s = _store()
    r = s._reminders.get(reminder_id)
    if not r:
        raise HTTPException(404, "Reminder not found")
    body = await request.json()
    if "label" in body:
        r.label = body["label"]
    if "fire_at" in body:
        r.fire_at = _parse_dt(body["fire_at"])
        r.fired   = False
        if scheduler:
            scheduler.schedule_reminder(r)
    s.schedule_save()
    return ok(r.to_dict())


@app.delete("/api/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str):
    s = _store()
    if reminder_id not in s._reminders:
        raise HTTPException(404, "Reminder not found")
    if scheduler:
        scheduler.cancel_reminder(reminder_id)
    await s.async_delete_reminder(reminder_id)
    return ok({"status": "deleted"})


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@app.post("/api/chat")
async def chat(request: Request):
    if not chat_svc or not chat_svc.enabled:
        raise HTTPException(503, "AI chat not configured. Set ai_provider in add-on options.")
    body    = await request.json()
    trip_id = (body.get("trip_id") or "").strip()
    message = (body.get("message") or "").strip()
    if not trip_id or not message:
        return err("trip_id and message are required")
    result = await chat_svc.async_chat(trip_id, message)
    if result.get("data_changed"):
        await push_all_sensors(_store())
    return ok(result)


# ---------------------------------------------------------------------------
# Frontend — served last so API routes take priority
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
