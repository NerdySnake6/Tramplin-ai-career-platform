"""Маршруты AI-помощников для разных ролей платформы."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import Iterable, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session, joinedload

from app import ai_service, models, schemas
from app.database import get_db
from app.dependencies import get_current_active_user, require_roles
from app.opportunity_visibility import public_opportunity_filters


router = APIRouter(prefix="/ai", tags=["ai"])
RATE_LIMIT_WINDOW = timedelta(minutes=1)
RATE_LIMIT_MAX_REQUESTS = 10
_user_request_log: dict[int, deque[datetime]] = defaultdict(deque)
OPPORTUNITY_ASSIST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["description", "summary", "suggested_tag_names", "warnings"],
    "properties": {
        "description": {"type": "string"},
        "summary": {"type": "string"},
        "suggested_tag_names": {
            "type": "array",
            "items": {"type": "string"},
        },
        "warnings": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}
MODERATION_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["risk_level", "reasons", "checklist", "recommended_action"],
    "properties": {
        "risk_level": {"type": "string", "enum": ["low", "medium", "high"]},
        "reasons": {
            "type": "array",
            "items": {"type": "string"},
        },
        "checklist": {
            "type": "array",
            "items": {"type": "string"},
        },
        "recommended_action": {"type": "string"},
    },
}
COVER_LETTER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["cover_letter", "fit_reasons", "gaps"],
    "properties": {
        "cover_letter": {"type": "string"},
        "fit_reasons": {
            "type": "array",
            "items": {"type": "string"},
        },
        "gaps": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}


def check_ai_rate_limit(current_user: models.User) -> None:
    """Ограничивает число AI-запросов на пользователя в памяти процесса."""
    now = datetime.now(UTC)
    bucket = _user_request_log[current_user.id]
    while bucket and now - bucket[0] > RATE_LIMIT_WINDOW:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много AI-запросов. Попробуй еще раз через минуту.",
        )
    bucket.append(now)


def handle_ai_error(exc: ai_service.AIServiceError) -> NoReturn:
    """Преобразует ошибку AI-сервиса в HTTP-ответ."""
    if isinstance(exc, ai_service.AIConfigurationError):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if isinstance(exc, ai_service.AIResponseError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def text_or_dash(value: object) -> str:
    """Возвращает строковое значение или короткий маркер отсутствия данных."""
    if value is None:
        return "-"
    text = str(value).strip()
    return text or "-"


def tag_catalog_text(tags: Iterable[models.Tag]) -> str:
    """Возвращает компактное описание доступных тегов для промпта."""
    return "\n".join(f"- {tag.name} ({tag.category})" for tag in tags) or "-"


def snapshot_value(value: object, fallback: object) -> object:
    """Возвращает значение из формы куратора или сохраненное значение карточки."""
    return fallback if value is None else value


def match_suggested_tags(suggested_names: list[str], tags: list[models.Tag]) -> list[schemas.AITagSuggestion]:
    """Сопоставляет предложенные моделью названия с существующими тегами."""
    by_name = {tag.name.casefold(): tag for tag in tags}
    matched: list[schemas.AITagSuggestion] = []
    seen_ids: set[int] = set()
    for raw_name in suggested_names:
        tag = by_name.get(raw_name.strip().casefold())
        if not tag or tag.id in seen_ids:
            continue
        matched.append(schemas.AITagSuggestion(id=tag.id, name=tag.name, category=tag.category))
        seen_ids.add(tag.id)
    return matched[:8]


def opportunity_prompt(payload: schemas.AIOpportunityAssistRequest, tags: list[models.Tag]) -> list[dict[str, str]]:
    """Создает prompt для AI-помощника работодателя."""
    return [
        {
            "role": "system",
            "content": (
                "Ты карьерный редактор платформы «Трамплин». Улучши карточку возможности для студентов и junior-специалистов. "
                "Не выдумывай факты, которых нет во входных данных. Верни только JSON."
            ),
        },
        {
            "role": "user",
            "content": (
                "Данные карточки:\n"
                f"Название: {text_or_dash(payload.title)}\n"
                f"Тип: {payload.type}\n"
                f"Формат: {payload.work_format}\n"
                f"Локация: {text_or_dash(payload.location)}\n"
                f"Зарплата/вознаграждение: {text_or_dash(payload.salary_range)}\n"
                f"Черновик описания: {text_or_dash(payload.description)}\n\n"
                "Доступные теги:\n"
                f"{tag_catalog_text(tags)}\n\n"
                "Верни JSON с ключами: description (строка 700-1200 символов), summary (до 180 символов), "
                "suggested_tag_names (массив названий только из доступных тегов), warnings (массив коротких предупреждений)."
            ),
        },
    ]


def moderation_prompt(opportunity: models.Opportunity, payload: schemas.AIModerationReviewRequest) -> list[dict[str, str]]:
    """Создает prompt для AI-проверки карточки куратором."""
    tags = ", ".join(tag.name for tag in opportunity.tags) or "-"
    employer_profile = opportunity.employer.employer_profile if opportunity.employer else None
    company_name = employer_profile.company_name if employer_profile else opportunity.employer_name
    is_active = snapshot_value(payload.is_active, opportunity.is_active)
    return [
        {
            "role": "system",
            "content": (
                "Ты ассистент куратора карьерной платформы. Оцени карточку на риски для студентов: мутные условия, "
                "недостаток данных, подозрительные обещания, несоответствие формата, слабая проверяемость работодателя. "
                "Не блокируй автоматически, дай рекомендации человеку. Верни только JSON."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Компания: {text_or_dash(company_name)}\n"
                f"Название: {text_or_dash(snapshot_value(payload.title, opportunity.title))}\n"
                f"Тип: {text_or_dash(snapshot_value(payload.type, opportunity.type))}\n"
                f"Формат: {text_or_dash(snapshot_value(payload.work_format, opportunity.work_format))}\n"
                f"Локация: {text_or_dash(snapshot_value(payload.location, opportunity.location))}\n"
                f"Зарплата: {text_or_dash(snapshot_value(payload.salary_range, opportunity.salary_range))}\n"
                f"Статус публикации: {'активна' if is_active else 'неактивна'}\n"
                f"Теги: {tags}\n"
                f"Описание: {text_or_dash(snapshot_value(payload.description, opportunity.description))}\n\n"
                "Верни JSON с ключами: risk_level (low|medium|high), reasons (массив), checklist (массив), "
                "recommended_action (строка)."
            ),
        },
    ]


def cover_letter_prompt(opportunity: models.Opportunity, applicant: models.User) -> list[dict[str, str]]:
    """Создает prompt для AI-сопроводительного письма."""
    profile = applicant.applicant_profile
    return [
        {
            "role": "system",
            "content": (
                "Ты карьерный ассистент студента. Напиши честное сопроводительное письмо на русском. "
                "Не выдумывай опыт и навыки, которых нет в профиле. Если данных мало, сделай универсальный, но аккуратный черновик. "
                "Верни только JSON."
            ),
        },
        {
            "role": "user",
            "content": (
                "Профиль соискателя:\n"
                f"Имя: {text_or_dash(profile.full_name if profile else applicant.display_name)}\n"
                f"Университет/курс: {text_or_dash(profile.university if profile else None)} / {text_or_dash(profile.course_or_year if profile else None)}\n"
                f"Навыки: {text_or_dash(profile.skills if profile else None)}\n"
                f"Опыт: {text_or_dash(profile.experience if profile else None)}\n"
                f"О себе: {text_or_dash(profile.bio if profile else None)}\n\n"
                "Возможность:\n"
                f"Название: {opportunity.title}\n"
                f"Работодатель: {opportunity.employer_name}\n"
                f"Тип/формат: {opportunity.type} / {opportunity.work_format}\n"
                f"Локация: {opportunity.location}\n"
                f"Описание: {opportunity.description}\n\n"
                "Верни JSON с ключами: cover_letter (до 1200 символов), fit_reasons (массив из 2-3 пунктов), gaps (массив из 0-2 честных пробелов)."
            ),
        },
    ]


@router.get("/status", response_model=schemas.AIStatusOut)
def get_ai_status():
    """Возвращает состояние AI-интеграции без раскрытия секретов."""
    settings = ai_service.get_ai_settings()
    return schemas.AIStatusOut(
        enabled=settings.enabled,
        configured=bool(settings.api_key),
        ready=ai_service.ai_is_ready(),
        model=settings.model,
        base_url=settings.base_url,
    )


@router.post("/opportunity-assist", response_model=schemas.AIOpportunityAssistResponse)
def assist_opportunity(
    payload: schemas.AIOpportunityAssistRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("employer", "curator", "admin")),
):
    """Генерирует улучшенное описание и предлагает теги для карточки возможности."""
    check_ai_rate_limit(current_user)
    tags = db.query(models.Tag).order_by(models.Tag.category.asc(), models.Tag.name.asc()).all()
    try:
        raw = ai_service.call_chat_json(
            opportunity_prompt(payload, tags),
            response_schema=OPPORTUNITY_ASSIST_SCHEMA,
            schema_name="opportunity_assist",
        )
        parsed = schemas.AIOpportunityAssistRawResponse.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул JSON без ожидаемых полей.",
        ) from exc
    except ai_service.AIServiceError as exc:
        handle_ai_error(exc)

    return schemas.AIOpportunityAssistResponse(
        description=parsed.description,
        summary=parsed.summary,
        suggested_tags=match_suggested_tags(parsed.suggested_tag_names, tags),
        warnings=parsed.warnings[:5],
    )


@router.post("/moderation-review", response_model=schemas.AIModerationReviewResponse)
def review_moderation(
    payload: schemas.AIModerationReviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Возвращает AI-подсказку для ручной модерации карточки."""
    check_ai_rate_limit(current_user)
    opportunity = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(models.Opportunity.id == payload.opportunity_id)
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    try:
        raw = ai_service.call_chat_json(
            moderation_prompt(opportunity, payload),
            response_schema=MODERATION_REVIEW_SCHEMA,
            schema_name="moderation_review",
        )
        return schemas.AIModerationReviewResponse.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул JSON без ожидаемых полей.",
        ) from exc
    except ai_service.AIServiceError as exc:
        handle_ai_error(exc)


@router.post("/cover-letter", response_model=schemas.AICoverLetterResponse)
def generate_cover_letter(
    payload: schemas.AICoverLetterRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("applicant")),
):
    """Генерирует черновик сопроводительного письма для выбранной возможности."""
    check_ai_rate_limit(current_user)
    applicant = (
        db.query(models.User)
        .options(joinedload(models.User.applicant_profile))
        .filter(models.User.id == current_user.id)
        .first()
    )
    opportunity = (
        db.query(models.Opportunity)
        .options(joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile))
        .filter(models.Opportunity.id == payload.opportunity_id)
        .filter(*public_opportunity_filters())
        .first()
    )
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found")
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    try:
        raw = ai_service.call_chat_json(
            cover_letter_prompt(opportunity, applicant),
            response_schema=COVER_LETTER_SCHEMA,
            schema_name="cover_letter",
        )
        return schemas.AICoverLetterResponse.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул JSON без ожидаемых полей.",
        ) from exc
    except ai_service.AIServiceError as exc:
        handle_ai_error(exc)
