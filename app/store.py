"""JSON-based persistent storage for Travel Assistant add-on."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ChecklistItem, Document, Leg, Reminder, Trip

DATA_FILE = Path("/data/travel_assistant.json")
DOCS_DIR  = Path("/data/documents")

_SAVE_DEBOUNCE = 5.0  # seconds


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


class TravelStore:
    def __init__(self) -> None:
        self._trips:           dict[str, Trip]          = {}
        self._legs:            dict[str, Leg]           = {}
        self._checklist_items: dict[str, ChecklistItem] = {}
        self._documents:       dict[str, Document]      = {}
        self._reminders:       dict[str, Reminder]      = {}
        self._save_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Load / Save
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        if not DATA_FILE.exists():
            return
        try:
            raw = json.loads(DATA_FILE.read_text())
        except Exception:
            return
        for v in raw.get("trips", {}).values():
            try: self._trips[v["id"]] = Trip.from_dict(v)
            except Exception: pass
        for v in raw.get("legs", {}).values():
            try: self._legs[v["id"]] = Leg.from_dict(v)
            except Exception: pass
        for v in raw.get("checklist_items", {}).values():
            try: self._checklist_items[v["id"]] = ChecklistItem.from_dict(v)
            except Exception: pass
        for v in raw.get("documents", {}).values():
            try: self._documents[v["id"]] = Document.from_dict(v)
            except Exception: pass
        for v in raw.get("reminders", {}).values():
            try: self._reminders[v["id"]] = Reminder.from_dict(v)
            except Exception: pass

    async def async_save(self) -> None:
        DATA_FILE.write_text(json.dumps(self._serialize(), indent=2))

    def schedule_save(self) -> None:
        """Debounced save — coalesces rapid writes."""
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
        self._save_task = asyncio.create_task(self._delayed_save())

    async def _delayed_save(self) -> None:
        await asyncio.sleep(_SAVE_DEBOUNCE)
        await self.async_save()

    def _serialize(self) -> dict:
        return {
            "trips":           {k: v.to_dict() for k, v in self._trips.items()},
            "legs":            {k: v.to_dict() for k, v in self._legs.items()},
            "checklist_items": {k: v.to_dict() for k, v in self._checklist_items.items()},
            "documents":       {k: v.to_dict() for k, v in self._documents.items()},
            "reminders":       {k: v.to_dict() for k, v in self._reminders.items()},
        }

    # ------------------------------------------------------------------
    # Trip CRUD
    # ------------------------------------------------------------------

    def get_trip(self, trip_id: str) -> Trip | None:
        return self._trips.get(trip_id)

    def get_all_trips(self) -> list[Trip]:
        return sorted(self._trips.values(), key=lambda t: t.created_at)

    async def async_create_trip(self, name: str, description: str | None = None) -> Trip:
        now = _now()
        t = Trip(id=_new_id(), name=name, description=description,
                 legs=[], reminders=[], created_at=now, updated_at=now)
        self._trips[t.id] = t
        await self.async_save()
        return t

    async def async_update_trip(self, trip_id: str, **kwargs: Any) -> Trip:
        t = self._trips[trip_id]
        for k, v in kwargs.items():
            if hasattr(t, k): setattr(t, k, v)
        t.updated_at = _now()
        self.schedule_save()
        return t

    async def async_delete_trip(self, trip_id: str) -> None:
        t = self._trips.pop(trip_id, None)
        if not t: return
        for lid in list(t.legs): await self._delete_leg_internal(lid)
        for rid in list(t.reminders): self._reminders.pop(rid, None)
        await self.async_save()

    # ------------------------------------------------------------------
    # Leg CRUD
    # ------------------------------------------------------------------

    def get_leg(self, leg_id: str) -> Leg | None:
        return self._legs.get(leg_id)

    def get_legs_for_trip(self, trip_id: str) -> list[Leg]:
        t = self._trips.get(trip_id)
        if not t: return []
        return sorted([self._legs[i] for i in t.legs if i in self._legs], key=lambda l: l.sequence)

    async def async_create_leg(self, trip_id: str, **kwargs: Any) -> Leg:
        t = self._trips[trip_id]
        leg = Leg(
            id=_new_id(), trip_id=trip_id, sequence=len(t.legs),
            type=kwargs.get("type", "flight"),
            origin=kwargs["origin"], destination=kwargs["destination"],
            depart_at=kwargs["depart_at"], arrive_at=kwargs.get("arrive_at"),
            carrier=kwargs.get("carrier"), flight_number=kwargs.get("flight_number"),
            notes=kwargs.get("notes"), checklist_items=[], documents=[], reminders=[],
            status=kwargs.get("status", "upcoming"),
        )
        self._legs[leg.id] = leg
        t.legs.append(leg.id)
        t.updated_at = _now()
        await self.async_save()
        return leg

    async def async_update_leg(self, leg_id: str, **kwargs: Any) -> Leg:
        leg = self._legs[leg_id]
        for k, v in kwargs.items():
            if hasattr(leg, k): setattr(leg, k, v)
        if leg.trip_id in self._trips:
            self._trips[leg.trip_id].updated_at = _now()
        self.schedule_save()
        return leg

    async def async_delete_leg(self, leg_id: str) -> None:
        leg = self._legs.get(leg_id)
        if leg and leg.trip_id in self._trips:
            t = self._trips[leg.trip_id]
            if leg_id in t.legs: t.legs.remove(leg_id)
        await self._delete_leg_internal(leg_id)
        await self.async_save()

    async def _delete_leg_internal(self, leg_id: str) -> None:
        leg = self._legs.pop(leg_id, None)
        if not leg: return
        for iid in list(leg.checklist_items): self._checklist_items.pop(iid, None)
        for did in list(leg.documents): self._documents.pop(did, None)
        for rid in list(leg.reminders): self._reminders.pop(rid, None)

    # ------------------------------------------------------------------
    # Checklist CRUD
    # ------------------------------------------------------------------

    def get_checklist_items_for_leg(self, leg_id: str) -> list[ChecklistItem]:
        leg = self._legs.get(leg_id)
        if not leg: return []
        return [self._checklist_items[i] for i in leg.checklist_items if i in self._checklist_items]

    async def async_add_checklist_item(self, leg_id: str, label: str, due_offset_hours: int | None = None) -> ChecklistItem:
        item = ChecklistItem(id=_new_id(), leg_id=leg_id, label=label,
                             checked=False, due_offset_hours=due_offset_hours, created_at=_now())
        self._checklist_items[item.id] = item
        self._legs[leg_id].checklist_items.append(item.id)
        self.schedule_save()
        return item

    async def async_set_item_checked(self, item_id: str, checked: bool) -> ChecklistItem:
        item = self._checklist_items[item_id]
        item.checked = checked
        self.schedule_save()
        return item

    async def async_delete_checklist_item(self, item_id: str) -> None:
        item = self._checklist_items.pop(item_id, None)
        if item and item.leg_id in self._legs:
            leg = self._legs[item.leg_id]
            if item_id in leg.checklist_items: leg.checklist_items.remove(item_id)
        self.schedule_save()

    # ------------------------------------------------------------------
    # Document CRUD
    # ------------------------------------------------------------------

    def get_documents_for_leg(self, leg_id: str) -> list[Document]:
        leg = self._legs.get(leg_id)
        if not leg: return []
        return [self._documents[d] for d in leg.documents if d in self._documents]

    async def async_add_document(self, leg_id: str, filename: str, mime_type: str,
                                  storage_mode: str, content: str) -> Document:
        doc = Document(id=_new_id(), leg_id=leg_id, filename=filename,
                       mime_type=mime_type, storage_mode=storage_mode,
                       content=content, uploaded_at=_now())
        self._documents[doc.id] = doc
        self._legs[leg_id].documents.append(doc.id)
        await self.async_save()
        return doc

    async def async_delete_document(self, doc_id: str) -> None:
        doc = self._documents.pop(doc_id, None)
        if not doc: return
        if doc.storage_mode == "filepath":
            Path(doc.content).unlink(missing_ok=True)
        if doc.leg_id in self._legs:
            leg = self._legs[doc.leg_id]
            if doc_id in leg.documents: leg.documents.remove(doc_id)
        self.schedule_save()

    # ------------------------------------------------------------------
    # Reminder CRUD
    # ------------------------------------------------------------------

    def get_reminders_for_parent(self, parent_id: str) -> list[Reminder]:
        return [r for r in self._reminders.values() if r.parent_id == parent_id]

    def get_all_unfired_reminders(self) -> list[Reminder]:
        return [r for r in self._reminders.values() if not r.fired]

    async def async_create_reminder(self, parent_type: str, parent_id: str,
                                     label: str, fire_at: datetime, event_data: dict | None = None) -> Reminder:
        r = Reminder(id=_new_id(), parent_type=parent_type, parent_id=parent_id,
                     label=label, fire_at=fire_at, event_data=event_data or {}, fired=False)
        self._reminders[r.id] = r
        if parent_type == "trip" and parent_id in self._trips:
            self._trips[parent_id].reminders.append(r.id)
        elif parent_type == "leg" and parent_id in self._legs:
            self._legs[parent_id].reminders.append(r.id)
        await self.async_save()
        return r

    async def async_mark_reminder_fired(self, reminder_id: str) -> None:
        if reminder_id in self._reminders:
            self._reminders[reminder_id].fired = True
            self.schedule_save()

    async def async_delete_reminder(self, reminder_id: str) -> None:
        r = self._reminders.pop(reminder_id, None)
        if not r: return
        if r.parent_type == "trip" and r.parent_id in self._trips:
            t = self._trips[r.parent_id]
            if reminder_id in t.reminders: t.reminders.remove(reminder_id)
        elif r.parent_type == "leg" and r.parent_id in self._legs:
            leg = self._legs[r.parent_id]
            if reminder_id in leg.reminders: leg.reminders.remove(reminder_id)
        self.schedule_save()

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_next_upcoming_leg(self) -> Leg | None:
        now = _now()
        candidates = [l for l in self._legs.values() if l.status == "upcoming" and l.depart_at > now]
        return min(candidates, key=lambda l: l.depart_at) if candidates else None

    def get_current_active_leg(self) -> Leg | None:
        active = [l for l in self._legs.values() if l.status == "active"]
        return min(active, key=lambda l: l.depart_at) if active else None

    def get_days_until_next_departure(self) -> int | None:
        leg = self.get_next_upcoming_leg()
        if not leg: return None
        return max(0, (_now() - leg.depart_at).days * -1)

    # ------------------------------------------------------------------
    # Chat context helper
    # ------------------------------------------------------------------

    def get_trip_context(self, trip_id: str) -> dict:
        trip = self._trips.get(trip_id)
        if not trip: return {}
        legs = self.get_legs_for_trip(trip_id)
        legs_out = []
        for leg in legs:
            items = self.get_checklist_items_for_leg(leg.id)
            rems  = self.get_reminders_for_parent(leg.id)
            legs_out.append({
                "id": leg.id, "sequence": leg.sequence, "type": leg.type,
                "origin": leg.origin, "destination": leg.destination,
                "depart_at": leg.depart_at.isoformat(),
                "arrive_at": leg.arrive_at.isoformat() if leg.arrive_at else None,
                "carrier": leg.carrier, "flight_number": leg.flight_number,
                "notes": leg.notes, "status": leg.status,
                "checklist": {"total": len(items), "done": sum(1 for i in items if i.checked),
                              "items": [{"label": i.label, "checked": i.checked} for i in items]},
                "reminders": [{"id": r.id, "label": r.label,
                               "fire_at": r.fire_at.isoformat(), "fired": r.fired} for r in rems],
            })
        return {"id": trip.id, "name": trip.name, "description": trip.description, "legs": legs_out}
