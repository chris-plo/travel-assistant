"""Unit tests for app/models.py — all model dataclasses and helpers."""
from __future__ import annotations

import pytest
from datetime import datetime, timezone, timedelta

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models import (
    _parse_dt, _fmt_dt,
    ChecklistItem, Document, Reminder, Leg, Stay, Trip,
)

UTC = timezone.utc
DT = datetime(2025, 6, 15, 10, 0, 0, tzinfo=UTC)
DT_STR = "2025-06-15T10:00:00+00:00"


# ---------------------------------------------------------------------------
# _parse_dt / _fmt_dt
# ---------------------------------------------------------------------------

class TestParseDt:
    def test_none_returns_none(self):
        assert _parse_dt(None) is None

    def test_parses_utc_iso(self):
        dt = _parse_dt("2025-01-01T00:00:00+00:00")
        assert dt == datetime(2025, 1, 1, tzinfo=UTC)

    def test_parses_offset_aware(self):
        dt = _parse_dt("2025-06-15T12:00:00+05:30")
        assert dt.utcoffset() == timedelta(hours=5, minutes=30)

    def test_naive_datetime_raises(self):
        with pytest.raises(ValueError, match="timezone-aware"):
            _parse_dt("2025-01-01T00:00:00")


class TestFmtDt:
    def test_none_returns_none(self):
        assert _fmt_dt(None) is None

    def test_formats_datetime(self):
        result = _fmt_dt(DT)
        assert result == DT_STR

    def test_roundtrip(self):
        assert _parse_dt(_fmt_dt(DT)) == DT


# ---------------------------------------------------------------------------
# ChecklistItem
# ---------------------------------------------------------------------------

