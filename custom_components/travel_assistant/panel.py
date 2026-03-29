"""Register the Travel Assistant custom panel."""
from __future__ import annotations

import logging

from homeassistant.components.panel_custom import async_register_panel
from homeassistant.core import HomeAssistant

from .const import PANEL_COMPONENT_NAME, PANEL_ICON, PANEL_MODULE_URL, PANEL_TITLE, PANEL_URL

_LOGGER = logging.getLogger(__name__)


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the Travel Assistant sidebar panel."""
    await async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_COMPONENT_NAME,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=PANEL_MODULE_URL,
        require_admin=False,
        config={},
    )
    _LOGGER.debug("Travel Assistant panel registered at /%s", PANEL_URL)
