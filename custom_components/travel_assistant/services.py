"""HA service handlers for Travel Assistant."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    EVENT_CHECKLIST_CHANGED,
    EVENT_LEG_STATUS_CHANGED,
    LEG_STATUSES,
    SERVICE_ADD_CHECKLIST_ITEM,
    SERVICE_ADD_REMINDER,
    SERVICE_CHECK_ITEM,
    SERVICE_DELETE_REMINDER,
    SERVICE_FIRE_REMINDER,
    SERVICE_SET_LEG_STATUS,
    SERVICE_UNCHECK_ITEM,
)

if TYPE_CHECKING:
    from .reminders import ReminderScheduler
    from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

_SCHEMA_FIRE_REMINDER = vol.Schema({vol.Required("reminder_id"): cv.string})
_SCHEMA_CHECK_ITEM = vol.Schema({vol.Required("item_id"): cv.string})
_SCHEMA_ADD_CHECKLIST_ITEM = vol.Schema(
    {
        vol.Required("leg_id"): cv.string,
        vol.Required("label"): cv.string,
        vol.Optional("due_offset_hours"): vol.Coerce(int),
    }
)
_SCHEMA_SET_LEG_STATUS = vol.Schema(
    {
        vol.Required("leg_id"): cv.string,
        vol.Required("status"): vol.In(LEG_STATUSES),
    }
)
_SCHEMA_ADD_REMINDER = vol.Schema(
    {
        vol.Required("parent_type"): vol.In(["trip", "leg"]),
        vol.Required("parent_id"): cv.string,
        vol.Required("label"): cv.string,
        vol.Required("fire_at"): cv.string,
        vol.Optional("event_data", default={}): dict,
    }
)
_SCHEMA_DELETE_REMINDER = vol.Schema({vol.Required("reminder_id"): cv.string})


def register_services(
    hass: HomeAssistant,
    store: "TravelStore",
    scheduler: "ReminderScheduler",
) -> None:
    """Register all Travel Assistant services."""

    async def handle_fire_reminder(call: ServiceCall) -> None:
        rid = call.data["reminder_id"]
        reminder = store._reminders.get(rid)
        if reminder is None:
            _LOGGER.warning("fire_reminder: reminder %r not found", rid)
            return
        from .const import EVENT_REMINDER
        hass.bus.async_fire(
            EVENT_REMINDER,
            {
                "reminder_id": reminder.id,
                "label": reminder.label,
                "parent_type": reminder.parent_type,
                "parent_id": reminder.parent_id,
                "fire_at": reminder.fire_at.isoformat(),
                **reminder.event_data,
            },
        )

    async def handle_check_item(call: ServiceCall) -> None:
        item_id = call.data["item_id"]
        await store.async_set_checklist_item_checked(item_id, True)
        item = store._checklist_items.get(item_id)
        hass.bus.async_fire(EVENT_CHECKLIST_CHANGED, {"item_id": item_id, "leg_id": item.leg_id if item else None})

    async def handle_uncheck_item(call: ServiceCall) -> None:
        item_id = call.data["item_id"]
        await store.async_set_checklist_item_checked(item_id, False)
        item = store._checklist_items.get(item_id)
        hass.bus.async_fire(EVENT_CHECKLIST_CHANGED, {"item_id": item_id, "leg_id": item.leg_id if item else None})

    async def handle_add_checklist_item(call: ServiceCall) -> None:
        item = await store.async_add_checklist_item(
            leg_id=call.data["leg_id"],
            label=call.data["label"],
            due_offset_hours=call.data.get("due_offset_hours"),
        )
        hass.bus.async_fire(EVENT_CHECKLIST_CHANGED, {"item_id": item.id, "leg_id": item.leg_id})

    async def handle_set_leg_status(call: ServiceCall) -> None:
        leg_id = call.data["leg_id"]
        status = call.data["status"]
        await store.async_update_leg(leg_id, status=status)
        hass.bus.async_fire(EVENT_LEG_STATUS_CHANGED, {"leg_id": leg_id, "status": status})

    async def handle_add_reminder(call: ServiceCall) -> None:
        fire_at_str = call.data["fire_at"]
        fire_at = dt_util.parse_datetime(fire_at_str)
        if fire_at is None:
            _LOGGER.error("add_reminder: could not parse fire_at %r", fire_at_str)
            return
        if fire_at.tzinfo is None:
            fire_at = dt_util.as_utc(fire_at)
        reminder = await store.async_create_reminder(
            parent_type=call.data["parent_type"],
            parent_id=call.data["parent_id"],
            label=call.data["label"],
            fire_at=fire_at,
            event_data=call.data.get("event_data", {}),
        )
        scheduler.schedule_reminder(reminder)

    async def handle_delete_reminder(call: ServiceCall) -> None:
        rid = call.data["reminder_id"]
        scheduler.cancel_reminder(rid)
        await store.async_delete_reminder(rid)

    hass.services.async_register(DOMAIN, SERVICE_FIRE_REMINDER, handle_fire_reminder, schema=_SCHEMA_FIRE_REMINDER)
    hass.services.async_register(DOMAIN, SERVICE_CHECK_ITEM, handle_check_item, schema=_SCHEMA_CHECK_ITEM)
    hass.services.async_register(DOMAIN, SERVICE_UNCHECK_ITEM, handle_uncheck_item, schema=_SCHEMA_CHECK_ITEM)
    hass.services.async_register(DOMAIN, SERVICE_ADD_CHECKLIST_ITEM, handle_add_checklist_item, schema=_SCHEMA_ADD_CHECKLIST_ITEM)
    hass.services.async_register(DOMAIN, SERVICE_SET_LEG_STATUS, handle_set_leg_status, schema=_SCHEMA_SET_LEG_STATUS)
    hass.services.async_register(DOMAIN, SERVICE_ADD_REMINDER, handle_add_reminder, schema=_SCHEMA_ADD_REMINDER)
    hass.services.async_register(DOMAIN, SERVICE_DELETE_REMINDER, handle_delete_reminder, schema=_SCHEMA_DELETE_REMINDER)
