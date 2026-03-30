"""Create an empty default trip on first start if no trips exist."""
from __future__ import annotations

import logging

from .store import TravelStore

_LOGGER = logging.getLogger(__name__)


async def seed_initial_trip(store: TravelStore) -> None:
    if store.get_all_trips():
        return  # Already has data — nothing to do

    await store.async_create_trip(
        name="My Trip",
        description="Add your legs, checklists, and documents from the Travel panel.",
    )

    _LOGGER.info("Created default empty trip")
