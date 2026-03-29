"""Sensor entities for Travel Assistant."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    ATTR_ARRIVE_AT,
    ATTR_CARRIER,
    ATTR_CHECKLIST_DONE,
    ATTR_CHECKLIST_TOTAL,
    ATTR_COMPLETED_LEGS,
    ATTR_DEPART_AT,
    ATTR_DESTINATION,
    ATTR_FLIGHT_NUMBER,
    ATTR_LEG_ID,
    ATTR_ORIGIN,
    ATTR_STATUS,
    ATTR_TOTAL_LEGS,
    ATTR_TRIP_ID,
    ATTR_TRIP_NAME,
    ATTR_UPCOMING_LEGS,
    DOMAIN,
    EVENT_CHECKLIST_CHANGED,
    EVENT_LEG_STATUS_CHANGED,
    SENSOR_CURRENT_LEG,
    SENSOR_DAYS_UNTIL_DEPARTURE,
    SENSOR_NEXT_LEG,
    SENSOR_TRIP_PROGRESS,
)
from .store import TravelStore

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Travel Assistant sensor entities."""
    store: TravelStore = entry.runtime_data["store"]
    entities = [
        TravelNextLegSensor(store),
        TravelDaysUntilDepartureSensor(store),
        TravelCurrentLegSensor(store),
        TravelTripProgressSensor(store),
    ]
    async_add_entities(entities, True)


class _TravelBaseSensor(RestoreEntity, SensorEntity):
    """Base class for Travel Assistant sensors."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, store: TravelStore) -> None:
        self._store = store

    async def async_added_to_hass(self) -> None:
        """Subscribe to store change events."""
        await super().async_added_to_hass()

        @callback
        def _handle_change(_event: Any) -> None:
            self.async_write_ha_state()

        self.async_on_remove(
            self.hass.bus.async_listen(EVENT_CHECKLIST_CHANGED, _handle_change)
        )
        self.async_on_remove(
            self.hass.bus.async_listen(EVENT_LEG_STATUS_CHANGED, _handle_change)
        )


class TravelNextLegSensor(_TravelBaseSensor):
    """Shows the next upcoming travel leg."""

    _attr_unique_id = SENSOR_NEXT_LEG
    _attr_name = "Next Leg"
    _attr_icon = "mdi:airplane-takeoff"

    def update(self) -> None:
        leg = self._store.get_next_upcoming_leg()
        if leg is None:
            self._attr_native_value = "None"
            self._attr_extra_state_attributes = {}
            return

        items = self._store.get_checklist_items_for_leg(leg.id)
        self._attr_native_value = f"{leg.origin} → {leg.destination}"
        self._attr_extra_state_attributes = {
            ATTR_LEG_ID: leg.id,
            ATTR_ORIGIN: leg.origin,
            ATTR_DESTINATION: leg.destination,
            ATTR_DEPART_AT: leg.depart_at.isoformat(),
            ATTR_ARRIVE_AT: leg.arrive_at.isoformat() if leg.arrive_at else None,
            ATTR_CARRIER: leg.carrier,
            ATTR_FLIGHT_NUMBER: leg.flight_number,
            ATTR_STATUS: leg.status,
            ATTR_CHECKLIST_TOTAL: len(items),
            ATTR_CHECKLIST_DONE: sum(1 for i in items if i.checked),
        }


class TravelDaysUntilDepartureSensor(_TravelBaseSensor):
    """Shows days until the next departure."""

    _attr_unique_id = SENSOR_DAYS_UNTIL_DEPARTURE
    _attr_name = "Days Until Departure"
    _attr_icon = "mdi:calendar-clock"
    _attr_native_unit_of_measurement = "d"

    def update(self) -> None:
        days = self._store.get_days_until_next_departure()
        self._attr_native_value = days
        leg = self._store.get_next_upcoming_leg()
        if leg:
            self._attr_extra_state_attributes = {
                "next_departure": leg.depart_at.isoformat(),
                ATTR_LEG_ID: leg.id,
            }
        else:
            self._attr_extra_state_attributes = {}


class TravelCurrentLegSensor(_TravelBaseSensor):
    """Shows the currently active travel leg."""

    _attr_unique_id = SENSOR_CURRENT_LEG
    _attr_name = "Current Leg"
    _attr_icon = "mdi:airplane"

    def update(self) -> None:
        leg = self._store.get_current_active_leg()
        if leg is None:
            self._attr_native_value = "None"
            self._attr_extra_state_attributes = {}
            return

        items = self._store.get_checklist_items_for_leg(leg.id)
        self._attr_native_value = f"{leg.origin} → {leg.destination}"
        self._attr_extra_state_attributes = {
            ATTR_LEG_ID: leg.id,
            ATTR_ORIGIN: leg.origin,
            ATTR_DESTINATION: leg.destination,
            ATTR_DEPART_AT: leg.depart_at.isoformat(),
            ATTR_ARRIVE_AT: leg.arrive_at.isoformat() if leg.arrive_at else None,
            ATTR_CARRIER: leg.carrier,
            ATTR_FLIGHT_NUMBER: leg.flight_number,
            ATTR_STATUS: leg.status,
            ATTR_CHECKLIST_TOTAL: len(items),
            ATTR_CHECKLIST_DONE: sum(1 for i in items if i.checked),
        }


class TravelTripProgressSensor(_TravelBaseSensor):
    """Shows the progress of the current trip as a percentage."""

    _attr_unique_id = SENSOR_TRIP_PROGRESS
    _attr_name = "Trip Progress"
    _attr_icon = "mdi:map-marker-path"
    _attr_native_unit_of_measurement = "%"

    def update(self) -> None:
        trips = self._store.get_all_trips()
        if not trips:
            self._attr_native_value = 0
            self._attr_extra_state_attributes = {}
            return

        # Use the first trip that has active or upcoming legs
        active_trip = None
        for trip in trips:
            legs = self._store.get_legs_for_trip(trip.id)
            if any(l.status in ("active", "upcoming") for l in legs):
                active_trip = trip
                break

        if active_trip is None:
            active_trip = trips[0]

        legs = self._store.get_legs_for_trip(active_trip.id)
        total = len(legs)
        completed = sum(1 for l in legs if l.status == "completed")
        upcoming = sum(1 for l in legs if l.status == "upcoming")
        pct = int((completed / total) * 100) if total > 0 else 0

        self._attr_native_value = pct
        self._attr_extra_state_attributes = {
            ATTR_TRIP_ID: active_trip.id,
            ATTR_TRIP_NAME: active_trip.name,
            ATTR_TOTAL_LEGS: total,
            ATTR_COMPLETED_LEGS: completed,
            ATTR_UPCOMING_LEGS: upcoming,
        }
