"""Маршруты для кабинета куратора и модерации платформы."""

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app import auth, models, schemas
from app.database import get_db
from app.dependencies import require_roles
from app.geocoder import GeocodingError, geocode_address, geocoder_is_configured
from app.routers.opportunities import (
    normalize_validated_expires_at,
    resolve_coordinates,
    should_geocode,
)


router = APIRouter(prefix="/curator", tags=["curator"])


def curator_opportunity_out(opportunity: models.Opportunity) -> schemas.CuratorOpportunityOut:
    """Возвращает публичную схему карточки для кабинета куратора."""
    return schemas.CuratorOpportunityOut(
        id=opportunity.id,
        employer_id=opportunity.employer_id,
        employer_name=(
            opportunity.employer.employer_profile.company_name
            if opportunity.employer and opportunity.employer.employer_profile
            else opportunity.employer.display_name if opportunity.employer else "Работодатель"
        ),
        title=opportunity.title,
        description=opportunity.description,
        type=opportunity.type,
        work_format=opportunity.work_format,
        location=opportunity.location,
        lat=opportunity.lat,
        lng=opportunity.lng,
        salary_range=opportunity.salary_range,
        expires_at=opportunity.expires_at,
        event_date=opportunity.event_date,
        is_active=opportunity.is_active,
        published_at=opportunity.published_at,
        tags=opportunity.tags,
    )


def moderation_review_history_out(review: models.AIModerationReview) -> schemas.AIModerationReviewHistoryOut:
    """Преобразует сохраненную AI-проверку в API-схему с JSON-полями."""
    return schemas.AIModerationReviewHistoryOut(
        id=review.id,
        opportunity_id=review.opportunity_id,
        reviewer_id=review.reviewer_id,
        risk_level=review.risk_level,
        risk_sources=json.loads(review.risk_sources or "[]"),
        rule_matches=json.loads(review.rule_matches or "[]"),
        model=review.model,
        duration_ms=review.duration_ms,
        created_at=review.created_at,
    )


