"""Общие правила публичной видимости карточек возможностей."""

from datetime import UTC, datetime, time, timedelta

from sqlalchemy import or_

from app import models

MIN_OPPORTUNITY_LIFETIME = timedelta(days=1)


def utc_now_naive() -> datetime:
    """Возвращает текущее время UTC без timezone."""
    return datetime.now(UTC).replace(tzinfo=None)


def normalize_expiration_datetime(expires_at: datetime | None) -> datetime | None:
    """Нормализует срок действия карточки перед сохранением в базе."""
    if expires_at is None:
        return None

    normalized = expires_at
    if normalized.tzinfo is not None:
        normalized = normalized.astimezone(UTC).replace(tzinfo=None)

    if normalized.time() == time.min:
        return normalized + timedelta(days=1) - timedelta(microseconds=1)

    return normalized


def is_expiration_datetime_allowed(
    expires_at: datetime | None,
    now: datetime | None = None,
) -> bool:
    """Проверяет, что заданный срок действия не короче минимального."""
    if expires_at is None:
        return True

    checked_at = now or utc_now_naive()
    return expires_at >= checked_at + MIN_OPPORTUNITY_LIFETIME


def public_opportunity_filters(now: datetime | None = None):
    """Возвращает SQLAlchemy-фильтры для публично доступных карточек."""
    checked_at = now or utc_now_naive()
    return (
        models.Opportunity.is_active.is_(True),
        or_(
            models.Opportunity.expires_at.is_(None),
            models.Opportunity.expires_at >= checked_at,
        ),
    )
