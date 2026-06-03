"""Маршруты AI-помощников для разных ролей платформы."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
import json
import os
import re
from time import perf_counter
from typing import Any, Iterable, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session, joinedload

from app import ai_service, models, schemas
from app.database import get_db
from app.dependencies import get_current_active_user, require_roles
from app.moderation_rules import ModerationRuleMatch, scan_moderation_rules
from app.opportunity_visibility import public_opportunity_filters
from app.salary import has_unreasonable_salary_number


router = APIRouter(prefix="/ai", tags=["ai"])
DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10
_user_request_log: dict[int, deque[datetime]] = defaultdict(deque)
BROKEN_TEXT_MARKER = "\ufffd"
OPPORTUNITY_DESCRIPTION_META_MARKERS = (
    "в карточке не указан",
    "в карточке не указана",
    "в карточке не указано",
    "перед публикацией",
    "перед размещением",
    "стоит обязательно проверить",
    "нужно уточнить",
    "лучше уточнить",
    "требует доработки",
    "черновик описания отсутствует",
    "текущий шаблон",
    "поле локации содержит",
    "поле зарплат",
    "поле вознаграждения",
    "если вы оформляете карточку",
    "добавьте, чем именно",
    "нет описания обязанностей",
    "не указаны обязанности",
)
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
MODERATION_HIGHLIGHT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "level", "explanation"],
    "properties": {
        "text": {"type": "string"},
        "level": {"type": "string", "enum": ["good", "suspicious", "danger"]},
        "explanation": {"type": "string"},
    },
}
MODERATION_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["risk_level", "reasons", "checklist", "recommended_action", "highlights"],
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
        "highlights": {
            "type": "array",
            "items": MODERATION_HIGHLIGHT_SCHEMA,
        },
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


def positive_int_from_env(name: str, default: int) -> int:
    """Возвращает положительное целое из окружения или безопасное значение по умолчанию."""
    raw_value = os.getenv(name, str(default))
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def get_ai_rate_limit_settings() -> tuple[timedelta, int]:
    """Читает настройки in-memory rate limit для AI-запросов."""
    window_seconds = positive_int_from_env("AI_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_RATE_LIMIT_WINDOW_SECONDS)
    max_requests = positive_int_from_env("AI_RATE_LIMIT_MAX_REQUESTS", DEFAULT_RATE_LIMIT_MAX_REQUESTS)
    return timedelta(seconds=window_seconds), max_requests


def check_ai_rate_limit(current_user: models.User) -> None:
    """Ограничивает число AI-запросов на пользователя в памяти процесса."""
    now = datetime.now(UTC)
    window, max_requests = get_ai_rate_limit_settings()
    bucket = _user_request_log[current_user.id]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много AI-запросов. Попробуй еще раз позже.",
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


def clean_ai_text(value: str) -> str:
    """Удаляет артефакты кодировки из текста, возвращенного AI-сервисом."""
    return re.sub(r"\s+", " ", value.replace(BROKEN_TEXT_MARKER, "")).strip()


def clean_ai_payload(value: Any) -> Any:
    """Рекурсивно очищает текстовые поля структурированного AI-ответа."""
    if isinstance(value, str):
        return clean_ai_text(value)
    if isinstance(value, list):
        return [clean_ai_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_ai_payload(item) for key, item in value.items()}
    return value


def salary_text_for_opportunity_prompt(value: str | None) -> str:
    """Возвращает безопасное представление зарплаты для prompt AI-помощника."""
    text = text_or_dash(value)
    if text == "-":
        return text
    if has_unreasonable_salary_number(value):
        return (
            f"{text} [значение выглядит некорректным; не используй его как факт о зарплате "
            "в description, добавь предупреждение в warnings]"
        )
    return text


def opportunity_assist_system_warnings(payload: schemas.AIOpportunityAssistRequest) -> list[str]:
    """Формирует backend-предупреждения по полям, которые AI не должен превращать в факты."""
    warnings: list[str] = []
    if has_unreasonable_salary_number(payload.salary_range):
        warnings.append("Проверь поле вознаграждения: значение выглядит некорректным.")
    return warnings


def validate_public_opportunity_description(description: str) -> None:
    """Не дает вставить служебную диагностику AI в публичное описание карточки."""
    normalized = clean_ai_text(description).casefold()
    if any(marker in normalized for marker in OPPORTUNITY_DESCRIPTION_META_MARKERS):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул комментарий вместо публичного описания. Уточни поля карточки и попробуй еще раз.",
        )


def merge_warnings(*groups: Iterable[str]) -> list[str]:
    """Объединяет предупреждения без дублей, сохраняя порядок."""
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for warning in group:
            cleaned = clean_ai_text(warning)
            key = cleaned.casefold()
            if cleaned and key not in seen:
                merged.append(cleaned)
                seen.add(key)
    return merged


def tag_catalog_text(tags: Iterable[models.Tag]) -> str:
    """Возвращает компактное описание доступных тегов для промпта."""
    return "\n".join(f"- {tag.name} ({tag.category})" for tag in tags) or "-"


def snapshot_value(value: object, fallback: object) -> object:
    """Возвращает значение из формы куратора или сохраненное значение карточки."""
    return fallback if value is None else value


def moderation_rule_text(rule_matches: list[ModerationRuleMatch]) -> str:
    """Возвращает компактное описание системных совпадений для prompt."""
    if not rule_matches:
        return "-"
    return "\n".join(
        f"- {match.level}: {match.category}: {match.text} — {match.reason}"
        for match in rule_matches
    )


def moderation_risk_sources(
    parsed: schemas.AIModerationReviewResponse,
    rule_matches: list[schemas.ModerationRuleMatch],
) -> list[str]:
    """Возвращает источники риска, участвовавшие в итоговом решении."""
    sources = []
    if rule_matches:
        sources.append("rules")
    if parsed.risk_level != "low" or parsed.reasons or parsed.highlights:
        sources.append("ai")
    return sources


def unique_limited(values: Iterable[str], limit: int) -> list[str]:
    """Возвращает уникальные непустые строки с ограничением по количеству."""
    result = []
    seen = set()
    for value in values:
        cleaned = clean_ai_text(value).strip()
        key = cleaned.casefold()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
        if len(result) >= limit:
            break
    return result


def rule_risk_level(rule_matches: list[schemas.ModerationRuleMatch]) -> str:
    """Определяет итоговый уровень риска только по системным правилам."""
    if any(match.level == "danger" for match in rule_matches):
        return "high"
    if rule_matches:
        return "medium"
    return "low"


def rule_only_moderation_response(
    rule_matches: list[schemas.ModerationRuleMatch],
    *,
    ai_unavailable: bool = False,
) -> schemas.AIModerationReviewResponse:
    """Возвращает модерационную подсказку без AI, если системные правила уже нашли риск."""
    reasons = unique_limited((match.reason for match in rule_matches), 8)
    checklist = [
        "Проверьте найденные системные совпадения вручную.",
        "Сверьте условия вакансии с официальными источниками работодателя.",
        "Не публикуйте карточку, пока опасные или неоднозначные формулировки не будут устранены.",
    ]
    recommended_action = (
        "AI временно недоступен, но системные правила нашли риск. "
        "Рекомендуется отложить публикацию и запросить у работодателя уточнения."
        if ai_unavailable
        else "Рекомендуется проверить найденные системные совпадения перед публикацией."
    )
    return schemas.AIModerationReviewResponse(
        risk_level=rule_risk_level(rule_matches),
        reasons=reasons,
        checklist=checklist,
        recommended_action=recommended_action,
        highlights=[],
        rule_matches=rule_matches,
        risk_sources=["rules"] if rule_matches else [],
    )


def merge_moderation_response(
    parsed: schemas.AIModerationReviewResponse,
    rule_matches: list[schemas.ModerationRuleMatch],
) -> schemas.AIModerationReviewResponse:
    """Объединяет AI-проверку с результатами системных правил."""
    risk_level = parsed.risk_level
    if any(match.level == "danger" for match in rule_matches):
        risk_level = "high"
    elif rule_matches and risk_level == "low":
        risk_level = "medium"

    rule_reasons = [match.reason for match in rule_matches]
    reasons = unique_limited([*rule_reasons, *parsed.reasons], 8)
    checklist = unique_limited(
        [
            *(
                ["Проверьте найденные системные совпадения вручную."]
                if rule_matches
                else []
            ),
            *parsed.checklist,
        ],
        8,
    )

    return parsed.model_copy(
        update={
            "risk_level": risk_level,
            "reasons": reasons,
            "checklist": checklist,
            "rule_matches": rule_matches,
            "risk_sources": moderation_risk_sources(parsed, rule_matches),
        }
    )


def save_moderation_review_history(
    db: Session,
    *,
    opportunity_id: int,
    reviewer_id: int,
    result: schemas.AIModerationReviewResponse,
    duration_ms: int,
) -> None:
    """Сохраняет результат AI-проверки для аудита куратора."""
    settings = ai_service.get_ai_settings()
    review = models.AIModerationReview(
        opportunity_id=opportunity_id,
        reviewer_id=reviewer_id,
        risk_level=result.risk_level,
        risk_sources=json.dumps(result.risk_sources, ensure_ascii=False),
        rule_matches=json.dumps(
            [match.model_dump() for match in result.rule_matches],
            ensure_ascii=False,
        ),
        model=settings.model,
        duration_ms=duration_ms,
    )
    db.add(review)
    db.commit()


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
                "Не выдумывай факты, которых нет во входных данных. Поле description — это только публичный текст вакансии "
                "от лица работодателя; не пиши туда диагностику карточки, чеклист, советы, фразы «нужно уточнить», "
                "«перед публикацией», «в карточке не указано». Все сомнения и проблемы отправляй только в warnings. "
                "Верни только JSON."
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
                f"Зарплата/вознаграждение: {salary_text_for_opportunity_prompt(payload.salary_range)}\n"
                f"Черновик описания: {text_or_dash(payload.description)}\n\n"
                "Доступные теги:\n"
                f"{tag_catalog_text(tags)}\n\n"
                "Верни JSON с ключами: description (строка 700-1200 символов, только готовое публичное описание), "
                "summary (до 180 символов), suggested_tag_names (массив названий только из доступных тегов), "
                "warnings (массив коротких предупреждений для работодателя)."
            ),
        },
    ]


def moderation_prompt(
    opportunity: models.Opportunity,
    payload: schemas.AIModerationReviewRequest,
    rule_matches: list[ModerationRuleMatch],
) -> list[dict[str, str]]:
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
                "Системные совпадения rule-based фильтра:\n"
                f"{moderation_rule_text(rule_matches)}\n\n"
                "Верни JSON с ключами: risk_level (low|medium|high), reasons (массив), checklist (массив), "
                "recommended_action (строка), highlights (массив до 8 объектов). "
                "Каждый объект highlights должен содержать text (точная короткая цитата из описания), "
                "level (good|suspicious|danger) и explanation (почему фрагмент отмечен). "
                "Используй good для прозрачных сильных условий, suspicious для неоднозначных формулировок, "
                "danger для опасных условий вроде депозитов, неоплачиваемой работы на реальном проекте или отсутствия договора."
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
async def assist_opportunity(
    payload: schemas.AIOpportunityAssistRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("employer", "curator", "admin")),
):
    """Генерирует улучшенное описание и предлагает теги для карточки возможности."""
    check_ai_rate_limit(current_user)
    tags = db.query(models.Tag).order_by(models.Tag.category.asc(), models.Tag.name.asc()).all()
    system_warnings = opportunity_assist_system_warnings(payload)
    try:
        raw = await ai_service.call_chat_json_async(
            opportunity_prompt(payload, tags),
            response_schema=OPPORTUNITY_ASSIST_SCHEMA,
            schema_name="opportunity_assist",
        )
        raw = clean_ai_payload(raw)
        parsed = schemas.AIOpportunityAssistRawResponse.model_validate(raw)
        validate_public_opportunity_description(parsed.description)
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
        warnings=merge_warnings(system_warnings, parsed.warnings)[:5],
    )


@router.post("/moderation-review", response_model=schemas.AIModerationReviewResponse)
async def review_moderation(
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

    rule_matches = scan_moderation_rules(
        title=str(snapshot_value(payload.title, opportunity.title) or ""),
        description=str(snapshot_value(payload.description, opportunity.description) or ""),
        salary_range=str(snapshot_value(payload.salary_range, opportunity.salary_range) or ""),
        location=str(snapshot_value(payload.location, opportunity.location) or ""),
        opportunity_type=str(snapshot_value(payload.type, opportunity.type) or ""),
        work_format=str(snapshot_value(payload.work_format, opportunity.work_format) or ""),
    )
    rule_match_payload = [
        schemas.ModerationRuleMatch(
            category=match.category,
            level=match.level,
            text=match.text,
            reason=match.reason,
        )
        for match in rule_matches
    ]

    started_at = perf_counter()
    try:
        raw = await ai_service.call_chat_json_async(
            moderation_prompt(opportunity, payload, rule_matches),
            response_schema=MODERATION_REVIEW_SCHEMA,
            schema_name="moderation_review",
        )
        raw = clean_ai_payload(raw)
        parsed = schemas.AIModerationReviewResponse.model_validate(raw)
        result = merge_moderation_response(parsed, rule_match_payload)
        save_moderation_review_history(
            db,
            opportunity_id=opportunity.id,
            reviewer_id=current_user.id,
            result=result,
            duration_ms=round((perf_counter() - started_at) * 1000),
        )
        return result
    except ValidationError as exc:
        if rule_match_payload:
            result = rule_only_moderation_response(rule_match_payload, ai_unavailable=True)
            save_moderation_review_history(
                db,
                opportunity_id=opportunity.id,
                reviewer_id=current_user.id,
                result=result,
                duration_ms=round((perf_counter() - started_at) * 1000),
            )
            return result
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул JSON без ожидаемых полей.",
        ) from exc
    except ai_service.AIServiceError as exc:
        if rule_match_payload:
            result = rule_only_moderation_response(rule_match_payload, ai_unavailable=True)
            save_moderation_review_history(
                db,
                opportunity_id=opportunity.id,
                reviewer_id=current_user.id,
                result=result,
                duration_ms=round((perf_counter() - started_at) * 1000),
            )
            return result
        handle_ai_error(exc)


@router.post("/cover-letter", response_model=schemas.AICoverLetterResponse)
async def generate_cover_letter(
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
        raw = await ai_service.call_chat_json_async(
            cover_letter_prompt(opportunity, applicant),
            response_schema=COVER_LETTER_SCHEMA,
            schema_name="cover_letter",
        )
        raw = clean_ai_payload(raw)
        return schemas.AICoverLetterResponse.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI вернул JSON без ожидаемых полей.",
        ) from exc
    except ai_service.AIServiceError as exc:
        handle_ai_error(exc)
