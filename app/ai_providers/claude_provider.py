"""Claude (Anthropic) provider for Travel Assistant chat."""
from __future__ import annotations

import json
import logging

_LOGGER = logging.getLogger(__name__)

MODEL      = "claude-sonnet-4-6"
MAX_TOKENS = 4096


class ClaudeProvider:
    def __init__(self, api_key: str) -> None:
        import anthropic
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

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
                model=MODEL, max_tokens=MAX_TOKENS,
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
