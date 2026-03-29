"""TravelStore — persistent storage for Travel Assistant."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .models import ChecklistItem, Document, Leg, Reminder, Trip


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


class TravelStore:
    """Manages all travel data using HA's Store helper."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._trips: dict[str, Trip] = {}
        self._legs: dict[str, Leg] = {}
        self._checklist_items: dict[str, ChecklistItem] = {}
        self._documents: dict[str, Document] = {}
        self._reminders: dict[str, Reminder] = {}

    # ------------------------------------------------------------------
    # Load / Save
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        """Load all data from storage into memory."""
        raw: dict[str, Any] | None = await self._store.async_load()
        if raw is None:
            return

        data = raw.get("data", raw)

        for item in data.get("trips", {}).values():
            try:
                trip = Trip.from_dict(item)
                self._trips[trip.id] = trip
            except Exception:
                pass

        for item in data.get("legs", {}).values():
            try:
                leg = Leg.from_dict(item)
                self._legs[leg.id] = leg
            except Exception:
                pass

        for item in data.get("checklist_items", {}).values():
            try:
                ci = ChecklistItem.from_dict(item)
                self._checklist_items[ci.id] = ci
            except Exception:
                pass

        for item in data.get("documents", {}).values():
            try:
                doc = Document.from_dict(item)
                self._documents[doc.id] = doc
            except Exception:
                pass

        for item in data.get("reminders", {}).values():
            try:
                rem = Reminder.from_dict(item)
                self._reminders[rem.id] = rem
            except Exception:
                pass

    async def async_save(self) -> None:
        """Immediately persist all data."""
        await self._store.async_save(self._serialize())

    def _schedule_save(self) -> None:
        """Debounced save (5 s) for write-heavy operations like checklist toggling."""
        self._store.async_delay_save(self._serialize, 5.0)

    def _serialize(self) -> dict:
        return {
            "trips": {k: v.to_dict() for k, v in self._trips.items()},
            "legs": {k: v.to_dict() for k, v in self._legs.items()},
            "checklist_items": {k: v.to_dict() for k, v in self._checklist_items.items()},
            "documents": {k: v.to_dict() for k, v in self._documents.items()},
            "reminders": {k: v.to_dict() for k, v in self._reminders.items()},
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
        trip = Trip(
            id=_new_id(),
            name=name,
            description=description,
            legs=[],
            reminders=[],
            created_at=now,
            updated_at=now,
        )
        self._trips[trip.id] = trip
        await self.async_save()
        return trip

    async def async_update_trip(self, trip_id: str, **kwargs: Any) -> Trip:
        trip = self._trips[trip_id]
        for key, value in kwargs.items():
            if hasattr(trip, key):
                setattr(trip, key, value)
        trip.updated_at = _now()
        self._schedule_save()
        return trip

    async def async_delete_trip(self, trip_id: str) -> None:
        trip = self._trips.pop(trip_id, None)
        if trip is None:
            return
        for leg_id in list(trip.legs):
            await self._async_delete_leg_internal(leg_id)
        for rem_id in list(trip.reminders):
            self._reminders.pop(rem_id, None)
        await self.async_save()

    # ------------------------------------------------------------------
    # Leg CRUD
    # ------------------------------------------------------------------

    def get_leg(self, leg_id: str) -> Leg | None:
        return self._legs.get(leg_id)

    def get_legs_for_trip(self, trip_id: str) -> list[Leg]:
        trip = self._trips.get(trip_id)
        if not trip:
            return []
        legs = [self._legs[lid] for lid in trip.legs if lid in self._legs]
        return sorted(legs, key=lambda l: l.sequence)

    async def async_create_leg(self, trip_id: str, **kwargs: Any) -> Leg:
        trip = self._trips[trip_id]
        sequence = len(trip.legs)
        now = _now()
        leg = Leg(
            id=_new_id(),
            trip_id=trip_id,
            sequence=sequence,
            type=kwargs.get("type", "flight"),
            origin=kwargs["origin"],
            destination=kwargs["destination"],
            depart_at=kwargs["depart_at"],
            arrive_at=kwargs.get("arrive_at"),
            carrier=kwargs.get("carrier"),
            flight_number=kwargs.get("flight_number"),
            notes=kwargs.get("notes"),
            checklist_items=[],
            documents=[],
            reminders=[],
            status=kwargs.get("status", "upcoming"),
        )
        self._legs[leg.id] = leg
        trip.legs.append(leg.id)
        trip.updated_at = now
        await self.async_save()
        return leg

    async def async_update_leg(self, leg_id: str, **kwargs: Any) -> Leg:
        leg = self._legs[leg_id]
        for key, value in kwargs.items():
            if hasattr(leg, key):
                setattr(leg, key, value)
        if leg.trip_id in self._trips:
            self._trips[leg.trip_id].updated_at = _now()
        self._schedule_save()
        return leg

    async def async_delete_leg(self, leg_id: str) -> None:
        leg = self._legs.get(leg_id)
        if leg and leg.trip_id in self._trips:
            trip = self._trips[leg.trip_id]
            if leg_id in trip.legs:
                trip.legs.remove(leg_id)
        await self._async_delete_leg_internal(leg_id)
        await self.async_save()

    async def _async_delete_leg_internal(self, leg_id: str) -> None:
        leg = self._legs.pop(leg_id, None)
        if leg is None:
            return
        for item_id in list(leg.checklist_items):
            self._checklist_items.pop(item_id, None)
        for doc_id in list(leg.documents):
            self._documents.pop(doc_id, None)
        for rem_id in list(leg.reminders):
            self._reminders.pop(rem_id, None)

    # ------------------------------------------------------------------
    # Checklist CRUD
    # ------------------------------------------------------------------

    def get_checklist_items_for_leg(self, leg_id: str) -> list[ChecklistItem]:
        leg = self._legs.get(leg_id)
        if not leg:
            return []
        return [self._checklist_items[iid] for iid in leg.checklist_items if iid in self._checklist_items]

    async def async_add_checklist_item(
        self,
        leg_id: str,
        label: str,
        due_offset_hours: int | None = None,
    ) -> ChecklistItem:
        item = ChecklistItem(
            id=_new_id(),
            leg_id=leg_id,
            label=label,
            checked=False,
            due_offset_hours=due_offset_hours,
            created_at=_now(),
        )
        self._checklist_items[item.id] = item
        self._legs[leg_id].checklist_items.append(item.id)
        self._schedule_save()
        return item

    async def async_set_checklist_item_checked(self, item_id: str, checked: bool) -> ChecklistItem:
        item = self._checklist_items[item_id]
        item.checked = checked
        self._schedule_save()
        return item

    async def async_delete_checklist_item(self, item_id: str) -> None:
        item = self._checklist_items.pop(item_id, None)
        if item and item.leg_id in self._legs:
            leg = self._legs[item.leg_id]
            if item_id in leg.checklist_items:
                leg.checklist_items.remove(item_id)
        self._schedule_save()

    # ------------------------------------------------------------------
    # Document CRUD
    # ------------------------------------------------------------------

    def get_documents_for_leg(self, leg_id: str) -> list[Document]:
        leg = self._legs.get(leg_id)
        if not leg:
            return []
        return [self._documents[did] for did in leg.documents if did in self._documents]

    async def async_add_document(
        self,
        leg_id: str,
        filename: str,
        mime_type: str,
        storage_mode: str,
        content: str,
    ) -> Document:
        doc = Document(
            id=_new_id(),
            leg_id=leg_id,
            filename=filename,
            mime_type=mime_type,
            storage_mode=storage_mode,
            content=content,
            uploaded_at=_now(),
        )
        self._documents[doc.id] = doc
        self._legs[leg_id].documents.append(doc.id)
        await self.async_save()
        return doc

    async def async_delete_document(self, doc_id: str) -> None:
        doc = self._documents.pop(doc_id, None)
        if doc and doc.leg_id in self._legs:
            leg = self._legs[doc.leg_id]
            if doc_id in leg.documents:
                leg.documents.remove(doc_id)
        self._schedule_save()

    # ------------------------------------------------------------------
    # Reminder CRUD
    # ------------------------------------------------------------------

    def get_reminders_for_parent(self, parent_id: str) -> list[Reminder]:
        return [r for r in self._reminders.values() if r.parent_id == parent_id]

    def get_all_unfired_reminders(self) -> list[Reminder]:
        return [r for r in self._reminders.values() if not r.fired]

    async def async_create_reminder(
        self,
        parent_type: str,
        parent_id: str,
        label: str,
        fire_at: datetime,
        event_data: dict | None = None,
    ) -> Reminder:
        reminder = Reminder(
            id=_new_id(),
            parent_type=parent_type,
            parent_id=parent_id,
            label=label,
            fire_at=fire_at,
            event_data=event_data or {},
            fired=False,
        )
        self._reminders[reminder.id] = reminder

        # Attach to parent
        if parent_type == "trip" and parent_id in self._trips:
            self._trips[parent_id].reminders.append(reminder.id)
        elif parent_type == "leg" and parent_id in self._legs:
            self._legs[parent_id].reminders.append(reminder.id)

        await self.async_save()
        return reminder

    async def async_mark_reminder_fired(self, reminder_id: str) -> None:
        if reminder_id in self._reminders:
            self._reminders[reminder_id].fired = True
            self._schedule_save()

    async def async_delete_reminder(self, reminder_id: str) -> None:
        reminder = self._reminders.pop(reminder_id, None)
        if reminder is None:
            return
        if reminder.parent_type == "trip" and reminder.parent_id in self._trips:
            t = self._trips[reminder.parent_id]
            if reminder_id in t.reminders:
                t.reminders.remove(reminder_id)
        elif reminder.parent_type == "leg" and reminder.parent_id in self._legs:
            l = self._legs[reminder.parent_id]
            if reminder_id in l.reminders:
                l.reminders.remove(reminder_id)
        self._schedule_save()

    # ------------------------------------------------------------------
    # Query helpers for sensors
    # ------------------------------------------------------------------

    def get_next_upcoming_leg(self) -> Leg | None:
        now = _now()
        candidates = [
            l for l in self._legs.values()
            if l.status == "upcoming" and l.depart_at > now
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda l: l.depart_at)

    def get_current_active_leg(self) -> Leg | None:
        active = [l for l in self._legs.values() if l.status == "active"]
        if not active:
            return None
        return min(active, key=lambda l: l.depart_at)

    def get_days_until_next_departure(self) -> int | None:
        leg = self.get_next_upcoming_leg()
        if leg is None:
            return None
        delta = leg.depart_at - _now()
        return max(0, delta.days)

    # ------------------------------------------------------------------
    # Serialisation helpers for chat context
    # ------------------------------------------------------------------

    def get_trip_context(self, trip_id: str) -> dict:
        """Return a compact serialisation of a trip for the AI system prompt."""
        trip = self._trips.get(trip_id)
        if not trip:
            return {}
        legs = self.get_legs_for_trip(trip_id)
        legs_out = []
        for leg in legs:
            items = self.get_checklist_items_for_leg(leg.id)
            total = len(items)
            done = sum(1 for i in items if i.checked)
            reminders = self.get_reminders_for_parent(leg.id)
            legs_out.append({
                "id": leg.id,
                "sequence": leg.sequence,
                "type": leg.type,
                "origin": leg.origin,
                "destination": leg.destination,
                "depart_at": leg.depart_at.isoformat(),
                "arrive_at": leg.arrive_at.isoformat() if leg.arrive_at else None,
                "carrier": leg.carrier,
                "flight_number": leg.flight_number,
                "notes": leg.notes,
                "status": leg.status,
                "checklist": {"total": total, "done": done, "items": [{"label": i.label, "checked": i.checked} for i in items]},
                "reminders": [{"id": r.id, "label": r.label, "fire_at": r.fire_at.isoformat(), "fired": r.fired} for r in reminders],
            })
        return {
            "id": trip.id,
            "name": trip.name,
            "description": trip.description,
            "legs": legs_out,
        }
