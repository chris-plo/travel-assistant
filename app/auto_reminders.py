"""Auto-create/update departure and check-in reminders for legs and stays."""
from __future__ import annotations

import logging
import zoneinfo
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Leg, Stay
    from .reminders import ReminderScheduler
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)
_AUTO_KEY = "auto"  # marker in event_data


def _find_auto_reminder(store: "TravelStore", parent_id: str):
    for r in store.get_reminders_for_parent(parent_id):
        if r.event_data.get(_AUTO_KEY):
            return r
    return None


def _infer_stay_tz(stay: "Stay", store: "TravelStore") -> str:
    """Return the best IANA timezone string for a stay, falling back to adjacent legs."""
    if stay.timezone:
        return stay.timezone
    legs = store.get_legs_for_trip(stay.trip_id)
    prev = max(
        (l for l in legs if l.sequence < stay.sequence),
        default=None,
        key=lambda l: l.sequence,
    )
    if prev and prev.arrive_timezone:
        return prev.arrive_timezone
    nxt = min(
        (l for l in legs if l.sequence > stay.sequence),
        default=None,
        key=lambda l: l.sequence,
    )
    if nxt and nxt.depart_timezone:
        return nxt.depart_timezone
    return "UTC"


async def _upsert(
    store: "TravelStore",
    scheduler: "ReminderScheduler",
    parent_type: str,
    parent_id: str,
    fire_at: datetime,
    label: str,
    event_data: dict,
) -> None:
    now = datetime.now(timezone.utc)
    existing = _find_auto_reminder(store, parent_id)
    if fire_at <= now:
        # Past-due — remove any existing auto-reminder and skip creation
        if existing:
            await store.async_delete_reminder(existing.id)
            scheduler.cancel_reminder(existing.id)
        return
    if existing:
        await store.async_update_reminder(existing.id, fire_at=fire_at, label=label)
        scheduler.cancel_reminder(existing.id)
        updated = store._reminders[existing.id]
        scheduler.schedule_reminder(updated)
        _LOGGER.info("Updated auto-reminder %r → fire at %s", existing.id, fire_at.isoformat())
    else:
        reminder = await store.async_create_reminder(
            parent_type, parent_id, label, fire_at, event_data=event_data,
        )
        scheduler.schedule_reminder(reminder)
        _LOGGER.info("Created auto-reminder %r → fire at %s", reminder.id, fire_at.isoformat())


async def sync_leg(leg: "Leg", store: "TravelStore", scheduler: "ReminderScheduler") -> None:
    """Create or update the 3-hour departure auto-reminder for a leg."""
    if not leg.depart_at:
        return
    fire_at = leg.depart_at - timedelta(hours=3)
    label = f"Departing in 3 hours: {leg.origin} → {leg.destination}"
    await _upsert(
        store, scheduler, "leg", leg.id, fire_at, label,
        {_AUTO_KEY: True, "auto_type": "departure"},
    )


async def sync_stay(stay: "Stay", store: "TravelStore", scheduler: "ReminderScheduler") -> None:
    """Create or update the 12:00 noon check-in auto-reminder for a stay."""
    if not stay.check_in:
        return
    tz_name = _infer_stay_tz(stay, store)
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")
    local_checkin = stay.check_in.astimezone(tz)
    fire_at = local_checkin.replace(hour=12, minute=0, second=0, microsecond=0)
    label = f"Check-in today: {stay.name} ({stay.location})"
    await _upsert(
        store, scheduler, "stay", stay.id, fire_at, label,
        {_AUTO_KEY: True, "auto_type": "check_in"},
    )


async def sync_all(store: "TravelStore", scheduler: "ReminderScheduler") -> None:
    """Called at startup — ensure auto-reminders exist for all legs and stays."""
    for leg in list(store._legs.values()):
        try:
            await sync_leg(leg, store, scheduler)
        except Exception as exc:
            _LOGGER.error("sync_leg %s failed: %s", leg.id, exc)
    for stay in list(store._stays.values()):
        try:
            await sync_stay(stay, store, scheduler)
        except Exception as exc:
            _LOGGER.error("sync_stay %s failed: %s", stay.id, exc)
