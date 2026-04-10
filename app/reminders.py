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

        await ha_client.fire_event(EVENT_REMINDER, payload)
        await ha_client.create_persistent_notification(
            title="Travel Reminder",
            message=reminder.label,
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
