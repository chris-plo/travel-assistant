"""Seed the initial Madrid→…→Madrid itinerary."""
from __future__ import annotations

import logging
from datetime import datetime

from .store import TravelStore

_LOGGER = logging.getLogger(__name__)

_LEGS = [
    {"type": "flight",  "origin": "MAD", "destination": "BOG",
     "depart_at": "2026-04-15T10:00:00+02:00", "arrive_at": "2026-04-15T16:30:00-05:00",
     "carrier": "Iberia / Avianca", "flight_number": "IB6801",
     "notes": "Madrid Barajas T4 → El Dorado"},
    {"type": "flight",  "origin": "BOG", "destination": "MEX",
     "depart_at": "2026-04-18T07:00:00-05:00", "arrive_at": "2026-04-18T10:30:00-06:00",
     "carrier": "Avianca", "flight_number": "AV241",
     "notes": "El Dorado → AICM T1"},
    {"type": "bus",     "origin": "CDMX", "destination": "Veracruz",
     "depart_at": "2026-04-21T08:00:00-06:00", "arrive_at": "2026-04-21T13:30:00-06:00",
     "carrier": "ADO", "notes": "TAPO bus terminal"},
    {"type": "bus",     "origin": "Veracruz", "destination": "Acayucan",
     "depart_at": "2026-04-23T09:00:00-06:00", "arrive_at": "2026-04-23T12:00:00-06:00",
     "carrier": "ADO", "notes": ""},
    {"type": "bus",     "origin": "Acayucan", "destination": "Guadalajara",
     "depart_at": "2026-04-25T18:00:00-06:00", "arrive_at": "2026-04-26T10:00:00-06:00",
     "carrier": "ADO", "notes": "Overnight bus"},
    {"type": "flight",  "origin": "GDL", "destination": "MEX",
     "depart_at": "2026-04-29T12:00:00-06:00", "arrive_at": "2026-04-29T13:15:00-06:00",
     "carrier": "Aeromexico", "flight_number": "AM142",
     "notes": "Guadalajara → AICM T2"},
    {"type": "flight",  "origin": "MEX", "destination": "BOG",
     "depart_at": "2026-05-02T08:00:00-06:00", "arrive_at": "2026-05-02T13:30:00-05:00",
     "carrier": "Avianca", "flight_number": "AV242",
     "notes": "AICM T1 → El Dorado"},
    {"type": "flight",  "origin": "BOG", "destination": "MAD",
     "depart_at": "2026-05-05T23:00:00-05:00", "arrive_at": "2026-05-06T15:00:00+02:00",
     "carrier": "Iberia / Avianca", "flight_number": "IB6802",
     "notes": "El Dorado → Madrid Barajas T4"},
]

_FLIGHT_CHECKLIST = [
    "Check in online (24h before)",
    "Print / download boarding pass",
    "Confirm passport is valid",
    "Pack carry-on bag",
    "Charge phone & power bank",
    "Arrive at airport 2h before departure",
]

_BUS_CHECKLIST = [
    "Book bus ticket",
    "Pack bags",
    "Confirm departure terminal",
    "Arrive at terminal 30 min early",
]


async def seed_initial_trip(store: TravelStore) -> None:
    if store.get_all_trips():
        return  # Already seeded

    trip = await store.async_create_trip(
        name="Madrid → Bogotá → CDMX → Veracruz → Acayucan → Guadalajara → CDMX → Bogotá → Madrid",
        description="Multi-city Latin America trip",
    )

    for i, data in enumerate(_LEGS):
        leg_data = dict(data)
        leg_data["depart_at"] = datetime.fromisoformat(leg_data["depart_at"])
        if leg_data.get("arrive_at"):
            leg_data["arrive_at"] = datetime.fromisoformat(leg_data["arrive_at"])
        leg_data["sequence"] = i
        leg = await store.async_create_leg(trip_id=trip.id, **leg_data)
        checklist = _FLIGHT_CHECKLIST if leg_data["type"] == "flight" else _BUS_CHECKLIST
        for label in checklist:
            await store.async_add_checklist_item(leg.id, label)

    _LOGGER.info("Seeded initial trip with %d legs", len(_LEGS))
