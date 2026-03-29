"""Travel Assistant Home Assistant Integration."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import ALL_SERVICES, DOMAIN
from .panel import async_setup_panel
from .reminders import ReminderScheduler
from .services import register_services
from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Travel Assistant from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # 1. Load persistent data
    store = TravelStore(hass)
    await store.async_load()

    # 2. Seed initial trip if no data exists
    if not store.get_all_trips():
        await _seed_initial_trip(store)

    # 3. Start reminder scheduler
    scheduler = ReminderScheduler(hass, store)
    await scheduler.async_schedule_all()

    # 4. Store runtime data on the entry
    entry.runtime_data = {"store": store, "scheduler": scheduler}

    # 5. Set up AI chat service
    from .chat import ChatService
    chat_service = ChatService(entry, store)
    entry.runtime_data["chat"] = chat_service

    # 6. Register REST API views
    from .views import register_views
    register_views(hass, store, scheduler, chat_service)

    # 7. Register HA services
    register_services(hass, store, scheduler)

    # 8. Forward setup to sensor platform
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # 9. Register sidebar panel
    await async_setup_panel(hass)

    _LOGGER.info("Travel Assistant integration set up successfully")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Travel Assistant config entry."""
    # Cancel all reminder timers
    entry.runtime_data["scheduler"].async_unload()

    # Unload sensor platform
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Deregister services
    for service in ALL_SERVICES:
        hass.services.async_remove(DOMAIN, service)

    hass.data.pop(DOMAIN, None)
    return unload_ok


async def _seed_initial_trip(store: TravelStore) -> None:
    """Pre-populate the Madrid→Bogotá→CDMX→…→Madrid itinerary."""
    from datetime import timezone
    import re

    trip = await store.async_create_trip(
        name="Madrid → Bogotá → CDMX → Veracruz → Acayucan → Guadalajara → CDMX → Bogotá → Madrid",
        description="Multi-city Latin America trip",
    )

    legs_data = [
        {
            "type": "flight",
            "origin": "MAD",
            "destination": "BOG",
            "depart_at": "2026-04-15T10:00:00+02:00",
            "arrive_at": "2026-04-15T16:30:00-05:00",
            "carrier": "Iberia / Avianca",
            "flight_number": "IB6801",
            "notes": "Madrid Barajas T4 → El Dorado",
        },
        {
            "type": "flight",
            "origin": "BOG",
            "destination": "MEX",
            "depart_at": "2026-04-18T07:00:00-05:00",
            "arrive_at": "2026-04-18T10:30:00-06:00",
            "carrier": "Avianca",
            "flight_number": "AV241",
            "notes": "El Dorado → AICM T1",
        },
        {
            "type": "bus",
            "origin": "CDMX",
            "destination": "Veracruz",
            "depart_at": "2026-04-21T08:00:00-06:00",
            "arrive_at": "2026-04-21T13:30:00-06:00",
            "carrier": "ADO",
            "notes": "TAPO bus terminal",
        },
        {
            "type": "bus",
            "origin": "Veracruz",
            "destination": "Acayucan",
            "depart_at": "2026-04-23T09:00:00-06:00",
            "arrive_at": "2026-04-23T12:00:00-06:00",
            "carrier": "ADO",
            "notes": "",
        },
        {
            "type": "bus",
            "origin": "Acayucan",
            "destination": "Guadalajara",
            "depart_at": "2026-04-25T18:00:00-06:00",
            "arrive_at": "2026-04-26T10:00:00-06:00",
            "carrier": "ADO",
            "notes": "Overnight bus",
        },
        {
            "type": "flight",
            "origin": "GDL",
            "destination": "MEX",
            "depart_at": "2026-04-29T12:00:00-06:00",
            "arrive_at": "2026-04-29T13:15:00-06:00",
            "carrier": "Aeromexico",
            "flight_number": "AM142",
            "notes": "Guadalajara → AICM T2",
        },
        {
            "type": "flight",
            "origin": "MEX",
            "destination": "BOG",
            "depart_at": "2026-05-02T08:00:00-06:00",
            "arrive_at": "2026-05-02T13:30:00-05:00",
            "carrier": "Avianca",
            "flight_number": "AV242",
            "notes": "AICM T1 → El Dorado",
        },
        {
            "type": "flight",
            "origin": "BOG",
            "destination": "MAD",
            "depart_at": "2026-05-05T23:00:00-05:00",
            "arrive_at": "2026-05-06T15:00:00+02:00",
            "carrier": "Iberia / Avianca",
            "flight_number": "IB6802",
            "notes": "El Dorado → Madrid Barajas T4",
        },
    ]

    default_flight_checklist = [
        "Check in online (24h before)",
        "Print / download boarding pass",
        "Confirm passport is valid",
        "Pack carry-on bag",
        "Charge phone & power bank",
        "Arrive at airport 2h before departure",
    ]

    default_bus_checklist = [
        "Book bus ticket",
        "Pack bags",
        "Confirm departure terminal",
        "Arrive at terminal 30 min early",
    ]

    for i, data in enumerate(legs_data):
        from datetime import datetime as _dt
        data["depart_at"] = _dt.fromisoformat(data["depart_at"])
        if data.get("arrive_at"):
            data["arrive_at"] = _dt.fromisoformat(data["arrive_at"])
        data["sequence"] = i

        leg = await store.async_create_leg(trip_id=trip.id, **data)

        checklist = default_flight_checklist if data["type"] == "flight" else default_bus_checklist
        for label in checklist:
            await store.async_add_checklist_item(leg.id, label)

    _LOGGER.info("Seeded initial Madrid→…→Madrid trip with %d legs", len(legs_data))
