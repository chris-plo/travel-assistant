"""Home Assistant Supervisor API client."""
from __future__ import annotations

import logging
import os
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

HA_API_BASE = "http://supervisor/core/api"


def _token() -> str:
    return os.environ.get("SUPERVISOR_TOKEN", "")


async def fire_event(event_type: str, data: dict) -> None:
    """Fire a custom event on the HA bus."""
    url = f"{HA_API_BASE}/events/{event_type}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=data,
                headers={"Authorization": f"Bearer {_token()}"},
            ) as resp:
                if resp.status not in (200, 201):
                    _LOGGER.warning("fire_event %s → HTTP %s", event_type, resp.status)
    except Exception as exc:
        _LOGGER.error("fire_event failed: %s", exc)


async def push_sensor_state(entity_id: str, state: str, attributes: dict | None = None) -> None:
    """Push a sensor state to HA via REST API."""
    url = f"{HA_API_BASE}/states/{entity_id}"
    payload: dict[str, Any] = {"state": state, "attributes": attributes or {}}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {_token()}"},
            ) as resp:
                if resp.status not in (200, 201):
                    _LOGGER.warning("push_sensor %s → HTTP %s", entity_id, resp.status)
    except Exception as exc:
        _LOGGER.error("push_sensor failed: %s", exc)


async def create_calendar_event(
    entity_id: str,
    summary: str,
    start_dt: str,
    end_dt: str,
    description: str = "",
    location: str = "",
) -> bool:
    """Create an event on an HA calendar entity via the calendar.create_event service."""
    url = f"{HA_API_BASE}/services/calendar/create_event"
    payload: dict[str, Any] = {
        "entity_id": entity_id,
        "summary": summary,
        "start_date_time": start_dt,
        "end_date_time": end_dt,
    }
    if description:
        payload["description"] = description
    if location:
        payload["location"] = location
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {_token()}"},
            ) as resp:
                if resp.status not in (200, 201):
                    _LOGGER.warning("create_calendar_event → HTTP %s", resp.status)
                    return False
                return True
    except Exception as exc:
        _LOGGER.error("create_calendar_event failed: %s", exc)
        return False


async def list_calendar_events(entity_id: str, start_dt: str, end_dt: str) -> list[dict]:
    """List calendar events from an HA calendar entity within a time range."""
    url = f"{HA_API_BASE}/calendars/{entity_id}"
    params = {"start": start_dt, "end": end_dt}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url, params=params,
                headers={"Authorization": f"Bearer {_token()}"},
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                _LOGGER.warning("list_calendar_events → HTTP %s", resp.status)
                return []
    except Exception as exc:
        _LOGGER.error("list_calendar_events failed: %s", exc)
        return []


async def delete_calendar_event(entity_id: str, uid: str) -> bool:
    """Delete a calendar event by UID via calendar.delete_event service."""
    url = f"{HA_API_BASE}/services/calendar/delete_event"
    payload = {"entity_id": entity_id, "uid": uid}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url, json=payload,
                headers={"Authorization": f"Bearer {_token()}"},
            ) as resp:
                if resp.status not in (200, 201):
                    _LOGGER.warning("delete_calendar_event → HTTP %s", resp.status)
                    return False
                return True
    except Exception as exc:
        _LOGGER.error("delete_calendar_event failed: %s", exc)
        return False


async def get_entity_state(entity_id: str) -> dict | None:
    """Return the HA state dict for an entity, or None on error."""
    url = f"{HA_API_BASE}/states/{entity_id}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"Authorization": f"Bearer {_token()}"},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                _LOGGER.warning("get_entity_state %s → HTTP %s", entity_id, resp.status)
    except Exception as exc:
        _LOGGER.debug("get_entity_state failed: %s", exc)
    return None


async def create_persistent_notification(title: str, message: str, notification_id: str | None = None) -> None:
    """Create a persistent notification in the HA UI."""
    url = f"{HA_API_BASE}/services/persistent_notification/create"
    payload: dict[str, Any] = {"title": title, "message": message}
    if notification_id:
        payload["notification_id"] = notification_id
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {_token()}"},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status not in (200, 201):
                    _LOGGER.warning("create_persistent_notification → HTTP %s", resp.status)
    except Exception as exc:
        _LOGGER.error("create_persistent_notification failed: %s", exc)


async def push_all_sensors(store: Any) -> None:
    """Refresh all Travel Assistant sensor states in HA."""
    next_leg  = store.get_next_upcoming_leg()
    curr_leg  = store.get_current_active_leg()
    days      = store.get_days_until_next_departure()
    trips     = store.get_all_trips()

    # sensor.travel_next_leg
    if next_leg:
        items = store.get_checklist_items_for_leg(next_leg.id)
        await push_sensor_state(
            "sensor.travel_next_leg",
            f"{next_leg.origin} → {next_leg.destination}",
            {
                "leg_id": next_leg.id, "origin": next_leg.origin,
                "destination": next_leg.destination,
                "depart_at": next_leg.depart_at.isoformat(),
                "arrive_at": next_leg.arrive_at.isoformat() if next_leg.arrive_at else None,
                "carrier": next_leg.carrier, "flight_number": next_leg.flight_number,
                "status": next_leg.status,
                "checklist_total": len(items),
                "checklist_done": sum(1 for i in items if i.checked),
                "friendly_name": "Travel: Next Leg",
                "icon": "mdi:airplane-takeoff",
            },
        )
    else:
        await push_sensor_state("sensor.travel_next_leg", "None",
                                {"friendly_name": "Travel: Next Leg", "icon": "mdi:airplane-takeoff"})

    # sensor.travel_days_until_departure
    await push_sensor_state(
        "sensor.travel_days_until_departure",
        str(days) if days is not None else "unknown",
        {
            "unit_of_measurement": "d",
            "next_departure": next_leg.depart_at.isoformat() if next_leg else None,
            "friendly_name": "Travel: Days Until Departure",
            "icon": "mdi:calendar-clock",
        },
    )

    # sensor.travel_current_leg
    if curr_leg:
        items = store.get_checklist_items_for_leg(curr_leg.id)
        await push_sensor_state(
            "sensor.travel_current_leg",
            f"{curr_leg.origin} → {curr_leg.destination}",
            {
                "leg_id": curr_leg.id, "status": curr_leg.status,
                "checklist_total": len(items),
                "checklist_done": sum(1 for i in items if i.checked),
                "friendly_name": "Travel: Current Leg",
                "icon": "mdi:airplane",
            },
        )
    else:
        await push_sensor_state("sensor.travel_current_leg", "None",
                                {"friendly_name": "Travel: Current Leg", "icon": "mdi:airplane"})

    # sensor.travel_trip_progress
    if trips:
        active_trip = next(
            (t for t in trips if any(
                l.status in ("active", "upcoming")
                for l in store.get_legs_for_trip(t.id)
            )), trips[0]
        )
        legs    = store.get_legs_for_trip(active_trip.id)
        total   = len(legs)
        done    = sum(1 for l in legs if l.status == "completed")
        pct     = int((done / total) * 100) if total else 0
        await push_sensor_state(
            "sensor.travel_trip_progress",
            str(pct),
            {
                "unit_of_measurement": "%",
                "trip_name": active_trip.name,
                "total_legs": total, "completed_legs": done,
                "upcoming_legs": sum(1 for l in legs if l.status == "upcoming"),
                "friendly_name": "Travel: Trip Progress",
                "icon": "mdi:map-marker-path",
            },
        )
