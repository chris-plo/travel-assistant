"""Reminder scheduler for Travel Assistant."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.util import dt as dt_util

from .const import EVENT_REMINDER

if TYPE_CHECKING:
    from .models import Reminder
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)


class ReminderScheduler:
    """Schedules reminders and fires HA bus events when they are due."""

    def __init__(self, hass: HomeAssistant, store: "TravelStore") -> None:
        self._hass = hass
        self._store = store
        self._cancel_callbacks: dict[str, callable] = {}

    async def async_schedule_all(self) -> None:
        """Schedule all unfired reminders. Called once at integration startup."""
        for reminder in self._store.get_all_unfired_reminders():
            self.schedule_reminder(reminder)

    def schedule_reminder(self, reminder: "Reminder") -> None:
        """Schedule a single reminder, firing immediately if already past due."""
        self.cancel_reminder(reminder.id)

        fire_at_utc = dt_util.as_utc(reminder.fire_at)
        now_utc = datetime.now(tz=timezone.utc)

        if fire_at_utc <= now_utc:
            # Past due — fire immediately on the event loop
            self._hass.async_create_task(self._fire_reminder(reminder.id))
            return

        @callback
        def _callback(now: datetime) -> None:
            self._hass.async_create_task(self._fire_reminder(reminder.id))

        unsub = async_track_point_in_utc_time(self._hass, _callback, fire_at_utc)
        self._cancel_callbacks[reminder.id] = unsub

    def cancel_reminder(self, reminder_id: str) -> None:
        """Cancel a scheduled callback if one exists."""
        unsub = self._cancel_callbacks.pop(reminder_id, None)
        if unsub is not None:
            try:
                unsub()
            except Exception:
                pass

    async def async_reschedule_reminder(self, reminder: "Reminder") -> None:
        """Cancel existing schedule and re-schedule (e.g. after fire_at is edited)."""
        self.cancel_reminder(reminder.id)
        await self._store.async_mark_reminder_fired(reminder.id)  # reset first
        # Un-fire it so it can be scheduled again
        if reminder.id in self._store._reminders:
            self._store._reminders[reminder.id].fired = False
        self.schedule_reminder(reminder)

    def async_unload(self) -> None:
        """Cancel all tracked callbacks on integration unload."""
        for unsub in list(self._cancel_callbacks.values()):
            try:
                unsub()
            except Exception:
                pass
        self._cancel_callbacks.clear()

    async def _fire_reminder(self, reminder_id: str) -> None:
        """Fire the HA bus event and mark the reminder as fired."""
        reminder = self._store._reminders.get(reminder_id)
        if reminder is None or reminder.fired:
            return

        payload = {
            "reminder_id": reminder.id,
            "label": reminder.label,
            "parent_type": reminder.parent_type,
            "parent_id": reminder.parent_id,
            "fire_at": reminder.fire_at.isoformat(),
            **reminder.event_data,
        }

        self._hass.bus.async_fire(EVENT_REMINDER, payload)
        await self._store.async_mark_reminder_fired(reminder_id)
        self._cancel_callbacks.pop(reminder_id, None)

        _LOGGER.info("Fired reminder %r: %s", reminder_id, reminder.label)