class TestChecklistItem:
    def _base_dict(self, **overrides):
        d = {
            "id": "ci-1",
            "leg_id": "leg-1",
            "label": "Pack passport",
            "checked": False,
            "due_offset_hours": 24,
            "created_at": DT_STR,
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        item = ChecklistItem.from_dict(self._base_dict())
        assert item.id == "ci-1"
        assert item.leg_id == "leg-1"
        assert item.label == "Pack passport"
        assert item.checked is False
        assert item.due_offset_hours == 24
        assert item.created_at == DT

    def test_from_dict_legacy_parent_id(self):
        d = self._base_dict()
        d.pop("leg_id")
        d["parent_id"] = "stay-99"
        item = ChecklistItem.from_dict(d)
        assert item.leg_id == "stay-99"

    def test_from_dict_leg_id_takes_priority_over_parent_id(self):
        d = self._base_dict()
        d["parent_id"] = "old-parent"
        item = ChecklistItem.from_dict(d)
        assert item.leg_id == "leg-1"

    def test_from_dict_defaults_checked_false(self):
        d = self._base_dict()
        del d["checked"]
        item = ChecklistItem.from_dict(d)
        assert item.checked is False

    def test_from_dict_no_due_offset(self):
        d = self._base_dict()
        del d["due_offset_hours"]
        item = ChecklistItem.from_dict(d)
        assert item.due_offset_hours is None

    def test_to_dict_roundtrip(self):
        item = ChecklistItem.from_dict(self._base_dict())
        d = item.to_dict()
        item2 = ChecklistItem.from_dict(d)
        assert item == item2

    def test_to_dict_keys(self):
        item = ChecklistItem.from_dict(self._base_dict())
        d = item.to_dict()
        assert set(d.keys()) == {"id", "leg_id", "label", "checked", "due_offset_hours", "created_at"}


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------

class TestDocument:
    def _base_dict(self, **overrides):
        d = {
            "id": "doc-1",
            "leg_id": "leg-1",
            "filename": "boarding_pass.pdf",
            "mime_type": "application/pdf",
            "storage_mode": "base64",
            "content": "abc123==",
            "uploaded_at": DT_STR,
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        doc = Document.from_dict(self._base_dict())
        assert doc.id == "doc-1"
        assert doc.leg_id == "leg-1"
        assert doc.filename == "boarding_pass.pdf"
        assert doc.mime_type == "application/pdf"
        assert doc.storage_mode == "base64"
        assert doc.content == "abc123=="
        assert doc.uploaded_at == DT

    def test_from_dict_legacy_parent_id(self):
        d = self._base_dict()
        d.pop("leg_id")
        d["parent_id"] = "stay-5"
        doc = Document.from_dict(d)
        assert doc.leg_id == "stay-5"

    def test_from_dict_filepath_mode(self):
        doc = Document.from_dict(self._base_dict(storage_mode="filepath", content="/data/docs/file.pdf"))
        assert doc.storage_mode == "filepath"
        assert doc.content == "/data/docs/file.pdf"

    def test_to_dict_roundtrip(self):
        doc = Document.from_dict(self._base_dict())
        doc2 = Document.from_dict(doc.to_dict())
        assert doc == doc2

    def test_to_meta_dict_excludes_content(self):
        doc = Document.from_dict(self._base_dict())
        meta = doc.to_meta_dict()
        assert "content" not in meta
        assert meta["id"] == "doc-1"
        assert meta["filename"] == "boarding_pass.pdf"

    def test_to_meta_dict_does_not_modify_original(self):
        doc = Document.from_dict(self._base_dict())
        doc.to_meta_dict()
        assert doc.content == "abc123=="


# ---------------------------------------------------------------------------
# Reminder
# ---------------------------------------------------------------------------

class TestReminder:
    def _base_dict(self, **overrides):
        d = {
            "id": "rem-1",
            "parent_type": "leg",
            "parent_id": "leg-1",
            "label": "Check in online",
            "fire_at": DT_STR,
            "event_data": {"key": "val"},
            "fired": False,
            "done": False,
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        rem = Reminder.from_dict(self._base_dict())
        assert rem.id == "rem-1"
        assert rem.parent_type == "leg"
        assert rem.parent_id == "leg-1"
        assert rem.label == "Check in online"
        assert rem.fire_at == DT
        assert rem.event_data == {"key": "val"}
        assert rem.fired is False
        assert rem.done is False

    def test_from_dict_defaults(self):
        d = self._base_dict()
        del d["event_data"]
        del d["fired"]
        del d["done"]
        rem = Reminder.from_dict(d)
        assert rem.event_data == {}
        assert rem.fired is False
        assert rem.done is False

    def test_from_dict_optional_fields(self):
        rem = Reminder.from_dict(self._base_dict(
            repeat_interval_hours=24.0,
            cancel_handle_id="handle-99",
            checklist_item_id="ci-5",
        ))
        assert rem.repeat_interval_hours == 24.0
        assert rem.cancel_handle_id == "handle-99"
        assert rem.checklist_item_id == "ci-5"

    def test_from_dict_trip_parent_type(self):
        rem = Reminder.from_dict(self._base_dict(parent_type="trip", parent_id="trip-1"))
        assert rem.parent_type == "trip"

    def test_from_dict_stay_parent_type(self):
        rem = Reminder.from_dict(self._base_dict(parent_type="stay", parent_id="stay-1"))
        assert rem.parent_type == "stay"

    def test_to_dict_roundtrip(self):
        rem = Reminder.from_dict(self._base_dict(repeat_interval_hours=12.0, checklist_item_id="ci-1"))
        rem2 = Reminder.from_dict(rem.to_dict())
        assert rem == rem2

    def test_to_dict_keys(self):
        rem = Reminder.from_dict(self._base_dict())
        keys = set(rem.to_dict().keys())
        assert keys == {"id", "parent_type", "parent_id", "label", "fire_at", "event_data",
                        "fired", "done", "repeat_interval_hours", "cancel_handle_id", "checklist_item_id"}


# ---------------------------------------------------------------------------
# Leg
# ---------------------------------------------------------------------------

class TestLeg:
    def _base_dict(self, **overrides):
        d = {
            "id": "leg-1",
            "trip_id": "trip-1",
            "sequence": 0,
            "type": "flight",
            "origin": "MAD",
            "destination": "BOG",
            "depart_at": DT_STR,
            "arrive_at": None,
            "carrier": "LATAM",
            "flight_number": "LA505",
            "notes": "Window seat",
            "checklist_items": [],
            "documents": [],
            "reminders": [],
            "status": "upcoming",
            "depart_timezone": "Europe/Madrid",
            "arrive_timezone": "America/Bogota",
            "seats": "12A",
            "booking_url": "https://example.com",
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        leg = Leg.from_dict(self._base_dict())
        assert leg.id == "leg-1"
        assert leg.trip_id == "trip-1"
        assert leg.type == "flight"
        assert leg.origin == "MAD"
        assert leg.destination == "BOG"
        assert leg.depart_at == DT
        assert leg.arrive_at is None
        assert leg.carrier == "LATAM"
        assert leg.flight_number == "LA505"
        assert leg.depart_timezone == "Europe/Madrid"
        assert leg.arrive_timezone == "America/Bogota"
        assert leg.seats == "12A"
        assert leg.booking_url == "https://example.com"
        assert leg.status == "upcoming"

    def test_from_dict_default_type(self):
        d = self._base_dict()
        del d["type"]
        leg = Leg.from_dict(d)
        assert leg.type == "flight"

    def test_from_dict_default_sequence(self):
        d = self._base_dict()
        del d["sequence"]
        leg = Leg.from_dict(d)
        assert leg.sequence == 0

    def test_from_dict_default_status(self):
        d = self._base_dict()
        del d["status"]
        leg = Leg.from_dict(d)
        assert leg.status == "upcoming"

    def test_from_dict_with_arrive_at(self):
        arrive_str = "2025-06-15T22:00:00+00:00"
        leg = Leg.from_dict(self._base_dict(arrive_at=arrive_str))
        assert leg.arrive_at == datetime(2025, 6, 15, 22, 0, tzinfo=UTC)

    def test_from_dict_legacy_timezone_field(self):
        """Single 'timezone' field should populate both depart and arrive timezones."""
        d = self._base_dict()
        del d["depart_timezone"]
        del d["arrive_timezone"]
        d["timezone"] = "Europe/London"
        leg = Leg.from_dict(d)
        assert leg.depart_timezone == "Europe/London"
        assert leg.arrive_timezone == "Europe/London"

    def test_from_dict_new_fields_take_priority_over_legacy(self):
        """If both new fields and legacy 'timezone' are present, new ones win."""
        d = self._base_dict(timezone="Europe/London")
        leg = Leg.from_dict(d)
        assert leg.depart_timezone == "Europe/Madrid"
        assert leg.arrive_timezone == "America/Bogota"

    def test_from_dict_no_timezone_fields(self):
        d = self._base_dict()
        del d["depart_timezone"]
        del d["arrive_timezone"]
        leg = Leg.from_dict(d)
        assert leg.depart_timezone is None
        assert leg.arrive_timezone is None

    def test_to_dict_roundtrip(self):
        leg = Leg.from_dict(self._base_dict())
        leg2 = Leg.from_dict(leg.to_dict())
        assert leg == leg2

    def test_to_dict_has_no_legacy_timezone_key(self):
        leg = Leg.from_dict(self._base_dict())
        d = leg.to_dict()
        assert "timezone" not in d
        assert "depart_timezone" in d
        assert "arrive_timezone" in d

    def test_to_dict_keys(self):
        leg = Leg.from_dict(self._base_dict())
        keys = set(leg.to_dict().keys())
        expected = {"id", "trip_id", "sequence", "type", "origin", "destination",
                    "depart_at", "arrive_at", "carrier", "flight_number", "notes",
                    "checklist_items", "documents", "reminders", "status",
                    "depart_timezone", "arrive_timezone", "seats", "booking_url"}
        assert keys == expected

    def test_all_leg_types(self):
        for t in ("flight", "train", "bus", "drive", "ferry", "other"):
            leg = Leg.from_dict(self._base_dict(type=t))
            assert leg.type == t

    def test_all_status_values(self):
        for s in ("upcoming", "active", "completed", "cancelled"):
            leg = Leg.from_dict(self._base_dict(status=s))
            assert leg.status == s

    def test_from_dict_empty_lists_default(self):
        d = self._base_dict()
        del d["checklist_items"]
        del d["documents"]
        del d["reminders"]
        leg = Leg.from_dict(d)
        assert leg.checklist_items == []
        assert leg.documents == []
        assert leg.reminders == []


# ---------------------------------------------------------------------------
# Stay
# ---------------------------------------------------------------------------

class TestStay:
    def _base_dict(self, **overrides):
        d = {
            "id": "stay-1",
            "trip_id": "trip-1",
            "sequence": 1,
            "name": "Hotel Barcelona",
            "location": "Barcelona",
            "check_in": DT_STR,
            "check_out": "2025-06-20T10:00:00+00:00",
            "address": "Las Ramblas 1",
            "confirmation_number": "ABC123",
            "notes": "Late check-in",
            "timezone": "Europe/Madrid",
            "checklist_items": [],
            "documents": [],
            "reminders": [],
            "status": "upcoming",
            "booking_url": "https://hotel.example.com",
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        stay = Stay.from_dict(self._base_dict())
        assert stay.id == "stay-1"
        assert stay.trip_id == "trip-1"
        assert stay.name == "Hotel Barcelona"
        assert stay.location == "Barcelona"
        assert stay.check_in == DT
        assert stay.address == "Las Ramblas 1"
        assert stay.confirmation_number == "ABC123"
        assert stay.timezone == "Europe/Madrid"
        assert stay.status == "upcoming"
        assert stay.booking_url == "https://hotel.example.com"

    def test_from_dict_optional_fields_absent(self):
        stay = Stay.from_dict({
            "id": "stay-2",
            "trip_id": "trip-1",
            "created_at": DT_STR,
        })
        assert stay.name == ""
        assert stay.location == ""
        assert stay.check_in is None
        assert stay.check_out is None
        assert stay.address is None
        assert stay.confirmation_number is None
        assert stay.timezone is None
        assert stay.status == "upcoming"
        assert stay.booking_url is None

    def test_to_dict_roundtrip(self):
        stay = Stay.from_dict(self._base_dict())
        stay2 = Stay.from_dict(stay.to_dict())
        assert stay == stay2

    def test_to_dict_keys(self):
        stay = Stay.from_dict(self._base_dict())
        keys = set(stay.to_dict().keys())
        expected = {"id", "trip_id", "sequence", "name", "location", "check_in", "check_out",
                    "address", "confirmation_number", "notes", "timezone",
                    "checklist_items", "documents", "reminders", "status", "booking_url"}
        assert keys == expected

    def test_all_status_values(self):
        for s in ("upcoming", "active", "completed", "cancelled"):
            stay = Stay.from_dict(self._base_dict(status=s))
            assert stay.status == s


# ---------------------------------------------------------------------------
# Trip
# ---------------------------------------------------------------------------

class TestTrip:
    def _base_dict(self, **overrides):
        d = {
            "id": "trip-1",
            "name": "Europe 2025",
            "description": "Summer trip",
            "legs": ["leg-1"],
            "stays": ["stay-1"],
            "reminders": ["rem-1"],
            "created_at": DT_STR,
            "updated_at": DT_STR,
            "notes": "Pack light",
            "chat_history": [{"role": "user", "content": "Hello", "ts": DT_STR}],
            "chat_summary": "User asked hello",
        }
        d.update(overrides)
        return d

    def test_from_dict_basic(self):
        trip = Trip.from_dict(self._base_dict())
        assert trip.id == "trip-1"
        assert trip.name == "Europe 2025"
        assert trip.description == "Summer trip"
        assert trip.legs == ["leg-1"]
        assert trip.stays == ["stay-1"]
        assert trip.reminders == ["rem-1"]
        assert trip.created_at == DT
        assert trip.updated_at == DT
        assert trip.notes == "Pack light"
        assert len(trip.chat_history) == 1
        assert trip.chat_summary == "User asked hello"

    def test_from_dict_optional_defaults(self):
        trip = Trip.from_dict({
            "id": "trip-2",
            "name": "Minimal",
            "created_at": DT_STR,
            "updated_at": DT_STR,
        })
        assert trip.description is None
        assert trip.legs == []
        assert trip.stays == []
        assert trip.reminders == []
        assert trip.notes is None
        assert trip.chat_history == []
        assert trip.chat_summary is None

    def test_to_dict_roundtrip(self):
        trip = Trip.from_dict(self._base_dict())
        trip2 = Trip.from_dict(trip.to_dict())
        assert trip == trip2

    def test_to_dict_includes_chat_history(self):
        trip = Trip.from_dict(self._base_dict())
        d = trip.to_dict()
        assert "chat_history" in d
        assert len(d["chat_history"]) == 1

    def test_to_dict_keys(self):
        trip = Trip.from_dict(self._base_dict())
        keys = set(trip.to_dict().keys())
        expected = {"id", "name", "description", "legs", "stays", "reminders",
                    "created_at", "updated_at", "notes", "chat_history", "chat_summary"}
        assert keys == expected
