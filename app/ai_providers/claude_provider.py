"""Claude (Anthropic) provider for Travel Assistant chat."""
from __future__ import annotations

import json
import logging

_LOGGER = logging.getLogger(__name__)

MODEL      = "claude-sonnet-4-6"
MAX_TOKENS = 4096


class ClaudeProvider:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        import anthropic
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model  = model or MODEL

    async def chat(self, system_prompt: str, messages: list[dict], tools: list[dict]) -> dict:
        import anthropic

        anthropic_tools = [{"type": "web_search_20250305", "name": "web_search"}] + [
            {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
            for t in tools
        ]

        msg_history        = list(messages)
        tool_calls_out:    list[dict] = []
        sources:           list[str]  = []
        reply_text         = ""

        for _ in range(10):
            response = await self._client.messages.create(
                model=self._model, max_tokens=MAX_TOKENS,
                system=system_prompt, messages=msg_history, tools=anthropic_tools,
            )

            tool_uses = []
            for block in response.content:
                if block.type == "text":
                    reply_text += block.text
                elif block.type == "tool_use":
                    tool_uses.append(block)

            if response.stop_reason == "end_turn" or not tool_uses:
                break

            msg_history.append({"role": "assistant", "content": response.content})

            tool_results = []
            for tu in tool_uses:
                if tu.name == "web_search":
                    result_content = getattr(tu, "result", None)
                    if result_content:
                        for item in result_content:
                            if hasattr(item, "url"):
                                sources.append(item.url)
                    tool_results.append({
                        "type": "tool_result", "tool_use_id": tu.id,
                        "content": json.dumps(result_content) if result_content else "{}",
                    })
                else:
                    tool_calls_out.append({"name": tu.name, "input": tu.input, "id": tu.id})
                    tool_results.append({
                        "type": "tool_result", "tool_use_id": tu.id,
                        "content": json.dumps({"status": "ok"}),
                    })

            msg_history.append({"role": "user", "content": tool_results})

        return {"reply": reply_text.strip(), "sources": sources, "tool_calls": tool_calls_out}

    async def extract(self, content_b64: str, mime_type: str, doc_type: str) -> dict:
        """Extract travel fields from a base64-encoded image or PDF using vision."""
        import json as _json

        if doc_type == "stay":
            fields_desc = (
                "name (hotel/property name), location (city/area), check_in (YYYY-MM-DDTHH:MM), "
                "check_out (YYYY-MM-DDTHH:MM), timezone (IANA e.g. Europe/Paris), "
                "address, confirmation_number"
            )
        else:
            fields_desc = (
                "type (flight/train/bus/ferry/car/other), origin (city or airport code), "
                "destination (city or airport code), "
                "depart_at (YYYY-MM-DDTHH:MM local time), depart_timezone (IANA e.g. Europe/Madrid), "
                "arrive_at (YYYY-MM-DDTHH:MM local time), arrive_timezone (IANA e.g. America/Bogota), "
                "carrier (airline/company name), flight_number (or train/bus number), "
                "seats (e.g. '23A, 23B'), confirmation_number"
            )
        prompt = (
            f"Extract travel booking information from this document. "
            f"Return ONLY a valid JSON object with these fields (omit fields not found): {fields_desc}. "
            f"Do not include markdown, explanations, or any text outside the JSON object."
        )
        response = await self._client.messages.create(
            model=self._model, max_tokens=1024,
            messages=[{"role": "user", "content": [
                {
                    "type": "document" if mime_type == "application/pdf" else "image",
                    "source": {"type": "base64", "media_type": mime_type, "data": content_b64},
                },
                {"type": "text", "text": prompt},
            ]}],
        )
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json\n"):
                text = text[5:]
        try:
            return _json.loads(text)
        except Exception:
            return {}
