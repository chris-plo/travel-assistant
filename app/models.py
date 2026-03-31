"""Data models for Travel Assistant."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


def _parse_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError(f"Datetime must be timezone-aware: {value!r}")
    return dt


def _fmt_dt(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@dataclass
class ChecklistItem:
    id: str
    leg_id: str          # generic parent ID — holds leg_id OR stay_id
    label: str
    checked: bool
    due_offset_hours: int | None
    created_at: datetime

    @classmethod
    def from_dict(cls, d: dict) -> "ChecklistItem":
        return cls(
            id=d["id"],
            leg_id=d.get("leg_id") or d.get("parent_id", ""),
            label=d["label"],
            checked=d.get("checked", False),
            due_offset_hours=d.get("due_offset_hours"),
            created_at=_parse_dt(d["created_at"]),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "leg_id": self.leg_id, "label": self.label,
            "checked": self.checked, "due_offset_hours": self.due_offset_hours,
            "created_at": _fmt_dt(self.created_at),
        }


@dataclass
class Document:
    id: str
    leg_id: str          # generic parent ID — holds leg_id OR stay_id
    filename: str
    mime_type: str
    storage_mode: Literal["base64", "filepath"]
    content: str
    uploaded_at: datetime

    @classmethod
    def from_dict(cls, d: dict) -> "Document":
        return cls(
            id=d["id"],
            leg_id=d.get("leg_id") or d.get("parent_id", ""),
            filename=d["filename"],
            mime_type=d["mime_type"], storage_mode=d["storage_mode"],
            content=d["content"], uploaded_at=_parse_dt(d["uploaded_at"]),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "leg_id": self.leg_id, "filename": self.filename,
            "mime_type": self.mime_type, "storage_mode": self.storage_mode,
            "content": self.content, "uploaded_at": _fmt_dt(self.uploaded_at),
        }

    def to_meta_dict(self) -> dict:
        d = self.to_dict()
        d.pop("content")
        return d


@dataclass
class Reminder:
    id: str
    parent_type: Literal["trip", "leg", "stay"]
    parent_id: str
    label: str
    fire_at: datetime
    event_data: dict
    fired: bool
    done: bool = False
    repeat_interval_hours: float | None = None
    cancel_handle_id: str | None = None
    checklist_item_id: str | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Reminder":
        return cls(
            id=d["id"], parent_type=d["parent_type"], parent_id=d["parent_id"],
            label=d["label"], fire_at=_parse_dt(d["fire_at"]),
            event_data=d.get("event_data", {}), fired=d.get("fired", False),
            done=d.get("done", False),
            repeat_interval_hours=d.get("repeat_interval_hours"),
            cancel_handle_id=d.get("cancel_handle_id"),
            checklist_item_id=d.get("checklist_item_id"),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "parent_type": self.parent_type, "parent_id": self.parent_id,
            "label": self.label, "fire_at": _fmt_dt(self.fire_at),
            "event_data": self.event_data, "fired": self.fired,
            "done": self.done, "repeat_interval_hours": self.repeat_interval_hours,
            "cancel_handle_id": self.cancel_handle_id,
            "checklist_item_id": self.checklist_item_id,
        }


@dataclass
class Leg:
    id: str
    trip_id: str
    sequence: int
    type: str
    origin: str
    destination: str
    depart_at: datetime
    arrive_at: datetime | None
    carrier: str | None
    flight_number: str | None
    notes: str | None
    checklist_items: list[str]
    documents: list[str]
    reminders: list[str]
    status: Literal["upcoming", "active", "completed", "cancelled"]
    depart_timezone: str | None = None
    arrive_timezone: str | None = None
    seats: str | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Leg":
        # Backward compat: old data has a single "timezone" field
        legacy_tz = d.get("timezone")
        return cls(
            id=d["id"], trip_id=d["trip_id"], sequence=d.get("sequence", 0),
            type=d.get("type", "flight"), origin=d["origin"], destination=d["destination"],
            depart_at=_parse_dt(d["depart_at"]), arrive_at=_parse_dt(d.get("arrive_at")),
            carrier=d.get("carrier"), flight_number=d.get("flight_number"),
            notes=d.get("notes"), checklist_items=d.get("checklist_items", []),
            documents=d.get("documents", []), reminders=d.get("reminders", []),
            status=d.get("status", "upcoming"),
            depart_timezone=d.get("depart_timezone") or legacy_tz,
            arrive_timezone=d.get("arrive_timezone") or legacy_tz,
            seats=d.get("seats"),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "trip_id": self.trip_id, "sequence": self.sequence,
            "type": self.type, "origin": self.origin, "destination": self.destination,
            "depart_at": _fmt_dt(self.depart_at), "arrive_at": _fmt_dt(self.arrive_at),
            "carrier": self.carrier, "flight_number": self.flight_number,
            "notes": self.notes, "checklist_items": self.checklist_items,
            "documents": self.documents, "reminders": self.reminders,
            "status": self.status,
            "depart_timezone": self.depart_timezone,
            "arrive_timezone": self.arrive_timezone,
            "seats": self.seats,
        }


@dataclass
class Stay:
    id: str
    trip_id: str
    sequence: int
    name: str
    location: str
    check_in: datetime | None
    check_out: datetime | None
    address: str | None
    confirmation_number: str | None
    notes: str | None
    timezone: str | None
    checklist_items: list[str]
    documents: list[str]
    reminders: list[str]
    status: Literal["upcoming", "active", "completed", "cancelled"] = "upcoming"

    @classmethod
    def from_dict(cls, d: dict) -> "Stay":
        return cls(
            id=d["id"], trip_id=d["trip_id"], sequence=d.get("sequence", 0),
            name=d.get("name", ""), location=d.get("location", ""),
            check_in=_parse_dt(d.get("check_in")), check_out=_parse_dt(d.get("check_out")),
            address=d.get("address"), confirmation_number=d.get("confirmation_number"),
            notes=d.get("notes"), timezone=d.get("timezone"),
            checklist_items=d.get("checklist_items", []),
            documents=d.get("documents", []), reminders=d.get("reminders", []),
            status=d.get("status", "upcoming"),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "trip_id": self.trip_id, "sequence": self.sequence,
            "name": self.name, "location": self.location,
            "check_in": _fmt_dt(self.check_in), "check_out": _fmt_dt(self.check_out),
            "address": self.address, "confirmation_number": self.confirmation_number,
            "notes": self.notes, "timezone": self.timezone,
            "checklist_items": self.checklist_items,
            "documents": self.documents, "reminders": self.reminders,
            "status": self.status,
        }


@dataclass
class Trip:
    id: str
    name: str
    description: str | None
    legs: list[str]
    stays: list[str]
    reminders: list[str]
    created_at: datetime
    updated_at: datetime
    notes: str | None = None
    chat_history: list[dict] = field(default_factory=list)
    chat_summary: str | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Trip":
        return cls(
            id=d["id"], name=d["name"], description=d.get("description"),
            legs=d.get("legs", []), stays=d.get("stays", []),
            reminders=d.get("reminders", []),
            created_at=_parse_dt(d["created_at"]), updated_at=_parse_dt(d["updated_at"]),
            notes=d.get("notes"),
            chat_history=d.get("chat_history", []), chat_summary=d.get("chat_summary"),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "legs": self.legs, "stays": self.stays, "reminders": self.reminders,
            "created_at": _fmt_dt(self.created_at), "updated_at": _fmt_dt(self.updated_at),
            "notes": self.notes,
            "chat_history": self.chat_history, "chat_summary": self.chat_summary,
        }
