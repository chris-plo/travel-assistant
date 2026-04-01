"""Unit tests for app/store.py — TravelStore in-memory CRUD and helpers."""
from __future__ import annotations

import sys
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.store import TravelStore
from tests.conftest import (
    _dt, make_store,
    seed_trip, seed_leg, seed_stay,
    seed_checklist_item, seed_document, seed_reminder,
)

UTC = timezone.utc


# ---------------------------------------------------------------------------
# _serialize
# ---------------------------------------------------------------------------

class TestTravelStoreSerialize:
    def test_empty_store_has_all_six_keys(self):
        store = make_store()
        s = store._serialize()
        assert set(s.keys()) == {"trips", "legs", "stays", "checklist_items", "documents", "reminders"}

    def test_empty_store_all_dicts_empty(self):
        store = make_store()
        s = store._serialize()
        for v in s.values():
            assert v == {}

    def test_serializes_trip(self):
        store = make_store()
        trip = seed_trip(store)
        s = store._serialize()
        assert trip.id in s["trips"]
        assert s["trips"][trip.id] == trip.to_dict()

    def test_serializes_leg(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        s = store._serialize()
        assert leg.id in s["legs"]
        assert s["legs"][leg.id] == leg.to_dict()

    def test_serialized_leg_has_no_legacy_timezone_key(self):
        store = make_store()
        trip = seed_trip(store)
        seed_leg(store, trip)
        s = store._serialize()
        leg_dict = list(s["legs"].values())[0]
        assert "timezone" not in leg_dict
        assert "depart_timezone" in leg_dict
        assert "arrive_timezone" in leg_dict


# ---------------------------------------------------------------------------
# Trip CRUD
# ---------------------------------------------------------------------------

class TestTripCRUD:
    async def test_create_trip_populates_store(self):
        store = make_store()
        trip = await store.async_create_trip("My Trip")
        assert trip.id in store._trips
        assert store._trips[trip.id].name == "My Trip"

    async def test_create_trip_with_description(self):
        store = make_store()
        trip = await store.async_create_trip("Summer", description="Hot")
        assert trip.description == "Hot"

    async def test_create_trip_calls_async_save(self):
        store = make_store()
        await store.async_create_trip("T")
        store.async_save.assert_called_once()

    async def test_create_trip_sets_timestamps(self):
        store = make_store()
        before = datetime.now(tz=UTC)
        trip = await store.async_create_trip("T")
        after = datetime.now(tz=UTC)
        assert before <= trip.created_at <= after
        assert before <= trip.updated_at <= after

    async def test_create_trip_empty_collections(self):
        store = make_store()
        trip = await store.async_create_trip("T")
        assert trip.legs == []
        assert trip.stays == []
        assert trip.reminders == []

    def test_get_trip_returns_trip(self):
        store = make_store()
        trip = seed_trip(store)
        assert store.get_trip(trip.id) is trip

    def test_get_trip_returns_none_for_unknown(self):
        store = make_store()
        assert store.get_trip("nope") is None

    def test_get_all_trips_sorted_by_created_at(self):
        store = make_store()
        t1 = seed_trip(store, trip_id="t1", name="First")
        t1.created_at = _dt(-2)
        t2 = seed_trip(store, trip_id="t2", name="Second")
        t2.created_at = _dt(-1)
        result = store.get_all_trips()
        assert result[0].id == "t1"
        assert result[1].id == "t2"

    def test_get_all_trips_empty(self):
        store = make_store()
        assert store.get_all_trips() == []

    async def test_update_trip_name(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_update_trip(trip.id, name="New Name")
        assert store._trips[trip.id].name == "New Name"

    async def test_update_trip_description(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_update_trip(trip.id, description="Updated")
        assert store._trips[trip.id].description == "Updated"

    async def test_update_trip_notes(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_update_trip(trip.id, notes="Pack light")
        assert store._trips[trip.id].notes == "Pack light"

    async def test_update_trip_ignores_disallowed_fields(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_update_trip(trip.id, id="hacked", legs=["fake"])
        assert store._trips[trip.id].id == trip.id
        assert store._trips[trip.id].legs == []

    async def test_update_trip_updates_updated_at(self):
        store = make_store()
        trip = seed_trip(store)
        before = trip.updated_at
        await store.async_update_trip(trip.id, name="X")
        assert store._trips[trip.id].updated_at >= before

    async def test_update_trip_calls_schedule_save(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_update_trip(trip.id, name="X")
        store.schedule_save.assert_called()

    async def test_delete_trip_removes_from_store(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_delete_trip(trip.id)
        assert trip.id not in store._trips

    async def test_delete_trip_calls_async_save(self):
        store = make_store()
        trip = seed_trip(store)
        await store.async_delete_trip(trip.id)
        store.async_save.assert_called()

    async def test_delete_nonexistent_trip_is_noop(self):
        store = make_store()
        await store.async_delete_trip("ghost")  # must not raise


# ---------------------------------------------------------------------------
# Trip cascade delete
# ---------------------------------------------------------------------------

class TestTripCascadeDelete:
    async def test_delete_trip_removes_legs(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        await store.async_delete_trip(trip.id)
        assert leg.id not in store._legs

    async def test_delete_trip_removes_stays(self):
        store = make_store()
        trip = seed_trip(store)
        stay = seed_stay(store, trip)
        await store.async_delete_trip(trip.id)
        assert stay.id not in store._stays

    async def test_delete_trip_removes_trip_reminders(self):
        store = make_store()
        trip = seed_trip(store)
        rem = seed_reminder(store, "trip", trip.id)
        trip.reminders.append(rem.id)
        await store.async_delete_trip(trip.id)
        assert rem.id not in store._reminders

    async def test_delete_trip_cascades_leg_checklist_items(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        item = seed_checklist_item(store, leg.id)
        leg.checklist_items.append(item.id)
        await store.async_delete_trip(trip.id)
        assert item.id not in store._checklist_items

    async def test_delete_trip_cascades_stay_documents(self):
        store = make_store()
        trip = seed_trip(store)
        stay = seed_stay(store, trip)
        doc = seed_document(store, stay.id)
        stay.documents.append(doc.id)
        await store.async_delete_trip(trip.id)
        assert doc.id not in store._documents

    async def test_delete_trip_cascades_leg_reminders(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        rem = seed_reminder(store, "leg", leg.id)
        leg.reminders.append(rem.id)
        await store.async_delete_trip(trip.id)
        assert rem.id not in store._reminders


# ---------------------------------------------------------------------------
# Leg CRUD
# ---------------------------------------------------------------------------

class TestLegCRUD:
    async def test_create_leg_populates_store(self, store_with_trip):
        store, trip = store_with_trip
        leg = await store.async_create_leg(
            trip.id, origin="LHR", destination="JFK", depart_at=_dt(5)
        )
        assert leg.id in store._legs

    async def test_create_leg_appended_to_trip(self, store_with_trip):
        store, trip = store_with_trip
        leg = await store.async_create_leg(
            trip.id, origin="LHR", destination="JFK", depart_at=_dt(5)
        )
        assert leg.id in trip.legs

    async def test_create_leg_default_type_and_status(self, store_with_trip):
        store, trip = store_with_trip
        leg = await store.async_create_leg(
            trip.id, origin="A", destination="B", depart_at=_dt(1)
        )
        assert leg.type == "flight"
        assert leg.status == "upcoming"

    async def test_create_leg_sequence_is_item_count(self, store_with_trip):
        store, trip = store_with_trip
        # seed one stay so trip.stays has 1 entry before we create the leg
        seed_stay(store, trip, stay_id="s1", sequence=0)
        leg = await store.async_create_leg(
            trip.id, origin="A", destination="B", depart_at=_dt(1)
        )
        assert leg.sequence == 1  # 0 legs + 1 stay at creation time

    async def test_create_leg_calls_async_save(self, store_with_trip):
        store, trip = store_with_trip
        await store.async_create_leg(trip.id, origin="A", destination="B", depart_at=_dt(1))
        store.async_save.assert_called()

    async def test_create_leg_optional_fields(self, store_with_trip):
        store, trip = store_with_trip
        leg = await store.async_create_leg(
            trip.id, origin="MAD", destination="BOG", depart_at=_dt(3),
            carrier="IB", flight_number="IB6830",
            depart_timezone="Europe/Madrid", arrive_timezone="America/Bogota",
            seats="12A", booking_url="https://example.com",
        )
        assert leg.carrier == "IB"
        assert leg.flight_number == "IB6830"
        assert leg.depart_timezone == "Europe/Madrid"
        assert leg.arrive_timezone == "America/Bogota"
        assert leg.seats == "12A"

    def test_get_leg_returns_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        assert store.get_leg(leg.id) is leg

    def test_get_leg_unknown_returns_none(self, store_with_leg):
        store, trip, leg = store_with_leg
        assert store.get_leg("ghost") is None

    def test_get_legs_for_trip_sorted_by_sequence(self, store_with_trip):
        store, trip = store_with_trip
        leg_b = seed_leg(store, trip, leg_id="leg-b", sequence=2)
        leg_a = seed_leg(store, trip, leg_id="leg-a", sequence=1)
        result = store.get_legs_for_trip(trip.id)
        assert result[0].id == "leg-a"
        assert result[1].id == "leg-b"

    def test_get_legs_for_trip_unknown_trip(self):
        store = make_store()
        assert store.get_legs_for_trip("ghost") == []

    async def test_update_leg_allowed_fields(self, store_with_leg):
        store, trip, leg = store_with_leg
        await store.async_update_leg(leg.id, origin="LHR", status="active", notes="Updated")
        assert leg.origin == "LHR"
        assert leg.status == "active"
        assert leg.notes == "Updated"

    async def test_update_leg_ignores_disallowed_fields(self, store_with_leg):
        store, trip, leg = store_with_leg
        original_trip_id = leg.trip_id
        await store.async_update_leg(leg.id, trip_id="hacked", id="bad")
        assert leg.trip_id == original_trip_id
        assert leg.id == "leg-1"

    async def test_update_leg_calls_schedule_save(self, store_with_leg):
        store, trip, leg = store_with_leg
        await store.async_update_leg(leg.id, notes="x")
        store.schedule_save.assert_called()

    async def test_delete_leg_removes_from_store(self, store_with_leg):
        store, trip, leg = store_with_leg
        await store.async_delete_leg(leg.id)
        assert leg.id not in store._legs

    async def test_delete_leg_removes_from_trip_legs(self, store_with_leg):
        store, trip, leg = store_with_leg
        await store.async_delete_leg(leg.id)
        assert leg.id not in trip.legs

    async def test_delete_leg_cascades_checklist_items(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = seed_checklist_item(store, leg.id)
        leg.checklist_items.append(item.id)
        await store.async_delete_leg(leg.id)
        assert item.id not in store._checklist_items

    async def test_delete_leg_cascades_documents(self, store_with_leg):
        store, trip, leg = store_with_leg
        doc = seed_document(store, leg.id)
        leg.documents.append(doc.id)
        await store.async_delete_leg(leg.id)
        assert doc.id not in store._documents

    async def test_delete_leg_cascades_reminders(self, store_with_leg):
        store, trip, leg = store_with_leg
        rem = seed_reminder(store, "leg", leg.id)
        leg.reminders.append(rem.id)
        await store.async_delete_leg(leg.id)
        assert rem.id not in store._reminders

    async def test_delete_leg_calls_async_save(self, store_with_leg):
        store, trip, leg = store_with_leg
        store.async_save.reset_mock()
        await store.async_delete_leg(leg.id)
        store.async_save.assert_called()


# ---------------------------------------------------------------------------
# Stay CRUD
# ---------------------------------------------------------------------------

class TestStayCRUD:
    async def test_create_stay_populates_store(self, store_with_trip):
        store, trip = store_with_trip
        stay = await store.async_create_stay(trip.id, name="Hotel A", location="Paris")
        assert stay.id in store._stays

    async def test_create_stay_appended_to_trip(self, store_with_trip):
        store, trip = store_with_trip
        stay = await store.async_create_stay(trip.id, name="H")
        assert stay.id in trip.stays

    async def test_create_stay_default_status(self, store_with_trip):
        store, trip = store_with_trip
        stay = await store.async_create_stay(trip.id)
        assert stay.status == "upcoming"

    async def test_create_stay_calls_async_save(self, store_with_trip):
        store, trip = store_with_trip
        await store.async_create_stay(trip.id)
        store.async_save.assert_called()

    def test_get_stay_returns_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        assert store.get_stay(stay.id) is stay

    def test_get_stay_unknown_returns_none(self, store_with_stay):
        store, trip, stay = store_with_stay
        assert store.get_stay("ghost") is None

    def test_get_stays_for_trip_sorted_by_check_in(self, store_with_trip):
        store, trip = store_with_trip
        stay_b = seed_stay(store, trip, stay_id="sb", sequence=1)
        stay_b.check_in = _dt(5)
        stay_a = seed_stay(store, trip, stay_id="sa", sequence=0)
        stay_a.check_in = _dt(2)
        result = store.get_stays_for_trip(trip.id)
        assert result[0].id == "sa"
        assert result[1].id == "sb"

    def test_get_stays_for_unknown_trip(self):
        store = make_store()
        assert store.get_stays_for_trip("ghost") == []

    async def test_update_stay_allowed_fields(self, store_with_stay):
        store, trip, stay = store_with_stay
        await store.async_update_stay(stay.id, name="New Hotel", location="Rome", notes="Late checkin")
        assert stay.name == "New Hotel"
        assert stay.location == "Rome"
        assert stay.notes == "Late checkin"

    async def test_update_stay_ignores_disallowed_fields(self, store_with_stay):
        store, trip, stay = store_with_stay
        original_trip_id = stay.trip_id
        await store.async_update_stay(stay.id, trip_id="hacked")
        assert stay.trip_id == original_trip_id

    async def test_update_stay_calls_schedule_save(self, store_with_stay):
        store, trip, stay = store_with_stay
        await store.async_update_stay(stay.id, name="X")
        store.schedule_save.assert_called()

    async def test_delete_stay_removes_from_store(self, store_with_stay):
        store, trip, stay = store_with_stay
        await store.async_delete_stay(stay.id)
        assert stay.id not in store._stays

    async def test_delete_stay_removes_from_trip_stays(self, store_with_stay):
        store, trip, stay = store_with_stay
        await store.async_delete_stay(stay.id)
        assert stay.id not in trip.stays

    async def test_delete_stay_cascades_checklist_items(self, store_with_stay):
        store, trip, stay = store_with_stay
        item = seed_checklist_item(store, stay.id)
        stay.checklist_items.append(item.id)
        await store.async_delete_stay(stay.id)
        assert item.id not in store._checklist_items

    async def test_delete_stay_cascades_documents(self, store_with_stay):
        store, trip, stay = store_with_stay
        doc = seed_document(store, stay.id)
        stay.documents.append(doc.id)
        await store.async_delete_stay(stay.id)
        assert doc.id not in store._documents

    async def test_delete_stay_cascades_reminders(self, store_with_stay):
        store, trip, stay = store_with_stay
        rem = seed_reminder(store, "stay", stay.id)
        stay.reminders.append(rem.id)
        await store.async_delete_stay(stay.id)
        assert rem.id not in store._reminders


# ---------------------------------------------------------------------------
# Checklist CRUD
# ---------------------------------------------------------------------------

class TestChecklistCRUD:
    async def test_add_item_to_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = await store.async_add_checklist_item(leg.id, "Pack passport")
        assert item.id in store._checklist_items
        assert item.id in leg.checklist_items
        assert item.label == "Pack passport"
        assert item.checked is False

    async def test_add_item_to_leg_with_due_offset(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = await store.async_add_checklist_item(leg.id, "Book taxi", due_offset_hours=24)
        assert item.due_offset_hours == 24

    async def test_add_item_to_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        item = await store.async_add_checklist_item_to_stay(stay.id, "Check pillow menu")
        assert item.id in store._checklist_items
        assert item.id in stay.checklist_items
        assert item.leg_id == stay.id

    async def test_add_item_calls_schedule_save(self, store_with_leg):
        store, trip, leg = store_with_leg
        await store.async_add_checklist_item(leg.id, "x")
        store.schedule_save.assert_called()

    def test_get_checklist_items_for_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = seed_checklist_item(store, leg.id)
        leg.checklist_items.append(item.id)
        result = store.get_checklist_items_for_leg(leg.id)
        assert len(result) == 1
        assert result[0].id == item.id

    def test_get_checklist_items_for_unknown_leg(self):
        store = make_store()
        assert store.get_checklist_items_for_leg("ghost") == []

    def test_get_checklist_items_for_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        item = seed_checklist_item(store, stay.id)
        stay.checklist_items.append(item.id)
        result = store.get_checklist_items_for_stay(stay.id)
        assert len(result) == 1

    async def test_set_item_checked_true(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = seed_checklist_item(store, leg.id, checked=False)
        leg.checklist_items.append(item.id)
        await store.async_set_item_checked(item.id, True)
        assert store._checklist_items[item.id].checked is True

    async def test_set_item_checked_false(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = seed_checklist_item(store, leg.id, checked=True)
        leg.checklist_items.append(item.id)
        await store.async_set_item_checked(item.id, False)
        assert store._checklist_items[item.id].checked is False

    async def test_delete_item_from_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        item = seed_checklist_item(store, leg.id)
        leg.checklist_items.append(item.id)
        await store.async_delete_checklist_item(item.id)
        assert item.id not in store._checklist_items
        assert item.id not in leg.checklist_items

    async def test_delete_item_from_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        item = seed_checklist_item(store, stay.id)
        stay.checklist_items.append(item.id)
        await store.async_delete_checklist_item(item.id)
        assert item.id not in store._checklist_items
        assert item.id not in stay.checklist_items

    async def test_delete_nonexistent_item_is_noop(self):
        store = make_store()
        await store.async_delete_checklist_item("ghost")  # must not raise


# ---------------------------------------------------------------------------
# Document CRUD
# ---------------------------------------------------------------------------

class TestDocumentCRUD:
    async def test_add_document_to_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        doc = await store.async_add_document(leg.id, "bp.pdf", "application/pdf", "base64", "data==")
        assert doc.id in store._documents
        assert doc.id in leg.documents

    async def test_add_document_to_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        doc = await store.async_add_document(stay.id, "voucher.pdf", "application/pdf", "base64", "data==")
        assert doc.id in store._documents
        assert doc.id in stay.documents

    async def test_add_document_calls_async_save(self, store_with_leg):
        store, trip, leg = store_with_leg
        store.async_save.reset_mock()
        await store.async_add_document(leg.id, "f.pdf", "application/pdf", "base64", "x")
        store.async_save.assert_called()

    def test_get_documents_for_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        doc = seed_document(store, leg.id)
        leg.documents.append(doc.id)
        result = store.get_documents_for_leg(leg.id)
        assert len(result) == 1
        assert result[0].id == doc.id

    def test_get_documents_for_unknown_leg(self):
        store = make_store()
        assert store.get_documents_for_leg("ghost") == []

    def test_get_documents_for_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        doc = seed_document(store, stay.id)
        stay.documents.append(doc.id)
        result = store.get_documents_for_stay(stay.id)
        assert len(result) == 1

    async def test_delete_base64_document(self, store_with_leg):
        store, trip, leg = store_with_leg
        doc = seed_document(store, leg.id, storage_mode="base64", content="abc==")
        leg.documents.append(doc.id)
        await store.async_delete_document(doc.id)
        assert doc.id not in store._documents
        assert doc.id not in leg.documents

    async def test_delete_filepath_document_unlinks_file(self, store_with_leg):
        store, trip, leg = store_with_leg
        doc = seed_document(store, leg.id, storage_mode="filepath", content="/data/documents/file.pdf")
        leg.documents.append(doc.id)
        with patch("app.store.Path") as mock_path_cls:
            mock_path_instance = MagicMock()
            mock_path_cls.return_value = mock_path_instance
            await store.async_delete_document(doc.id)
            mock_path_cls.assert_called_once_with("/data/documents/file.pdf")
            mock_path_instance.unlink.assert_called_once_with(missing_ok=True)

    async def test_delete_nonexistent_document_is_noop(self):
        store = make_store()
        await store.async_delete_document("ghost")  # must not raise


# ---------------------------------------------------------------------------
# Reminder CRUD
# ---------------------------------------------------------------------------

class TestReminderCRUD:
    async def test_create_reminder_for_trip(self, store_with_trip):
        store, trip = store_with_trip
        rem = await store.async_create_reminder("trip", trip.id, "Depart soon", _dt(1))
        assert rem.id in store._reminders
        assert rem.id in trip.reminders

    async def test_create_reminder_for_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        rem = await store.async_create_reminder("leg", leg.id, "Check in", _dt(1))
        assert rem.id in store._reminders
        assert rem.id in leg.reminders

    async def test_create_reminder_for_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        rem = await store.async_create_reminder("stay", stay.id, "Checkout", _dt(3))
        assert rem.id in store._reminders
        assert rem.id in stay.reminders

    async def test_create_reminder_defaults(self, store_with_trip):
        store, trip = store_with_trip
        rem = await store.async_create_reminder("trip", trip.id, "Label", _dt(1))
        assert rem.fired is False
        assert rem.done is False
        assert rem.event_data == {}
        assert rem.repeat_interval_hours is None
        assert rem.checklist_item_id is None

    async def test_create_reminder_with_options(self, store_with_trip):
        store, trip = store_with_trip
        rem = await store.async_create_reminder(
            "trip", trip.id, "Repeat", _dt(1),
            event_data={"key": "val"},
            repeat_interval_hours=12.0,
            checklist_item_id="ci-99",
        )
        assert rem.event_data == {"key": "val"}
        assert rem.repeat_interval_hours == 12.0
        assert rem.checklist_item_id == "ci-99"

    async def test_create_reminder_calls_async_save(self, store_with_trip):
        store, trip = store_with_trip
        store.async_save.reset_mock()
        await store.async_create_reminder("trip", trip.id, "x", _dt(1))
        store.async_save.assert_called()

    def test_get_reminders_for_parent(self, store_with_leg):
        store, trip, leg = store_with_leg
        r1 = seed_reminder(store, "leg", leg.id, "rem-1")
        r2 = seed_reminder(store, "leg", "other-leg", "rem-2")
        result = store.get_reminders_for_parent(leg.id)
        assert len(result) == 1
        assert result[0].id == r1.id

    def test_get_all_unfired_reminders(self, store_with_trip):
        store, trip = store_with_trip
        r_active = seed_reminder(store, "trip", trip.id, "rem-1", fired=False, done=False)
        r_fired = seed_reminder(store, "trip", trip.id, "rem-2", fired=True, done=False)
        r_done = seed_reminder(store, "trip", trip.id, "rem-3", fired=False, done=True)
        result = store.get_all_unfired_reminders()
        ids = {r.id for r in result}
        assert r_active.id in ids
        assert r_fired.id not in ids
        assert r_done.id not in ids

    async def test_update_reminder_allowed_fields(self, store_with_trip):
        store, trip = store_with_trip
        rem = seed_reminder(store, "trip", trip.id)
        trip.reminders.append(rem.id)
        await store.async_update_reminder(rem.id, label="New Label", fired=True, done=True)
        assert store._reminders[rem.id].label == "New Label"
        assert store._reminders[rem.id].fired is True
        assert store._reminders[rem.id].done is True

    async def test_update_reminder_ignores_disallowed_fields(self, store_with_trip):
        store, trip = store_with_trip
        rem = seed_reminder(store, "trip", trip.id)
        original_id = rem.id
        await store.async_update_reminder(rem.id, id="hacked", parent_id="hacked")
        assert store._reminders[original_id].id == original_id
        assert store._reminders[original_id].parent_id == trip.id

    async def test_mark_reminder_fired(self, store_with_trip):
        store, trip = store_with_trip
        rem = seed_reminder(store, "trip", trip.id, fired=False)
        await store.async_mark_reminder_fired(rem.id)
        assert store._reminders[rem.id].fired is True

    async def test_mark_reminder_fired_unknown_is_noop(self):
        store = make_store()
        await store.async_mark_reminder_fired("ghost")  # must not raise

    async def test_mark_reminder_done(self, store_with_trip):
        store, trip = store_with_trip
        rem = seed_reminder(store, "trip", trip.id, fired=False, done=False)
        result = await store.async_mark_reminder_done(rem.id)
        assert result is not None
        assert store._reminders[rem.id].done is True
        assert store._reminders[rem.id].fired is True

    async def test_mark_reminder_done_unknown_returns_none(self):
        store = make_store()
        result = await store.async_mark_reminder_done("ghost")
        assert result is None

    async def test_delete_reminder_for_trip(self, store_with_trip):
        store, trip = store_with_trip
        rem = seed_reminder(store, "trip", trip.id)
        trip.reminders.append(rem.id)
        await store.async_delete_reminder(rem.id)
        assert rem.id not in store._reminders
        assert rem.id not in trip.reminders

    async def test_delete_reminder_for_leg(self, store_with_leg):
        store, trip, leg = store_with_leg
        rem = seed_reminder(store, "leg", leg.id)
        leg.reminders.append(rem.id)
        await store.async_delete_reminder(rem.id)
        assert rem.id not in store._reminders
        assert rem.id not in leg.reminders

    async def test_delete_reminder_for_stay(self, store_with_stay):
        store, trip, stay = store_with_stay
        rem = seed_reminder(store, "stay", stay.id)
        stay.reminders.append(rem.id)
        await store.async_delete_reminder(rem.id)
        assert rem.id not in store._reminders
        assert rem.id not in stay.reminders

    async def test_delete_nonexistent_reminder_is_noop(self):
        store = make_store()
        await store.async_delete_reminder("ghost")  # must not raise


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

class TestQueryHelpers:
    def test_get_next_upcoming_leg_returns_earliest(self):
        store = make_store()
        trip = seed_trip(store)
        leg1 = seed_leg(store, trip, leg_id="leg-1", depart_offset_days=10)
        leg2 = seed_leg(store, trip, leg_id="leg-2", depart_offset_days=3)
        result = store.get_next_upcoming_leg()
        assert result.id == leg2.id

    def test_get_next_upcoming_leg_ignores_non_upcoming(self):
        store = make_store()
        trip = seed_trip(store)
        seed_leg(store, trip, leg_id="leg-active", depart_offset_days=1, status="active")
        seed_leg(store, trip, leg_id="leg-done", depart_offset_days=2, status="completed")
        assert store.get_next_upcoming_leg() is None

    def test_get_next_upcoming_leg_ignores_past_departures(self):
        store = make_store()
        trip = seed_trip(store)
        seed_leg(store, trip, leg_id="past", depart_offset_days=-1, status="upcoming")
        assert store.get_next_upcoming_leg() is None

    def test_get_next_upcoming_leg_none_when_empty(self):
        store = make_store()
        assert store.get_next_upcoming_leg() is None

    def test_get_current_active_leg_returns_active(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip, leg_id="active", depart_offset_days=-1, status="active")
        result = store.get_current_active_leg()
        assert result.id == leg.id

    def test_get_current_active_leg_none_when_no_active(self):
        store = make_store()
        trip = seed_trip(store)
        seed_leg(store, trip, status="upcoming")
        assert store.get_current_active_leg() is None

    def test_get_days_until_next_departure(self):
        store = make_store()
        trip = seed_trip(store)
        seed_leg(store, trip, depart_offset_days=5)
        days = store.get_days_until_next_departure()
        assert days in (4, 5)  # allow for test execution time

    def test_get_days_until_next_departure_none_when_no_upcoming(self):
        store = make_store()
        assert store.get_days_until_next_departure() is None


# ---------------------------------------------------------------------------
# get_trip_context
# ---------------------------------------------------------------------------

class TestGetTripContext:
    def test_returns_empty_dict_for_unknown_trip(self):
        store = make_store()
        assert store.get_trip_context("ghost") == {}

    def test_top_level_keys(self):
        store = make_store()
        trip = seed_trip(store)
        ctx = store.get_trip_context(trip.id)
        assert set(ctx.keys()) == {"id", "name", "description", "notes", "segments", "stays"}

    def test_trip_fields_in_context(self):
        store = make_store()
        trip = seed_trip(store, name="Euro Trip")
        ctx = store.get_trip_context(trip.id)
        assert ctx["id"] == trip.id
        assert ctx["name"] == "Euro Trip"

    def test_segment_has_depart_and_arrive_timezone_not_legacy(self):
        """Regression guard: Leg.timezone doesn't exist — must use depart_timezone/arrive_timezone."""
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        ctx = store.get_trip_context(trip.id)
        seg = ctx["segments"][0]
        assert "depart_timezone" in seg
        assert "arrive_timezone" in seg
        assert "timezone" not in seg
        assert seg["depart_timezone"] == "Europe/Madrid"
        assert seg["arrive_timezone"] == "America/Bogota"

    def test_stay_has_timezone_field(self):
        store = make_store()
        trip = seed_trip(store)
        seed_stay(store, trip)
        ctx = store.get_trip_context(trip.id)
        stay_ctx = ctx["stays"][0]
        assert "timezone" in stay_ctx
        assert stay_ctx["timezone"] == "Europe/Madrid"

    def test_segment_arrive_at_none_when_not_set(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        assert leg.arrive_at is None
        ctx = store.get_trip_context(trip.id)
        assert ctx["segments"][0]["arrive_at"] is None

    def test_checklist_counts(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        item1 = seed_checklist_item(store, leg.id, "ci-1", checked=True)
        item2 = seed_checklist_item(store, leg.id, "ci-2", checked=False)
        leg.checklist_items = [item1.id, item2.id]
        ctx = store.get_trip_context(trip.id)
        cl = ctx["segments"][0]["checklist"]
        assert cl["total"] == 2
        assert cl["done"] == 1

    def test_reminders_in_segment(self):
        store = make_store()
        trip = seed_trip(store)
        leg = seed_leg(store, trip)
        rem = seed_reminder(store, "leg", leg.id)
        ctx = store.get_trip_context(trip.id)
        rems = ctx["segments"][0]["reminders"]
        assert len(rems) == 1
        assert rems[0]["id"] == rem.id
        assert rems[0]["label"] == rem.label

    def test_reminders_in_stay(self):
        store = make_store()
        trip = seed_trip(store)
        stay = seed_stay(store, trip)
        rem = seed_reminder(store, "stay", stay.id)
        ctx = store.get_trip_context(trip.id)
        rems = ctx["stays"][0]["reminders"]
        assert len(rems) == 1
        assert rems[0]["id"] == rem.id

    def test_segments_sorted_by_sequence(self):
        store = make_store()
        trip = seed_trip(store)
        leg_b = seed_leg(store, trip, leg_id="leg-b", sequence=2)
        leg_a = seed_leg(store, trip, leg_id="leg-a", sequence=1)
        ctx = store.get_trip_context(trip.id)
        segs = ctx["segments"]
        assert segs[0]["id"] == leg_a.id
        assert segs[1]["id"] == leg_b.id

    def test_empty_trip_has_empty_segments_and_stays(self):
        store = make_store()
        trip = seed_trip(store)
        ctx = store.get_trip_context(trip.id)
        assert ctx["segments"] == []
        assert ctx["stays"] == []
