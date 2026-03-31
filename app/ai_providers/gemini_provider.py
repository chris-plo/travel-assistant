"""Gemini (Google) provider for Travel Assistant chat."""
from __future__ import annotations

import logging

_LOGGER = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash"


class GeminiProvider:
    def __init__(self, api_key: str) -> None:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._genai = genai

    async def chat(self, system_prompt: str, messages: list[dict], tools: list[dict]) -> dict:
        import asyncio
        import google.generativeai as genai

        function_declarations = [
            {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}
            for t in tools
        ]
        gemini_tools = []
        if function_declarations:
            gemini_tools.append({"function_declarations": function_declarations})
        gemini_tools.append({"google_search": {}})

        model = genai.GenerativeModel(
            model_name=MODEL, system_instruction=system_prompt, tools=gemini_tools,
        )

        history = [
            {"role": "user" if m["role"] == "user" else "model", "parts": [m["content"]]}
            for m in messages[:-1]
        ]
        chat_session  = model.start_chat(history=history)
        last_msg      = messages[-1]["content"] if messages else ""
        tool_calls_out: list[dict] = []
        sources:        list[str]  = []
        loop          = asyncio.get_event_loop()
        reply_text    = ""

        for _ in range(10):
            response = await loop.run_in_executor(None, lambda: chat_session.send_message(last_msg))

            function_calls = []
            for part in response.parts:
                if hasattr(part, "text") and part.text:
                    reply_text += part.text
                if hasattr(part, "function_call") and part.function_call:
                    function_calls.append(part.function_call)

            try:
                meta = response.candidates[0].grounding_metadata
                if meta and meta.grounding_chunks:
                    for chunk in meta.grounding_chunks:
                        if hasattr(chunk, "web") and chunk.web.uri:
                            sources.append(chunk.web.uri)
            except Exception:
                pass

            if not function_calls:
                break

            function_responses = []
            for fc in function_calls:
                tool_calls_out.append({"name": fc.name, "input": dict(fc.args)})
                function_responses.append(
                    genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=fc.name, response={"result": "ok"},
                        )
                    )
                )
            last_msg = function_responses

        return {"reply": reply_text.strip(), "sources": sources, "tool_calls": tool_calls_out}

    async def extract(self, content_b64: str, mime_type: str, doc_type: str) -> dict:
        """Extract travel fields from a base64-encoded image or PDF using Gemini vision."""
        import asyncio, json as _json
        import google.generativeai as genai

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
        import base64 as _b64
        raw = _b64.b64decode(content_b64)
        blob = genai.types.BlobDict(mime_type=mime_type, data=raw)
        model = genai.GenerativeModel(model_name=MODEL)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: model.generate_content([blob, prompt]))
        text = response.text.strip() if hasattr(response, "text") else ""
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json\n"):
                text = text[5:]
        try:
            return _json.loads(text)
        except Exception:
            return {}
