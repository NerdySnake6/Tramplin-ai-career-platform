"""Тесты низкоуровневого AI-клиента."""

import json

from app import ai_service


class FakeResponse:
    """Минимальный context manager для подмены urllib response."""

    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        """Возвращает response-объект."""
        return self

    def __exit__(self, *_args):
        """Закрывает fake response без дополнительных действий."""
        return False

    def read(self):
        """Возвращает JSON-ответ модели байтами."""
        return json.dumps(self.payload).encode("utf-8")


def test_call_chat_json_sends_model_and_token_limit(monkeypatch):
    """Проверяет модель, лимит ответа и устойчивость к отсутствию usage."""
    captured = {}
    monkeypatch.setenv("AI_FEATURES_ENABLED", "true")
    monkeypatch.setenv("POLZA_API_KEY", "test-key")
    monkeypatch.delenv("POLZA_MODEL", raising=False)
    monkeypatch.delenv("AI_MAX_OUTPUT_TOKENS", raising=False)

    def fake_urlopen(req, timeout):
        captured["timeout"] = timeout
        captured["payload"] = json.loads(req.data.decode("utf-8"))
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

    monkeypatch.setattr(ai_service.request, "urlopen", fake_urlopen)

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
