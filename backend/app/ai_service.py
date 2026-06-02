"""Сервис интеграции с внешней языковой моделью для AI-помощников."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error, request


DEFAULT_POLZA_API_BASE_URL = "https://polza.ai/api/v1"
DEFAULT_POLZA_MODEL = "openai/gpt-4o-mini"
DEFAULT_AI_TIMEOUT_SECONDS = 20


class AIServiceError(RuntimeError):
    """Базовая ошибка AI-сервиса."""


class AIConfigurationError(AIServiceError):
    """Ошибка конфигурации AI-сервиса."""


class AIResponseError(AIServiceError):
    """Ошибка ответа языковой модели."""


@dataclass(frozen=True)
class AISettings:
    """Настройки подключения к внешнему AI API."""

    enabled: bool
    api_key: str
    base_url: str
    model: str
    timeout_seconds: int


def env_flag(name: str, default: str = "false") -> bool:
    """Возвращает булевое значение переменной окружения."""
    return (os.getenv(name, default) or "").strip().lower() in {"1", "true", "yes", "on"}


def get_ai_settings() -> AISettings:
    """Возвращает настройки AI-интеграции из переменных окружения."""
    raw_timeout = os.getenv("AI_REQUEST_TIMEOUT_SECONDS", str(DEFAULT_AI_TIMEOUT_SECONDS))
    try:
        timeout_seconds = max(1, min(int(raw_timeout), 60))
    except ValueError:
        timeout_seconds = DEFAULT_AI_TIMEOUT_SECONDS

    return AISettings(
        enabled=env_flag("AI_FEATURES_ENABLED", "false"),
        api_key=(os.getenv("POLZA_API_KEY") or "").strip(),
        base_url=(os.getenv("POLZA_API_BASE_URL") or DEFAULT_POLZA_API_BASE_URL).strip().rstrip("/"),
        model=(os.getenv("POLZA_MODEL") or DEFAULT_POLZA_MODEL).strip(),
        timeout_seconds=timeout_seconds,
    )


def ai_is_ready() -> bool:
    """Проверяет, готова ли AI-интеграция принимать запросы."""
    settings = get_ai_settings()
    return settings.enabled and bool(settings.api_key) and bool(settings.model)


def ensure_ai_ready() -> AISettings:
    """Возвращает настройки или выбрасывает ошибку, если AI недоступен."""
    settings = get_ai_settings()
    if not settings.enabled:
        raise AIConfigurationError("AI-функции выключены на сервере.")
    if not settings.api_key:
        raise AIConfigurationError("AI API key не настроен на сервере.")
    if not settings.model:
        raise AIConfigurationError("AI model не настроена на сервере.")
    return settings


def extract_json_object(content: str) -> dict[str, Any]:
    """Извлекает JSON-объект из текстового ответа модели."""
    text = (content or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIResponseError("AI вернул ответ не в формате JSON.") from exc

    if not isinstance(payload, dict):
        raise AIResponseError("AI вернул JSON, но не объект.")
    return payload


def response_format_for_schema(name: str, schema: dict[str, Any] | None) -> dict[str, Any]:
    """Возвращает формат структурированного ответа для OpenAI-compatible API."""
    if not schema:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }


def call_chat_json(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    response_schema: dict[str, Any] | None = None,
    schema_name: str = "tramplin_ai_response",
) -> dict[str, Any]:
    """Отправляет запрос к Polza.ai/OpenAI-compatible API и возвращает JSON-объект."""
    settings = ensure_ai_ready()
    endpoint = f"{settings.base_url}/chat/completions"
    payload = {
        "model": settings.model,
        "messages": messages,
        "temperature": temperature,
        "response_format": response_format_for_schema(schema_name, response_schema),
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        endpoint,
        data=data,
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=settings.timeout_seconds) as response:
            raw_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AIServiceError(f"AI API вернул ошибку {exc.code}: {detail[:300]}") from exc
    except error.URLError as exc:
        raise AIServiceError("AI API временно недоступен.") from exc
    except TimeoutError as exc:
        raise AIServiceError("AI API не ответил за отведенное время.") from exc

    try:
        body = json.loads(raw_body)
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise AIResponseError("AI API вернул неожиданный формат ответа.") from exc

    return extract_json_object(content)
