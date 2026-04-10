"""asyncio-based reminder scheduler for Travel Assistant add-on."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from . import ha_client

if TYPE_CHECKING:
    from .models import Reminder
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

EVENT_REMINDER = "travel_assistant_reminder"

_TYPE_ICON = {
    "flight": "✈️", "train": "🚂", "bus": "🚌",
    "ferry": "⛴️", "drive": "🚗", "other": "🧳",
}


def _fmt_local(dt: "datetime | None", tz_name: str | None) -> str:
    """Format a datetime in its local timezone as a readable string."""
    if not dt:
        return ""
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(tz_name) if tz_name else timezone.utc
        local = dt.astimezone(tz)
        return local.strftime("%a %-d %b, %H:%M")
    except Exception:
        return dt.strftime("%a %-d %b, %H:%M %Z")


def _build_notification(reminder: "Reminder", store: "TravelStore") -> tuple[str, str]:
    """Return (title, message) for a reminder, enriched for auto-reminders."""
    auto_type = reminder.event_data.get("auto_type")

    if auto_type == "departure" and reminder.parent_type == "leg":
        leg = store.get_leg(reminder.parent_id)
        if leg:
            icon = _TYPE_ICON.get(leg.type, "🧳")
            title = f"{icon} {leg.origin} → {leg.destination}"
            lines = [f"Departing: {_fmt_local(leg.depart_at, leg.depart_timezone)}"]
            if leg.arrive_at:
                lines.append(f"Arriving:  {_fmt_local(leg.arrive_at, leg.arrive_timezone)}")
            if leg.carrier or leg.flight_number:
                service = " ".join(filter(None, [leg.carrier, leg.flight_number]))
                lines.append(f"Service:   {service}")
            if leg.seats:
                lines.append(f"Seats:     {leg.seats}")
            if leg.booking_url:
                lines.append(f"Booking:   {leg.booking_url}")
            if leg.notes:
                lines.append(f"Notes:     {leg.notes}")
            return title, "\n".join(lines)

    if auto_type == "check_in" and reminder.parent_type == "stay":
        stay = store.get_stay(reminder.parent_id)
        if stay:
            title = f"🏨 Check-in today: {stay.name}"
            lines = []
            if stay.address:
                lines.append(stay.address)
            elif stay.location:
                lines.append(stay.location)
            if stay.check_in:
                lines.append(f"Check-in:  {_fmt_local(stay.check_in, stay.timezone)}")
            if stay.check_out:
                lines.append(f"Check-out: {_fmt_local(stay.check_out, stay.timezone)}")
            if stay.confirmation_number:
                lines.append(f"Ref:       {stay.confirmation_number}")
            if stay.booking_url:
                lines.append(f"Booking:   {stay.booking_url}")
            if stay.notes:
                lines.append(f"Notes:     {stay.notes}")
            return title, "\n".join(lines) if lines else stay.name

    # User-created or unrecognised reminder — use the label as-is
    return "Travel Reminder", reminder.label


class ReminderScheduler:
    def __init__(self, store: "TravelStore") -> None:
        self._store    = store
        self._tasks:   dict[str, asyncio.Task] = {}

    async def async_schedule_all(self) -> None:
        for reminder in self._store.get_all_unfired_reminders():
            self.schedule_reminder(reminder)

    def schedule_reminder(self, reminder: "Reminder") -> None:
        self.cancel_reminder(reminder.id)
        now = datetime.now(tz=timezone.utc)
        delay = (reminder.fire_at - now).total_seconds()

        if delay <= 0:
            # Past-due — fire immediately
            task = asyncio.create_task(self._fire(reminder.id))
        else:
            task = asyncio.create_task(self._wait_and_fire(reminder.id, delay))

        self._tasks[reminder.id] = task

    def cancel_reminder(self, reminder_id: str) -> None:
        task = self._tasks.pop(reminder_id, None)
        if task and not task.done():
            task.cancel()

    def shutdown(self) -> None:
        for task in list(self._tasks.values()):
            task.cancel()
        self._tasks.clear()

    async def _wait_and_fire(self, reminder_id: str, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            await self._fire(reminder_id)
        except asyncio.CancelledError:
            pass

    async def _fire(self, reminder_id: str) -> None:
        reminder = self._store._reminders.get(reminder_id)
        if not reminder or reminder.fired:
            return

        payload = {
            "reminder_id": reminder.id,
            "label": reminder.label,
            "parent_type": reminder.parent_type,
            "parent_id": reminder.parent_id,
            "fire_at": reminder.fire_at.isoformat(),
            **reminder.event_data,
        }

        title, message = _build_notification(reminder, self._store)

        await ha_client.fire_event(EVENT_REMINDER, payload)
        await ha_client.create_persistent_notification(
            title=title,
            message=message,
            notification_id=f"travel_reminder_{reminder.id}",
        )
        await self._store.async_mark_reminder_fired(reminder_id)
        self._tasks.pop(reminder_id, None)
        _LOGGER.info("Fired reminder %r: %s", reminder_id, reminder.label)

        # Re-schedule if repeat is configured and reminder hasn't been marked done
        reminder = self._store._reminders.get(reminder_id)
        if reminder and reminder.repeat_interval_hours and not reminder.done:
            from datetime import timedelta
            now = datetime.now(tz=timezone.utc)
            reminder.fired = False
            reminder.fire_at = now + timedelta(hours=reminder.repeat_interval_hours)
            self._store.schedule_save()
            self.schedule_reminder(reminder)
            _LOGGER.info(
                "Re-scheduled repeating reminder %r (%.1f h)", reminder_id, reminder.repeat_interval_hours
            )
