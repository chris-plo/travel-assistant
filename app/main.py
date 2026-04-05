"""Travel Assistant — FastAPI application entry point."""
from __future__ import annotations

import base64
import json
import urllib.parse
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
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

store:     TravelStore       | None = None
scheduler: ReminderScheduler | None = None
chat_svc:  ChatService       | None = None


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


def _parse_local_dt(dt_str: str | None, tz_str: str | None) -> "datetime | None":
    """Parse a local datetime string (from datetime-local input) with a timezone."""
    if not dt_str:
        return None
    from datetime import datetime as _dt
    try:
        naive = _dt.fromisoformat(dt_str)
    except ValueError:
        return None
    if naive.tzinfo is not None:
        return naive  # already timezone-aware, pass through
    if tz_str:
        from zoneinfo import ZoneInfo
        try:
            return naive.replace(tzinfo=ZoneInfo(tz_str))
        except Exception:
            pass
    # No timezone info — store as UTC
    from datetime import timezone as _tz
    return naive.replace(tzinfo=_tz.utc)


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(content=data, status_code=status)


def err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse(content={"error": msg}, status_code=status)


def _expand_leg(s: TravelStore, leg_id: str) -> dict:
    leg = s.get_leg(leg_id)
    if not leg:
        return {}
    ld = leg.to_dict()
    ld["checklist_items"] = [i.to_dict() for i in s.get_checklist_items_for_leg(leg_id)]
    ld["documents"]       = [d.to_meta_dict() for d in s.get_documents_for_leg(leg_id)]
    ld["reminders"]       = [r.to_dict() for r in s.get_reminders_for_parent(leg_id)]
    return ld


def _expand_stay(s: TravelStore, stay_id: str) -> dict:
    stay = s.get_stay(stay_id)
    if not stay:
        return {}
    sd = stay.to_dict()
    sd["checklist_items"] = [i.to_dict() for i in s.get_checklist_items_for_stay(stay_id)]
    sd["documents"]       = [d.to_meta_dict() for d in s.get_documents_for_stay(stay_id)]
    sd["reminders"]       = [r.to_dict() for r in s.get_reminders_for_parent(stay_id)]
    return sd


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@app.get("/api/config")
async def get_config():
    opts = _options()
    return ok({
        "ai_provider": opts.get("ai_provider", "none"),
        "gcal_entity":  opts.get("gcal_entity", ""),
    })


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------

@app.get("/api/trips")
async def list_trips():
    s = _store()
    result = []
    for trip in s.get_all_trips():
        d = trip.to_dict()
        d.pop("chat_history", None)
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
    d = trip.to_dict()
    d.pop("chat_history", None)
    d["legs"]      = [_expand_leg(s, lid) for lid in trip.legs if s.get_leg(lid)]
    d["stays"]     = [_expand_stay(s, sid) for sid in trip.stays if s.get_stay(sid)]
    d["reminders"] = [r.to_dict() for r in s.get_reminders_for_parent(trip_id)]
    return ok(d)


@app.put("/api/trips/{trip_id}")
async def update_trip(trip_id: str, request: Request):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    body = await request.json()
    trip = await s.async_update_trip(trip_id,
                                     **{k: body[k] for k in ("name","description","notes") if k in body})
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
# Legs (Segments)
# ---------------------------------------------------------------------------

@app.post("/api/trips/{trip_id}/legs", status_code=201)
async def create_leg(trip_id: str, request: Request):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    body = await request.json()
    for f in ("origin", "destination"):
        if not body.get(f):
            return err(f"{f} is required")
    depart_tz = body.get("depart_timezone")
    arrive_tz = body.get("arrive_timezone")
    leg = await s.async_create_leg(
        trip_id=trip_id, type=body.get("type", "flight"),
        origin=body["origin"], destination=body["destination"],
        depart_at=_parse_local_dt(body.get("depart_at"), depart_tz),
        arrive_at=_parse_local_dt(body.get("arrive_at"), arrive_tz),
        carrier=body.get("carrier"), flight_number=body.get("flight_number"),
        notes=body.get("notes"), status=body.get("status", "upcoming"),
        depart_timezone=depart_tz, arrive_timezone=arrive_tz,
        seats=body.get("seats"),
        booking_url=body.get("booking_url"),
    )
    await push_all_sensors(s)
    return ok(leg.to_dict(), 201)


@app.get("/api/legs/{leg_id}")
async def get_leg(leg_id: str):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    return ok(_expand_leg(s, leg_id))


