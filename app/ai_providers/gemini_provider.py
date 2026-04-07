"""Gemini (Google) provider — uses google-genai SDK (Gemini 2.5+)."""
from __future__ import annotations

import logging

_LOGGER = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash"  # free tier; gemini-2.0-flash deprecated June 2026


class GeminiProvider:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        from google import genai
        self._client = genai.Client(api_key=api_key)
        self._model  = model or MODEL

    async def chat(self, system_prompt: str, messages: list[dict], tools: list[dict]) -> dict:
        from google.genai import types

        # Build conversation history (all turns except the final user message)
        contents: list = []
        for m in messages[:-1]:
            role = "user" if m["role"] == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part(text=m["content"])]))

        # Build tool list — Gemini API does not allow combining function declarations
        # and google_search grounding in the same request; use one or the other.
        tool_list = []
        if tools:
            tool_list.append(types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=t["name"],
                    description=t["description"],
                    parameters=t["parameters"],
                )
                for t in tools
            ]))
        else:
            tool_list.append(types.Tool(google_search=types.GoogleSearch()))

        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=tool_list,
        )

        last_msg: str | list = messages[-1]["content"] if messages else ""
        tool_calls_out: list[dict] = []
        sources:        list[str]  = []
        reply_text = ""

        for _ in range(10):
            if isinstance(last_msg, str):
                user_content = types.Content(role="user", parts=[types.Part(text=last_msg)])
            else:
                user_content = types.Content(role="user", parts=last_msg)

            send_contents = contents + [user_content]

            response = await self._client.aio.models.generate_content(
                model=self._model, contents=send_contents, config=config,
            )

            candidate = response.candidates[0]
            function_calls = []
            for part in candidate.content.parts:
                if part.text:
                    reply_text += part.text
                if part.function_call:
                    function_calls.append(part.function_call)

            # Extract grounding sources from Google Search
            try:
                meta = candidate.grounding_metadata
                if meta and meta.grounding_chunks:
                    for chunk in meta.grounding_chunks:
                        if hasattr(chunk, "web") and chunk.web.uri:
                            sources.append(chunk.web.uri)
            except Exception:
                pass

            if not function_calls:
                break

            # Extend history with model response, then build function responses
            contents = send_contents + [candidate.content]
            fn_parts = []
            for fc in function_calls:
                tool_calls_out.append({"name": fc.name, "input": dict(fc.args)})
                fn_parts.append(types.Part(
                    function_response=types.FunctionResponse(
                        name=fc.name, response={"result": "ok"},
                    )
                ))
            last_msg = fn_parts

        return {"reply": reply_text.strip(), "sources": sources, "tool_calls": tool_calls_out}

    async def extract(self, content_b64: str, mime_type: str, doc_type: str) -> dict:
        """Extract travel booking fields from a base64-encoded image or PDF."""
        import base64 as _b64
        import json as _json
        from google.genai import types

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
            "Extract ALL travel bookings from this document. "
            "Return ONLY a valid JSON array where each element has these fields "
            f"(omit fields not found): {fields_desc}. "
            "If only one booking, still return a single-element array. "
            "No markdown, no explanations, JSON only."
        )
        raw = _b64.b64decode(content_b64)
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=[
                types.Part(inline_data=types.Blob(mime_type=mime_type, data=raw)),
                types.Part(text=prompt),
            ],
        )
        text = response.text.strip() if response.text else ""
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json\n"):
                text = text[5:]
        try:
            result = _json.loads(text)
            return result if isinstance(result, list) else [result]
        except Exception:
            return []
