"""Unit tests for app/ai_providers/gemini_provider.py

The google-genai SDK requires native crypto libs unavailable in the test
environment, so we stub the entire google.genai namespace via sys.modules
before importing the provider module.
"""
from __future__ import annotations

import base64
import json
import sys
import os
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Stub google.genai before any provider import
# ---------------------------------------------------------------------------

_mock_types = MagicMock()

# Make types.Content, types.Part, etc. return real instances we can inspect
class _Content:
    def __init__(self, role, parts): self.role = role; self.parts = parts
class _Part:
    def __init__(self, text=None, inline_data=None, function_response=None):
        self.text = text; self.inline_data = inline_data; self.function_response = function_response
    function_call = None
class _Blob:
    def __init__(self, mime_type, data): self.mime_type = mime_type; self.data = data
class _Tool:
    def __init__(self, function_declarations=None, google_search=None):
        self.function_declarations = function_declarations; self.google_search = google_search
class _FunctionDeclaration:
    def __init__(self, name, description, parameters=None):
        self.name = name; self.description = description; self.parameters = parameters
class _GoogleSearch: pass
class _FunctionResponse:
    def __init__(self, name, response): self.name = name; self.response = response
class _GenerateContentConfig:
    def __init__(self, system_instruction=None, tools=None):
        self.system_instruction = system_instruction; self.tools = tools or []

_mock_types.Content         = _Content
_mock_types.Part            = _Part
_mock_types.Blob            = _Blob
_mock_types.Tool            = _Tool
_mock_types.FunctionDeclaration = _FunctionDeclaration
_mock_types.GoogleSearch    = _GoogleSearch
_mock_types.FunctionResponse = _FunctionResponse
_mock_types.GenerateContentConfig = _GenerateContentConfig

_mock_genai          = MagicMock()
_mock_google         = MagicMock()
_mock_google.genai   = _mock_genai
_mock_genai.Client   = MagicMock()
# Wire types as attribute so `from google.genai import types` resolves correctly
_mock_genai.types    = _mock_types

sys.modules.setdefault("google",             _mock_google)
sys.modules.setdefault("google.genai",       _mock_genai)
sys.modules.setdefault("google.genai.types", _mock_types)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import after stubs are in place
from app.ai_providers.gemini_provider import GeminiProvider, MODEL  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fc(name, args):
    fc = MagicMock(); fc.name = name; fc.args = args
    return fc

def _make_part_text(text):
    p = _Part(text=text); p.function_call = None
    return p

def _make_part_fc(fc):
    p = _Part(); p.function_call = fc; p.text = None
    return p

def _make_chunk(uri):
    chunk = MagicMock(); chunk.web.uri = uri
    return chunk

def _make_response(parts, grounding_chunks=None):
    candidate       = MagicMock()
    candidate.content.parts = parts
    meta            = MagicMock()
    meta.grounding_chunks = grounding_chunks or []
    candidate.grounding_metadata = meta
    resp            = MagicMock()
    resp.candidates = [candidate]
    return resp

def _make_provider():
    mock_client = MagicMock()
    _mock_genai.Client.return_value = mock_client
    p = GeminiProvider(api_key="test-key")
    return p, mock_client

TOOLS = [{"name": "create_leg", "description": "Add a leg",
          "parameters": {"type": "object", "properties": {}}}]
SYSTEM  = "You are a travel assistant."
MESSAGES = [{"role": "user", "content": "Hello"}]


# ---------------------------------------------------------------------------
# chat() — plain text
# ---------------------------------------------------------------------------

class TestChatPlainText:
    @pytest.mark.asyncio
    async def test_returns_reply_text(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("Hello back!")])
        )
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert result["reply"] == "Hello back!"
        assert result["tool_calls"] == []
        assert result["sources"] == []

    @pytest.mark.asyncio
    async def test_concatenates_multiple_text_parts(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("Hello "), _make_part_text("world!")])
        )
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert result["reply"] == "Hello world!"

    @pytest.mark.asyncio
    async def test_strips_whitespace_from_reply(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("  hi  ")])
        )
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert result["reply"] == "hi"


# ---------------------------------------------------------------------------
# chat() — tool calls
# ---------------------------------------------------------------------------

class TestChatToolCalls:
    @pytest.mark.asyncio
    async def test_tool_call_returned_in_result(self):
        prov, client = _make_provider()
        fc = _make_fc("create_leg", {"origin": "MAD", "destination": "MEX"})
        client.aio.models.generate_content = AsyncMock(side_effect=[
            _make_response([_make_part_fc(fc)]),
            _make_response([_make_part_text("Done!")]),
        ])
        result = await prov.chat(SYSTEM, MESSAGES, TOOLS)
        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["name"] == "create_leg"
        assert result["tool_calls"][0]["input"] == {"origin": "MAD", "destination": "MEX"}
        assert result["reply"] == "Done!"

    @pytest.mark.asyncio
    async def test_stops_after_no_function_calls(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("No tools needed")])
        )
        result = await prov.chat(SYSTEM, MESSAGES, TOOLS)
        assert client.aio.models.generate_content.call_count == 1
        assert result["tool_calls"] == []

    @pytest.mark.asyncio
    async def test_generate_content_called_with_correct_model(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("ok")])
        )
        await prov.chat(SYSTEM, MESSAGES, [])
        kwargs = client.aio.models.generate_content.call_args.kwargs
        assert kwargs["model"] == prov._model