@router.post("/curators", response_model=schemas.UserOut, status_code=201)
def create_curator_account(
    payload: schemas.CuratorAccountCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Создает новую учетную запись куратора. Доступно только администратору."""
    existing_user = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    curator_user = models.User(
        email=payload.email,
        hashed_password=auth.get_password_hash(payload.password),
        display_name=payload.display_name.strip(),
        role="curator",
        is_active=True,
        is_verified=True,
    )
    db.add(curator_user)
    db.commit()
    db.refresh(curator_user)
    return curator_user


@router.get("/users", response_model=List[schemas.CuratorUserOut])
def list_users(
    role: Optional[str] = Query(default=None),
    query: Optional[str] = Query(default=None, min_length=1),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Возвращает пользователей для модерации с фильтрами по роли и поиску."""
    users_query = (
        db.query(models.User)
        .options(
            joinedload(models.User.applicant_profile),
            joinedload(models.User.employer_profile),
        )
        .order_by(models.User.created_at.desc())
    )

    if role:
        users_query = users_query.filter(models.User.role == role)

    if query:
        pattern = f"%{query.strip()}%"
        users_query = users_query.filter(
            (models.User.email.ilike(pattern))
            | (models.User.display_name.ilike(pattern))
        )

    return users_query.offset(skip).limit(limit).all()


@router.patch("/users/{user_id}", response_model=schemas.CuratorUserOut)
def update_user(
    user_id: int,
    payload: schemas.CuratorUserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Обновляет статус пользователя для модерации и верификации."""
    user = (
        db.query(models.User)
        .options(
            joinedload(models.User.applicant_profile),
            joinedload(models.User.employer_profile),
        )
        .filter(models.User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    if user.role in {"curator", "admin"} and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can manage curator accounts")

    update_data = payload.model_dump(exclude_unset=True)
    applicant_profile_data = update_data.pop("applicant_profile", None)
    employer_profile_data = update_data.pop("employer_profile", None)

    for field, value in update_data.items():
        setattr(user, field, value)

    if applicant_profile_data is not None:
        if user.role != "applicant":
            raise HTTPException(status_code=400, detail="Applicant profile can be updated only for applicant role")

        applicant_profile = user.applicant_profile
        if applicant_profile is None:
            applicant_profile = models.ApplicantProfile(user_id=user.id)
            db.add(applicant_profile)
            user.applicant_profile = applicant_profile

        for field, value in applicant_profile_data.items():
            setattr(applicant_profile, field, value)

    if employer_profile_data is not None:
        if user.role != "employer":
            raise HTTPException(status_code=400, detail="Employer profile can be updated only for employer role")

        employer_profile = user.employer_profile
        if employer_profile is None:
            employer_profile = models.EmployerProfile(user_id=user.id, company_name="")
            db.add(employer_profile)
            user.employer_profile = employer_profile

        if "company_name" in employer_profile_data:
            company_name = (employer_profile_data.get("company_name") or "").strip()
            if not company_name:
                raise HTTPException(status_code=400, detail="Company name is required")
            employer_profile_data["company_name"] = company_name

        for field, value in employer_profile_data.items():
            setattr(employer_profile, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.get("/opportunities", response_model=List[schemas.CuratorOpportunityOut])
def list_opportunities(
    query: Optional[str] = Query(default=None, min_length=1),
    is_active: Optional[bool] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Возвращает список возможностей для модерации."""
    opportunities_query = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .order_by(models.Opportunity.published_at.desc())
    )

    if is_active is not None:
        opportunities_query = opportunities_query.filter(models.Opportunity.is_active.is_(is_active))

    if query:
        pattern = f"%{query.strip()}%"
        opportunities_query = opportunities_query.filter(
            (models.Opportunity.title.ilike(pattern))
            | (models.Opportunity.description.ilike(pattern))
            | (models.Opportunity.location.ilike(pattern))
        )

    opportunities = opportunities_query.offset(skip).limit(limit).all()
    return [curator_opportunity_out(opportunity) for opportunity in opportunities]


@router.patch("/opportunities/{opp_id}", response_model=schemas.CuratorOpportunityOut)
def update_opportunity(
    opp_id: int,
    payload: schemas.CuratorOpportunityUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Обновляет статус и наполнение карточки возможности."""
    opportunity = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(models.Opportunity.id == opp_id)
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    update_data = payload.model_dump(exclude_unset=True, exclude={"tag_ids"})
    if "expires_at" in update_data:
        update_data["expires_at"] = normalize_validated_expires_at(update_data["expires_at"])

    old_location = opportunity.location
    old_work_format = opportunity.work_format
    location_changed = "location" in update_data and update_data["location"] != old_location
    work_format_changed = "work_format" in update_data and update_data["work_format"] != old_work_format
    active_location = update_data.get("location", old_location)
    active_work_format = update_data.get("work_format", old_work_format)

    if not should_geocode(active_location, active_work_format):
        update_data["lat"] = None
        update_data["lng"] = None
    elif location_changed or work_format_changed or opportunity.lat is None or opportunity.lng is None:
        lat, lng = resolve_coordinates(active_location, active_work_format, None, None)
        update_data["lat"] = lat
        update_data["lng"] = lng

    for field, value in update_data.items():
        setattr(opportunity, field, value)

    if payload.tag_ids is not None:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(payload.tag_ids)).all()
        opportunity.tags = tags

    db.commit()
    db.refresh(opportunity)

    return curator_opportunity_out(opportunity)


@router.post("/opportunities/{opp_id}/geocode", response_model=schemas.CuratorOpportunityOut)
def retry_opportunity_geocoding(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Повторно геокодирует карточку по текущей локации по запросу куратора."""
    opportunity = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(models.Opportunity.id == opp_id)
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    if not should_geocode(opportunity.location, opportunity.work_format):
        opportunity.lat = None
        opportunity.lng = None
        db.commit()
        db.refresh(opportunity)
        return curator_opportunity_out(opportunity)
    if not geocoder_is_configured():
        raise HTTPException(status_code=503, detail="Yandex Geocoder API key не настроен на сервере.")

    try:
        result = geocode_address(opportunity.location)
    except GeocodingError as exc:
        raise HTTPException(status_code=502, detail=f"Не удалось геокодировать адрес: {exc}") from exc

    if not result:
        raise HTTPException(status_code=404, detail="Геокодер не нашел координаты для текущей локации.")

    opportunity.lat = result["lat"]
    opportunity.lng = result["lng"]
    db.commit()
    db.refresh(opportunity)
    return curator_opportunity_out(opportunity)


@router.get("/opportunities/{opp_id}/ai-reviews", response_model=List[schemas.AIModerationReviewHistoryOut])
def list_opportunity_ai_reviews(
    opp_id: int,
    limit: int = Query(default=3, ge=1, le=10),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Возвращает последние сохраненные AI-проверки карточки."""
    exists = db.query(models.Opportunity.id).filter(models.Opportunity.id == opp_id).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    reviews = (
        db.query(models.AIModerationReview)
        .filter(models.AIModerationReview.opportunity_id == opp_id)
        .order_by(models.AIModerationReview.created_at.desc(), models.AIModerationReview.id.desc())
        .limit(limit)
        .all()
    )
    return [moderation_review_history_out(review) for review in reviews]
