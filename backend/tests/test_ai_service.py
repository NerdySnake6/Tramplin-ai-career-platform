"""Тесты низкоуровневого AI-клиента."""

import json

from app import ai_service


import httpx


class FakeResponse:
    """Минимальный класс для подмены httpx response."""

    def __init__(self, payload: dict, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self.payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("Error", request=None, response=self)


def test_call_chat_json_sends_model_and_token_limit(monkeypatch):
    """Проверяет модель, лимит ответа и устойчивость к отсутствию usage."""
    captured = {}
    monkeypatch.setenv("AI_FEATURES_ENABLED", "true")
    monkeypatch.setenv("POLZA_API_KEY", "test-key")
    monkeypatch.delenv("POLZA_MODEL", raising=False)
    monkeypatch.delenv("AI_MAX_OUTPUT_TOKENS", raising=False)

    async def fake_post(self_client, url, headers=None, **kwargs):
        captured["url"] = url
        captured["headers"] = headers
        captured["payload"] = kwargs.get("json")
        # Извлекаем таймаут из настроек AsyncClient
        captured["timeout"] = self_client.timeout.read
        return FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"ok": True}),
                        }
                    }
                ]
            }
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = ai_service.call_chat_json(
        [{"role": "user", "content": "test"}],
        schema_name="test_schema",
    )

    assert result == {"ok": True}
    assert captured["timeout"] == 20
    assert captured["payload"]["model"] == "openai/gpt-5.4-mini"
    assert captured["payload"]["max_tokens"] == 3000


def test_get_ai_settings_allows_env_token_limit(monkeypatch):
    """Проверяет переопределение лимита ответа через env."""
    monkeypatch.setenv("AI_FEATURES_ENABLED", "true")
    monkeypatch.setenv("POLZA_API_KEY", "test-key")
    monkeypatch.setenv("AI_MAX_OUTPUT_TOKENS", "4500")

    settings = ai_service.get_ai_settings()

    assert settings.max_output_tokens == 4500
