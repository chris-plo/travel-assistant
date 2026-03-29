"""Config flow for Travel Assistant."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import config_validation as cv

from .const import (
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_NONE,
    CONF_AI_PROVIDER,
    CONF_ANTHROPIC_API_KEY,
    CONF_GOOGLE_API_KEY,
    DOMAIN,
)

_PROVIDER_OPTIONS = [AI_PROVIDER_CLAUDE, AI_PROVIDER_GEMINI, AI_PROVIDER_NONE]

_AI_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_AI_PROVIDER, default=AI_PROVIDER_CLAUDE): vol.In(_PROVIDER_OPTIONS),
        vol.Optional(CONF_ANTHROPIC_API_KEY, default=""): cv.string,
        vol.Optional(CONF_GOOGLE_API_KEY, default=""): cv.string,
    }
)


class TravelAssistantConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the config flow for Travel Assistant."""

    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """First step — just confirm setup."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return await self.async_step_ai_provider()

        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    async def async_step_ai_provider(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Second step — choose AI provider."""
        errors: dict[str, str] = {}

        if user_input is not None:
            provider = user_input.get(CONF_AI_PROVIDER, AI_PROVIDER_NONE)
            anthropic_key = user_input.get(CONF_ANTHROPIC_API_KEY, "").strip()
            google_key = user_input.get(CONF_GOOGLE_API_KEY, "").strip()

            if provider == AI_PROVIDER_CLAUDE and not anthropic_key:
                errors[CONF_ANTHROPIC_API_KEY] = "missing_api_key"
            elif provider == AI_PROVIDER_GEMINI and not google_key:
                errors[CONF_GOOGLE_API_KEY] = "missing_api_key"

            if not errors:
                self._data.update(user_input)
                return self.async_create_entry(title="Travel Assistant", data=self._data)

        return self.async_show_form(
            step_id="ai_provider",
            data_schema=_AI_SCHEMA,
            errors=errors,
        )
