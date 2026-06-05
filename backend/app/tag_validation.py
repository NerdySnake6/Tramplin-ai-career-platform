"""Правила валидации и лимитов для справочника тегов."""

import re
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models

MAX_TAG_CATALOG_SIZE = 200
MAX_TAGS_PER_CATEGORY = 100
MAX_TAG_NAME_LENGTH = 50
ALLOWED_TAG_PATTERN = re.compile(r"^[\w\s.+#,/&()\-]+$", re.UNICODE)


def normalize_tag_name(name: str) -> str:
    """Возвращает нормализованное имя тега без лишних пробелов."""
    normalized = unicodedata.normalize("NFC", name or "")
    return " ".join(normalized.strip().split())


def has_zalgo_or_hidden_marks(value: str) -> bool:
    """Проверяет, содержит ли строка комбинирующие или невидимые символы."""
    for char in value:
        category = unicodedata.category(char)
        if category.startswith("M") or category in {"Cc", "Cf", "Cs", "Co", "Cn"}:
            return True
    return False


def validate_tag_name(name: str) -> str:
    """Валидирует имя тега и возвращает безопасное нормализованное значение."""
    normalized_name = normalize_tag_name(name)
    if not normalized_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Название тега не может быть пустым.",
        )
    if len(normalized_name) > MAX_TAG_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Название тега не должно быть длиннее {MAX_TAG_NAME_LENGTH} символов.",
        )
    if has_zalgo_or_hidden_marks(normalized_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Название тега содержит недопустимые комбинирующие или невидимые символы.",
        )
    if not ALLOWED_TAG_PATTERN.fullmatch(normalized_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Название тега содержит недопустимые символы.",
        )
    return normalized_name


def ensure_tag_catalog_limit(db: Session, category: str) -> None:
    """Проверяет лимиты общего справочника тегов и выбранной категории."""
    total_count = db.query(models.Tag).count()
    if total_count >= MAX_TAG_CATALOG_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"В справочнике может быть не больше {MAX_TAG_CATALOG_SIZE} тегов.",
        )

    category_count = db.query(models.Tag).filter(models.Tag.category == category).count()
    if category_count >= MAX_TAGS_PER_CATEGORY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"В одной категории может быть не больше {MAX_TAGS_PER_CATEGORY} тегов.",
        )