@app.put("/api/legs/{leg_id}")
async def update_leg(leg_id: str, request: Request):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    body = await request.json()
    allowed = {"type","origin","destination","carrier","flight_number",
               "notes","status","sequence","depart_timezone","arrive_timezone","seats","booking_url"}
    kwargs: dict[str, Any] = {}
    for k in allowed:
        if k in body:
            kwargs[k] = body[k]
    # Parse datetimes with their respective timezones
    depart_tz = body.get("depart_timezone") or (s.get_leg(leg_id).depart_timezone if s.get_leg(leg_id) else None)
    arrive_tz = body.get("arrive_timezone") or (s.get_leg(leg_id).arrive_timezone if s.get_leg(leg_id) else None)
    if "depart_at" in body:
        kwargs["depart_at"] = _parse_local_dt(body["depart_at"], depart_tz)
    if "arrive_at" in body:
        kwargs["arrive_at"] = _parse_local_dt(body["arrive_at"], arrive_tz)
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
# Stays
# ---------------------------------------------------------------------------

@app.post("/api/trips/{trip_id}/stays", status_code=201)
async def create_stay(trip_id: str, request: Request):
    s = _store()
    if not s.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    body = await request.json()
    if not body.get("name") and not body.get("location"):
        return err("name or location is required")
    tz = body.get("timezone")
    stay = await s.async_create_stay(
        trip_id=trip_id,
        name=body.get("name", ""),
        location=body.get("location", ""),
        check_in=_parse_local_dt(body.get("check_in"), tz),
        check_out=_parse_local_dt(body.get("check_out"), tz),
        address=body.get("address"),
        confirmation_number=body.get("confirmation_number"),
        notes=body.get("notes"),
        status=body.get("status", "upcoming"),
        timezone=tz,
        booking_url=body.get("booking_url"),
    )
    return ok(stay.to_dict(), 201)


@app.get("/api/stays/{stay_id}")
async def get_stay(stay_id: str):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    return ok(_expand_stay(s, stay_id))


@app.put("/api/stays/{stay_id}")
async def update_stay(stay_id: str, request: Request):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    body = await request.json()
    allowed = {"name","location","address","confirmation_number","notes","status","timezone","sequence","booking_url"}
    kwargs: dict[str, Any] = {}
    for k in allowed:
        if k in body:
            kwargs[k] = body[k]
    tz = body.get("timezone") or (s.get_stay(stay_id).timezone if s.get_stay(stay_id) else None)
    if "check_in" in body:
        kwargs["check_in"] = _parse_local_dt(body["check_in"], tz)
    if "check_out" in body:
        kwargs["check_out"] = _parse_local_dt(body["check_out"], tz)
    stay = await s.async_update_stay(stay_id, **kwargs)
    return ok(stay.to_dict())


@app.delete("/api/stays/{stay_id}")
async def delete_stay(stay_id: str):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    await s.async_delete_stay(stay_id)
    return ok({"status": "deleted"})


@app.get("/api/stays/{stay_id}/checklist")
async def list_stay_checklist(stay_id: str):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    return ok([i.to_dict() for i in s.get_checklist_items_for_stay(stay_id)])


@app.post("/api/stays/{stay_id}/checklist", status_code=201)
async def add_stay_checklist_item(stay_id: str, request: Request):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    body  = await request.json()
    label = (body.get("label") or "").strip()
    if not label:
        return err("label is required")
    item = await s.async_add_checklist_item_to_stay(stay_id, label, body.get("due_offset_hours"))
    return ok(item.to_dict(), 201)


@app.get("/api/stays/{stay_id}/documents")
async def list_stay_documents(stay_id: str):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    return ok([d.to_meta_dict() for d in s.get_documents_for_stay(stay_id)])


@app.post("/api/stays/{stay_id}/documents", status_code=201)
async def upload_stay_document(stay_id: str, request: Request):
    s = _store()
    if not s.get_stay(stay_id):
        raise HTTPException(404, "Stay not found")
    return await _upload_document(s, stay_id, await request.json())


# ---------------------------------------------------------------------------
# Checklist (shared patch/delete for both legs and stays)
# ---------------------------------------------------------------------------

@app.get("/api/legs/{leg_id}/checklist")
async def list_checklist(leg_id: str):
    s = _store()
    if not s.get_leg(leg_id):
        raise HTTPException(404, "Leg not found")
    return ok([i.to_dict() for i in s.get_checklist_items_for_leg(leg_id)])


