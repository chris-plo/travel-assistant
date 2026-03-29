"""Gemini (Google) AI provider for Travel Assistant."""
from __future__ import annotations

import json
import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash"


class GeminiProvider:
    """Wraps the Google GenerativeAI client with google_search grounding and tool support."""

    def __init__(self, api_key: str) -> None:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._genai = genai

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
        import asyncio
        import google.generativeai as genai
        from google.generativeai.types import content_types

        # Build Gemini tool definitions
        function_declarations = [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }
            for t in tools
        ]

        gemini_tools = []
        if function_declarations:
            gemini_tools.append({"function_declarations": function_declarations})

        # Enable Google Search grounding
        gemini_tools.append({"google_search": {}})

        model = genai.GenerativeModel(
            model_name=MODEL,
            system_instruction=system_prompt,
            tools=gemini_tools,
        )

        # Convert message history to Gemini format
        history = []
        for msg in messages[:-1]:
            role = "user" if msg["role"] == "user" else "model"
            history.append({"role": role, "parts": [msg["content"]]})

        chat_session = model.start_chat(history=history)
        last_user_msg = messages[-1]["content"] if messages else ""

        tool_calls_executed: list[dict] = []
        sources: list[str] = []

        # Run in executor since google-generativeai is sync
        loop = asyncio.get_event_loop()

        for _iteration in range(10):
            response = await loop.run_in_executor(
                None, lambda: chat_session.send_message(last_user_msg)
            )

            reply_text = ""
            function_calls = []

            for part in response.parts:
                if hasattr(part, "text") and part.text:
                    reply_text += part.text
                if hasattr(part, "function_call") and part.function_call:
                    function_calls.append(part.function_call)

            # Extract grounding sources if present
            try:
                grounding_meta = response.candidates[0].grounding_metadata
                if grounding_meta and grounding_meta.grounding_chunks:
                    for chunk in grounding_meta.grounding_chunks:
                        if hasattr(chunk, "web") and chunk.web.uri:
                            sources.append(chunk.web.uri)
            except Exception:
                pass

            if not function_calls:
                return {
                    "reply": reply_text.strip(),
                    "sources": sources,
                    "tool_calls": tool_calls_executed,
                }

            # Process function calls
            function_responses = []
            for fc in function_calls:
                tool_calls_executed.append({"name": fc.name, "input": dict(fc.args)})
                function_responses.append(
                    genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=fc.name,
                            response={"result": "ok"},
                        )
                    )
                )
                last_user_msg = function_responses  # feed results back

        return {
            "reply": reply_text.strip(),
            "sources": sources,
            "tool_calls": tool_calls_executed,
        }
