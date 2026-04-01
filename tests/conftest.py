"""Shared fixtures for travel-assistant tests."""
from __future__ import annotations

import sys
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models import ChecklistItem, Document, Leg, Reminder, Stay, Trip
from app.store import TravelStore

UTC = timezone.utc


def _dt(days_from_now: float = 0) -> datetime:
    return datetime.now(tz=UTC) + timedelta(days=days_from_now)


def make_store() -> TravelStore:
    """Return a TravelStore with disk I/O patched out."""
    store = TravelStore()
    store.async_save = AsyncMock()
    store.schedule_save = MagicMock()
    return store


def seed_trip(store: TravelStore, trip_id: str = "trip-1", name: str = "Test Trip") -> Trip:
    now = _dt()
    trip = Trip(
        id=trip_id, name=name, description="A test trip",
        legs=[], stays=[], reminders=[],
        created_at=now, updated_at=now,
    )
    store._trips[trip_id] = trip
    return trip


def seed_leg(
    store: TravelStore,
    trip: Trip,
    leg_id: str = "leg-1",
    sequence: int = 0,
    status: str = "upcoming",
    depart_offset_days: float = 7,
) -> Leg:
    leg = Leg(
        id=leg_id, trip_id=trip.id, sequence=sequence,
        type="flight", origin="MAD", destination="BOG",
        depart_at=_dt(depart_offset_days), arrive_at=None,
        carrier="LATAM", flight_number="LA505",
        notes=None, checklist_items=[], documents=[], reminders=[],
        status=status,
        depart_timezone="Europe/Madrid", arrive_timezone="America/Bogota",
    )
    store._legs[leg_id] = leg
    trip.legs.append(leg_id)
    return leg


def seed_stay(
    store: TravelStore,
    trip: Trip,
    stay_id: str = "stay-1",
    sequence: int = 1,
) -> Stay:
    now = _dt()
    stay = Stay(
        id=stay_id, trip_id=trip.id, sequence=sequence,
        name="Hotel Test", location="Barcelona",
        check_in=_dt(2), check_out=_dt(5),
        address="Test St 1", confirmation_number="XYZ",
        notes=None, timezone="Europe/Madrid",
        checklist_items=[], documents=[], reminders=[],
        status="upcoming",
    )
    store._stays[stay_id] = stay
    trip.stays.append(stay_id)
    return stay


def seed_checklist_item(
    store: TravelStore,
    parent_id: str,
    item_id: str = "ci-1",
    label: str = "Pack passport",
    checked: bool = False,
) -> ChecklistItem:
    item = ChecklistItem(
        id=item_id, leg_id=parent_id, label=label,
        checked=checked, due_offset_hours=None, created_at=_dt(),
    )
    store._checklist_items[item_id] = item
    return item


def seed_document(
    store: TravelStore,
    parent_id: str,
    doc_id: str = "doc-1",
    storage_mode: str = "base64",
    content: str = "abc==",
) -> Document:
    doc = Document(
        id=doc_id, leg_id=parent_id, filename="boarding.pdf",
        mime_type="application/pdf", storage_mode=storage_mode,
        content=content, uploaded_at=_dt(),
    )
    store._documents[doc_id] = doc
    return doc


def seed_reminder(
    store: TravelStore,
    parent_type: str,
    parent_id: str,
    reminder_id: str = "rem-1",
    fired: bool = False,
    done: bool = False,
) -> Reminder:
    rem = Reminder(
        id=reminder_id, parent_type=parent_type, parent_id=parent_id,
        label="Check in online", fire_at=_dt(1),
        event_data={}, fired=fired, done=done,
    )
    store._reminders[reminder_id] = rem
    return rem


@pytest.fixture
def store() -> TravelStore:
    return make_store()


@pytest.fixture
def store_with_trip(store: TravelStore):
    trip = seed_trip(store)
    return store, trip


@pytest.fixture
def store_with_leg(store_with_trip):
    store, trip = store_with_trip
    leg = seed_leg(store, trip)
    return store, trip, leg


@pytest.fixture
def store_with_stay(store_with_trip):
    store, trip = store_with_trip
    stay = seed_stay(store, trip)
    return store, trip, stay