@app.post("/api/legs/{leg_id}/checklist", status_code=201)
async def add_checklist_item(leg_id: str, request: Request):
    s = _store()
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

async def _upload_document(s: TravelStore, parent_id: str, body: dict) -> JSONResponse:
    filename = (body.get("filename") or "").strip()
    content  = body.get("content", "")
    if not filename or not content:
        return err("filename and content are required")

    mime_type    = body.get("mime_type", "application/octet-stream")
    storage_mode = "base64"
    final_content = content

    if len(content.encode()) > 1_000_000:
        storage_mode = "filepath"
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        import uuid
        tmp_id    = str(uuid.uuid4())
        file_path = DOCS_DIR / f"{tmp_id}_{Path(filename).name}"
        file_path.write_bytes(base64.b64decode(content))
        final_content = str(file_path)

    doc = await s.async_add_document(parent_id, filename, mime_type, storage_mode, final_content)

    if storage_mode == "filepath":
        new_path = DOCS_DIR / f"{doc.id}_{Path(filename).name}"
        Path(final_content).rename(new_path)
        s._documents[doc.id].content = str(new_path)
        s.schedule_save()

    return ok(doc.to_meta_dict(), 201)


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
    return await _upload_document(s, leg_id, await request.json())


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


@app.get("/api/documents/{doc_id}/raw")
async def get_document_raw(doc_id: str):
    s   = _store()
    doc = s._documents.get(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.storage_mode == "filepath":
        path = Path(doc.content)
        if not str(path.resolve()).startswith(str(DOCS_DIR.resolve())):
            raise HTTPException(403, "Access denied")
        content_bytes = path.read_bytes()
    else:
        content_bytes = base64.b64decode(doc.content)
    try:
        # Simple case: filename is pure latin-1 safe
        doc.filename.encode("latin-1")
        safe_name = doc.filename.replace('"', '\\"')
        cd = f'inline; filename="{safe_name}"'
    except UnicodeEncodeError:
        # Filename contains non-latin-1 chars (e.g. emoji) — use RFC 5987
        cd = f"inline; filename*=UTF-8''{urllib.parse.quote(doc.filename)}"
    return Response(
        content=content_bytes,
        media_type=doc.mime_type,
        headers={"Content-Disposition": cd},
    )


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
    for f in ("parent_type", "parent_id", "label", "fire_at"):
        if not body.get(f):
            return err(f"{f} is required")
    fire_at = _parse_dt(body["fire_at"])
    if not fire_at:
        return err("Invalid fire_at")
    reminder = await s.async_create_reminder(
        body["parent_type"], body["parent_id"], body["label"],
        fire_at, body.get("event_data", {}),
        repeat_interval_hours=body.get("repeat_interval_hours"),
        checklist_item_id=body.get("checklist_item_id"),
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
    kwargs: dict[str, Any] = {}
    if "label" in body:
        kwargs["label"] = body["label"]
    if "fire_at" in body:
        kwargs["fire_at"]  = _parse_dt(body["fire_at"])
        kwargs["fired"]    = False
    if "done" in body:
        kwargs["done"] = bool(body["done"])
    if "repeat_interval_hours" in body:
        kwargs["repeat_interval_hours"] = body["repeat_interval_hours"]
    r = await s.async_update_reminder(reminder_id, **kwargs)
    if "fire_at" in body and scheduler:
        scheduler.schedule_reminder(r)
    return ok(r.to_dict())


@app.post("/api/reminders/{reminder_id}/done")
async def mark_reminder_done(reminder_id: str):
    s = _store()
    r = s._reminders.get(reminder_id)
    if not r:
        raise HTTPException(404, "Reminder not found")
    if scheduler:
        scheduler.cancel_reminder(reminder_id)
    r = await s.async_mark_reminder_done(reminder_id)
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
# AI extraction
# ---------------------------------------------------------------------------

@app.post("/api/extract")
async def extract_from_document(request: Request):
    """Extract segment or stay fields from a base64-encoded image or PDF."""
    if not chat_svc or not chat_svc.enabled:
        raise HTTPException(503, "AI not configured. Set ai_provider in add-on options.")
    body     = await request.json()
    content  = body.get("content", "")
    mime     = body.get("mime_type", "image/jpeg")
    doc_type = body.get("doc_type", "segment")  # "segment" | "stay"
    if not content:
        return err("content (base64) is required")
    try:
        items = await chat_svc.provider.extract(content, mime, doc_type)
        # Normalise to list (providers now return a list; wrap plain dict for compat)
        if isinstance(items, dict):
            items = [items] if items else []
        return ok({"items": items})
    except Exception as exc:
        _LOGGER.exception("Extraction error: %s", exc)
        msg = str(exc)
        if "quota" in msg.lower() or "429" in msg or "rate" in msg.lower():
            return err("AI quota exceeded. Please check your API plan or try again later.", 429)
        return err(f"Extraction failed: {exc}", 500)


# ---------------------------------------------------------------------------
# Geocoding (Nominatim proxy with in-process cache)
# ---------------------------------------------------------------------------

_geocode_cache: dict[str, dict | None] = {}

@app.get("/api/geocode")
async def geocode(q: str):
    """Return {lat, lng} for a place name via Nominatim, cached in-process."""
    key = q.strip().lower()
    if key in _geocode_cache:
        result = _geocode_cache[key]
        if result is None:
            raise HTTPException(404, "Place not found")
        return result
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q, "format": "json", "limit": 1},
                headers={"User-Agent": "TravelAssistant/1.0 (home-assistant-addon)"},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                data = await resp.json()
    except Exception as exc:
        _LOGGER.warning("Nominatim geocode failed for %r: %s", q, exc)
        raise HTTPException(502, "Geocoding service unavailable")
    if not data:
        _geocode_cache[key] = None
        raise HTTPException(404, "Place not found")
    coords = {"lat": float(data[0]["lat"]), "lng": float(data[0]["lon"])}
    _geocode_cache[key] = coords
    return coords


# ---------------------------------------------------------------------------
# Flight status (AviationStack)
# ---------------------------------------------------------------------------

@app.get("/api/legs/{leg_id}/flight-status")
async def get_flight_status(leg_id: str):
    opts = _options()
    key  = opts.get("aviationstack_api_key", "")
    if not key:
        raise HTTPException(503, "aviationstack_api_key not configured")
    s   = _store()
    leg = s.get_leg(leg_id)
    if not leg:
        raise HTTPException(404, "Leg not found")
    if not leg.flight_number:
        return err("Leg has no flight number")
    date_str = leg.depart_at.strftime("%Y-%m-%d") if leg.depart_at else ""
    url = (
        f"http://api.aviationstack.com/v1/flights"
        f"?access_key={key}&flight_iata={leg.flight_number}"
        + (f"&flight_date={date_str}" if date_str else "")
    )
    try:
        async with __import__("aiohttp").ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    try:
                        body_data = await resp.json(content_type=None)
                        msg = body_data.get("error", {}).get("info", f"AviationStack returned HTTP {resp.status}")
                    except Exception:
                        msg = f"AviationStack returned HTTP {resp.status}"
                    if resp.status == 403:
                        msg = f"AviationStack API key invalid or plan does not support real-time flight data. ({msg})"
                    return err(msg, resp.status)
                data = await resp.json()
        flights = data.get("data", [])
        if not flights:
            return err("Flight not found in AviationStack", 404)
        f = flights[0]
        dep = f.get("departure", {})
        arr = f.get("arrival", {})
        return ok({
            "flight_status": f.get("flight_status"),
            "departure_airport": dep.get("airport"),
            "departure_terminal": dep.get("terminal"),
            "departure_gate": dep.get("gate"),
            "departure_delay": dep.get("delay"),
            "arrival_airport": arr.get("airport"),
            "arrival_terminal": arr.get("terminal"),
            "arrival_gate": arr.get("gate"),
            "arrival_delay": arr.get("delay"),
        })
    except Exception as exc:
        _LOGGER.exception("Flight status error: %s", exc)
        return err(f"Flight status lookup failed: {exc}", 502)


# ---------------------------------------------------------------------------
# Google Calendar export via HA
# ---------------------------------------------------------------------------

_TYPE_ICONS_GCAL = {"flight": "✈️", "bus": "🚌", "car": "🚗", "train": "🚆", "ferry": "⛴️", "other": "🧳"}


async def _export_item_to_gcal(
    ha_client_mod: Any, entity: str,
    summary: str, start_dt: str, end_dt: str,
    description: str, location: str = "",
) -> bool:
    """Delete any existing event matching the summary in the time window, then create a new one."""
    events = await ha_client_mod.list_calendar_events(entity, start_dt, end_dt)
    for ev in events:
        if ev.get("summary") == summary and ev.get("uid"):
            await ha_client_mod.delete_calendar_event(entity, ev["uid"])
    return await ha_client_mod.create_calendar_event(
        entity_id=entity, summary=summary,
        start_dt=start_dt, end_dt=end_dt,
        description=description, location=location,
    )


@app.post("/api/legs/{leg_id}/export/gcal")
async def export_leg_to_gcal(leg_id: str):
    from . import ha_client
    opts   = _options()
    entity = opts.get("gcal_entity", "")
    if not entity:
        raise HTTPException(503, "gcal_entity not configured")
    s = _store()
    leg = s.get_leg(leg_id)
    if not leg:
        raise HTTPException(404, "Leg not found")
    if not leg.depart_at:
        return err("Leg has no departure time")
    icon    = _TYPE_ICONS_GCAL.get(leg.type, "🧳")
    summary = f"{icon} {leg.origin} → {leg.destination}"
    parts   = [p for p in [leg.carrier, leg.flight_number, leg.seats] if p]
    desc    = "  ·  ".join(parts) if parts else ""
    if leg.notes: desc += f"\n{leg.notes}"
    end_dt  = leg.arrive_at or leg.depart_at
    ok_flag = await _export_item_to_gcal(
        ha_client, entity, summary,
        leg.depart_at.isoformat(), end_dt.isoformat(), desc,
    )
    if ok_flag:
        return ok({"created": 1, "errors": []})
    return err("Failed to export to Google Calendar", 502)


@app.post("/api/stays/{stay_id}/export/gcal")
async def export_stay_to_gcal(stay_id: str):
    from . import ha_client
    opts   = _options()
    entity = opts.get("gcal_entity", "")
    if not entity:
        raise HTTPException(503, "gcal_entity not configured")
    s = _store()
    stay = s.get_stay(stay_id)
    if not stay:
        raise HTTPException(404, "Stay not found")
    if not stay.check_in:
        return err("Stay has no check-in date")
    summary = f"🏨 {stay.name}"
    parts   = [p for p in [stay.location, stay.address, stay.confirmation_number] if p]
    desc    = "  ·  ".join(parts) if parts else ""
    if stay.notes: desc += f"\n{stay.notes}"
    end_dt  = stay.check_out or stay.check_in
    ok_flag = await _export_item_to_gcal(
        ha_client, entity, summary,
        stay.check_in.isoformat(), end_dt.isoformat(), desc,
        location=stay.address or stay.location or "",
    )
    if ok_flag:
        return ok({"created": 1, "errors": []})
    return err("Failed to export to Google Calendar", 502)


@app.post("/api/trips/{trip_id}/export/gcal")
async def export_trip_to_gcal(trip_id: str):
    from . import ha_client
    opts   = _options()
    entity = opts.get("gcal_entity", "")
    if not entity:
        raise HTTPException(503, "gcal_entity not configured")
    s    = _store()
    trip = s.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")

    created, errors = 0, []

    for leg in s.get_legs_for_trip(trip_id):
        if not leg.depart_at:
            continue
        icon    = _TYPE_ICONS_GCAL.get(leg.type, "🧳")
        summary = f"{icon} {leg.origin} → {leg.destination}"
        parts   = [p for p in [leg.carrier, leg.flight_number, leg.seats] if p]
        desc    = "  ·  ".join(parts) if parts else ""
        if leg.notes: desc += f"\n{leg.notes}"
        end_dt  = leg.arrive_at or leg.depart_at
        ok_flag = await _export_item_to_gcal(
            ha_client, entity, summary,
            leg.depart_at.isoformat(), end_dt.isoformat(), desc,
        )
        if ok_flag: created += 1
        else: errors.append(summary)

    for stay in s.get_stays_for_trip(trip_id):
        if not stay.check_in:
            continue
        summary = f"🏨 {stay.name}"
        parts   = [p for p in [stay.location, stay.address, stay.confirmation_number] if p]
        desc    = "  ·  ".join(parts) if parts else ""
        if stay.notes: desc += f"\n{stay.notes}"
        end_dt  = stay.check_out or stay.check_in
        ok_flag = await _export_item_to_gcal(
            ha_client, entity, summary,
            stay.check_in.isoformat(), end_dt.isoformat(), desc,
            location=stay.address or stay.location or "",
        )
        if ok_flag: created += 1
        else: errors.append(summary)

    return ok({"created": created, "errors": errors})


# ---------------------------------------------------------------------------
# Frontend — served last so API routes take priority
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