# ---------------------------------------------------------------------------
# chat() — grounding sources
# ---------------------------------------------------------------------------

class TestChatGrounding:
    @pytest.mark.asyncio
    async def test_extracts_grounding_sources(self):
        prov, client = _make_provider()
        chunks = [_make_chunk("https://example.com"), _make_chunk("https://news.com")]
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("Info")], grounding_chunks=chunks)
        )
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert "https://example.com" in result["sources"]
        assert "https://news.com" in result["sources"]

    @pytest.mark.asyncio
    async def test_no_sources_when_no_grounding(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("ok")])
        )
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert result["sources"] == []

    @pytest.mark.asyncio
    async def test_grounding_exception_does_not_crash(self):
        prov, client = _make_provider()
        candidate = MagicMock()
        candidate.content.parts = [_make_part_text("ok")]
        candidate.grounding_metadata = None          # accessing .grounding_chunks will fail
        resp = MagicMock(); resp.candidates = [candidate]
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.chat(SYSTEM, MESSAGES, [])
        assert result["reply"] == "ok"


# ---------------------------------------------------------------------------
# chat() — tool list structure
# ---------------------------------------------------------------------------

class TestChatToolConfig:
    @pytest.mark.asyncio
    async def test_google_search_tool_always_added(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("ok")])
        )
        await prov.chat(SYSTEM, MESSAGES, [])
        config = client.aio.models.generate_content.call_args.kwargs["config"]
        assert any(isinstance(t, _Tool) and t.google_search is not None for t in config.tools)

    @pytest.mark.asyncio
    async def test_function_declarations_included_when_tools_provided(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("ok")])
        )
        await prov.chat(SYSTEM, MESSAGES, TOOLS)
        config = client.aio.models.generate_content.call_args.kwargs["config"]
        fn_tool = next((t for t in config.tools if t.function_declarations), None)
        assert fn_tool is not None
        assert fn_tool.function_declarations[0].name == "create_leg"

    @pytest.mark.asyncio
    async def test_no_function_tool_when_tools_empty(self):
        prov, client = _make_provider()
        client.aio.models.generate_content = AsyncMock(
            return_value=_make_response([_make_part_text("ok")])
        )
        await prov.chat(SYSTEM, MESSAGES, [])
        config = client.aio.models.generate_content.call_args.kwargs["config"]
        fn_tool = next((t for t in config.tools if t.function_declarations), None)
        assert fn_tool is None


# ---------------------------------------------------------------------------
# extract()
# ---------------------------------------------------------------------------

def _b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()

class TestExtract:
    @pytest.mark.asyncio
    async def test_parses_json_array(self):
        prov, client = _make_provider()
        payload = [{"origin": "MAD", "destination": "MEX", "type": "flight"}]
        resp = MagicMock(); resp.text = json.dumps(payload)
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.extract(_b64("fake pdf"), "application/pdf", "leg")
        assert result == payload

    @pytest.mark.asyncio
    async def test_wraps_single_object_in_list(self):
        prov, client = _make_provider()
        payload = {"name": "Hotel ABC", "location": "Paris"}
        resp = MagicMock(); resp.text = json.dumps(payload)
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.extract(_b64("fake"), "image/jpeg", "stay")
        assert result == [payload]

    @pytest.mark.asyncio
    async def test_strips_markdown_fences(self):
        prov, client = _make_provider()
        payload = [{"origin": "BCN"}]
        resp = MagicMock(); resp.text = f"```json\n{json.dumps(payload)}\n```"
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.extract(_b64("fake"), "image/png", "leg")
        assert result == payload

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_invalid_json(self):
        prov, client = _make_provider()
        resp = MagicMock(); resp.text = "sorry, cannot extract"
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.extract(_b64("fake"), "image/jpeg", "leg")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_text(self):
        prov, client = _make_provider()
        resp = MagicMock(); resp.text = None
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        result = await prov.extract(_b64("fake"), "image/jpeg", "leg")
        assert result == []

    @pytest.mark.asyncio
    async def test_uses_correct_model(self):
        prov, client = _make_provider()
        resp = MagicMock(); resp.text = "[]"
        client.aio.models.generate_content = AsyncMock(return_value=resp)
        await prov.extract(_b64("fake"), "image/jpeg", "leg")
        kwargs = client.aio.models.generate_content.call_args.kwargs
        assert kwargs["model"] == prov._model


# ---------------------------------------------------------------------------
# Model configuration
# ---------------------------------------------------------------------------

class TestModelConfig:
    def test_default_model(self):
        prov, _ = _make_provider()
        assert prov._model == MODEL

    def test_custom_model(self):
        mock_client = MagicMock()
        _mock_genai.Client.return_value = mock_client
        prov = GeminiProvider(api_key="key", model="gemini-3-flash")
        assert prov._model == "gemini-3-flash"
