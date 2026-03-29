"""Claude (Anthropic) AI provider for Travel Assistant."""
from __future__ import annotations

import json
import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096


class ClaudeProvider:
    """Wraps the Anthropic async client with web_search and itinerary tool support."""

    def __init__(self, api_key: str) -> None:
        import anthropic
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],
    ) -> dict:
        """
        Send a chat request.

        Returns:
            {
                "reply": str,
                "sources": list[str],
                "tool_calls": list[{"name": str, "input": dict}],
            }
        """
        import anthropic

        # Build Anthropic tool definitions
        anthropic_tools = [
            {
                "type": "web_search_20250305",
                "name": "web_search",
            }
        ] + [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            }
            for t in tools
        ]

        msg_history = list(messages)
        tool_calls_executed: list[dict] = []
        sources: list[str] = []
        reply_text = ""

        # Agentic loop — keep going until model stops calling tools
        for _iteration in range(10):
            response = await self._client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                messages=msg_history,
                tools=anthropic_tools,
            )

            # Collect text and tool uses from response
            tool_uses = []
            for block in response.content:
                if block.type == "text":
                    reply_text += block.text
                elif block.type == "tool_use":
                    tool_uses.append(block)
                elif block.type == "tool_result":
                    pass

            if response.stop_reason == "end_turn" or not tool_uses:
                break

            # Append assistant message
            msg_history.append({"role": "assistant", "content": response.content})

            # Process each tool use
            tool_results = []
            for tu in tool_uses:
                if tu.name == "web_search":
                    # web_search results come back as content blocks from Anthropic
                    # They are already handled server-side; collect source URLs if present
                    result_content = getattr(tu, "result", None)
                    if result_content:
                        for item in result_content:
                            if hasattr(item, "url"):
                                sources.append(item.url)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": json.dumps(result_content) if result_content else "{}",
                    })
                else:
                    # Itinerary editing tool — caller will handle
                    tool_calls_executed.append({"name": tu.name, "input": tu.input, "id": tu.id})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": json.dumps({"status": "ok"}),
                    })

            msg_history.append({"role": "user", "content": tool_results})

        return {
            "reply": reply_text.strip(),
            "sources": sources,
            "tool_calls": tool_calls_executed,
        }
