"""Утилиты нормализации текстового поля зарплаты без изменения схемы БД."""

from __future__ import annotations

import re
from dataclasses import dataclass


UNPAID_MARKERS = (
    "без оплаты",
    "не оплач",
    "неоплач",
    "unpaid",
    "волонтер",
    "без вознаграждения",
)
MAX_REASONABLE_REWARD = 3_000_000
NUMBER_TOKEN_PATTERN = re.compile(r"\d+(?:[\s.,\u00a0\u202f]\d+)*")
NUMBER_SEPARATOR_PATTERN = re.compile(r"[\s.,\u00a0\u202f]+")


@dataclass(frozen=True)
class SalaryInfo:
    """Нормализованное представление текстовой зарплаты."""

    min_value: int | None
    max_value: int | None
    is_paid: bool


def _extract_salary_number_strings(value: str) -> list[str]:
    """Возвращает числовые токены зарплаты без разделителей тысяч."""
    return [
        normalized
        for token in NUMBER_TOKEN_PATTERN.findall(value)
        if (normalized := NUMBER_SEPARATOR_PATTERN.sub("", token))
    ]


def _extract_salary_numbers(value: str) -> list[int]:
    """Возвращает числовые значения зарплаты из текста."""
    return [int(item) for item in _extract_salary_number_strings(value)]


def parse_salary_range(value: str | None) -> SalaryInfo:
    """Извлекает диапазон и признак оплаты из произвольной текстовой зарплаты."""
    text = (value or "").strip().lower()
    if not text:
        return SalaryInfo(min_value=None, max_value=None, is_paid=False)

    is_unpaid = any(marker in text for marker in UNPAID_MARKERS)
    numbers = _extract_salary_numbers(text)
    if not numbers:
        return SalaryInfo(min_value=None, max_value=None, is_paid=not is_unpaid)

    minimum = min(numbers)
    maximum = max(numbers)
    if any(marker in text for marker in ("до", "не более", "максимум")) and len(numbers) == 1:
        minimum = None
    if any(marker in text for marker in ("от", "минимум")) and len(numbers) == 1:
        maximum = None

    return SalaryInfo(min_value=minimum, max_value=maximum, is_paid=not is_unpaid and maximum > 0)


def has_unreasonable_salary_number(value: str | None) -> bool:
    """Проверяет, похоже ли поле зарплаты на случайную или нереалистичную числовую строку."""
    text = (value or "").strip()
    if not text:
        return False

    # Normalize minus signs
    normalized_text = text.replace("—", "-").replace("−", "-")

    # Replace ranges "digit - digit" with "digit to digit" to avoid treating range dashes as negative signs
    while True:
        next_text = re.sub(r"(\d)\s*-\s*(\d)", r"\1 to \2", normalized_text)
        if next_text == normalized_text:
            break
        normalized_text = next_text

    # If there is any remaining minus sign followed by a digit, it's a negative number
    if re.search(r"-\s*\d", normalized_text):
        return True

    numbers_as_text = _extract_salary_number_strings(normalized_text)
    if any(len(item) > 9 for item in numbers_as_text):
        return True

    for item in numbers_as_text:
        try:
            val = int(item)
            if val > MAX_REASONABLE_REWARD or val < 0:
                return True
        except ValueError:
            return True

    return False


def matches_salary_filter(value: str | None, salary_filter: str | None) -> bool:
    """Проверяет соответствие текстовой зарплаты публичному фильтру."""
    if not salary_filter:
        return True

    info = parse_salary_range(value)
    if salary_filter == "paid":
        return info.is_paid

    try:
        threshold = int(salary_filter)
    except (TypeError, ValueError):
        return True

    comparable = info.max_value if info.max_value is not None else info.min_value
    return comparable is not None and comparable >= threshold
