"""Маршруты для просмотра и управления возможностями на платформе."""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db
from app.dependencies import require_roles, get_current_active_user
from app.geocoder import GeocodingError, geocode_address, geocoder_is_configured
from app.opportunity_visibility import (
    is_expiration_datetime_allowed,
    normalize_expiration_datetime,
    public_opportunity_filters,
)

router = APIRouter(prefix="/opportunities", tags=["opportunities"])
logger = logging.getLogger(__name__)
EMPLOYER_FREE_OPPORTUNITY_LIMIT = 5
OPPORTUNITY_EXPIRATION_ERROR = "Срок действия должен быть минимум на 1 день позже текущего времени."


def normalize_validated_expires_at(expires_at: datetime | None) -> datetime | None:
    """Нормализует и проверяет срок действия карточки возможности."""
    normalized = normalize_expiration_datetime(expires_at)
    if not is_expiration_datetime_allowed(normalized):
        raise HTTPException(status_code=422, detail=OPPORTUNITY_EXPIRATION_ERROR)
    return normalized


def should_geocode(location: Optional[str], work_format: Optional[str]) -> bool:
    """Определяет, нужно ли выполнять геокодирование локации."""
    if not location:
        return False
    if work_format == "remote":
        return False
    return "удален" not in location.lower()


def resolve_coordinates(
    location: Optional[str],
    work_format: Optional[str],
    lat: Optional[float],
    lng: Optional[float],
) -> tuple[Optional[float], Optional[float]]:
    """Возвращает координаты из входных данных или из геокодера."""
    if lat is not None and lng is not None:
        return lat, lng

    if not should_geocode(location, work_format):
        return None, None

    if not geocoder_is_configured():
        return lat, lng

    try:
        result = geocode_address(location)
    except GeocodingError as exc:
        logger.warning("Geocoding failed for '%s': %s", location, exc)
        return lat, lng

    if not result:
        return lat, lng

    return result["lat"], result["lng"]


def ensure_employer_can_create_opportunity(db: Session, current_user: models.User) -> None:
    """Проверяет лимит карточек для работодателя до ручной верификации."""
    if current_user.role != "employer" or current_user.is_verified:
        return

    created_count = (
        db.query(models.Opportunity.id)
        .filter(models.Opportunity.employer_id == current_user.id)
        .count()
    )
    if created_count >= EMPLOYER_FREE_OPPORTUNITY_LIMIT:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Лимит {EMPLOYER_FREE_OPPORTUNITY_LIMIT} карточек до верификации исчерпан. "
                "Попроси администратора или куратора подтвердить работодателя."
            ),
        )


@router.post("/", response_model=schemas.OpportunityOut, status_code=201)
def create_opportunity(
    opp_data: schemas.OpportunityCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("employer", "curator", "admin"))
):
    """Создает возможность и при необходимости автозаполняет координаты."""
    ensure_employer_can_create_opportunity(db, current_user)

    lat, lng = resolve_coordinates(
        opp_data.location,
        opp_data.work_format,
        opp_data.lat,
        opp_data.lng,
    )
    opp_payload = opp_data.model_dump(exclude={"tag_ids"})
    opp_payload["lat"] = lat
    opp_payload["lng"] = lng
    opp_payload["expires_at"] = normalize_validated_expires_at(opp_payload.get("expires_at"))

    db_opp = models.Opportunity(
        **opp_payload,
        employer_id=current_user.id
    )
    db.add(db_opp)
    db.commit()
    db.refresh(db_opp)
    
    if opp_data.tag_ids:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(opp_data.tag_ids)).all()
        db_opp.tags = tags
        db.commit()
        db.refresh(db_opp)
    
    return db_opp


@router.get("/", response_model=List[schemas.OpportunityOut])
def list_opportunities(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=100, description="Maximum number of records to return"),
    search_query: Optional[str] = Query(None, alias="query", description="Search by title, company or location"),
    type: Optional[str] = Query(None, description="Filter by type"),
    work_format: Optional[str] = Query(None, description="Filter by work format"),
    location: Optional[str] = Query(None, description="Filter by location (city)"),
    tag_ids: Optional[List[int]] = Query(None, description="Filter by tag IDs"),
    db: Session = Depends(get_db)
):
    """Возвращает активные публичные возможности с учетом фильтров."""
    opportunities_query = (
        db.query(models.Opportunity)
        .join(models.Opportunity.employer)
        .outerjoin(models.User.employer_profile)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(*public_opportunity_filters())
    )
    
    if type:
        opportunities_query = opportunities_query.filter(models.Opportunity.type == type)
    if work_format:
        opportunities_query = opportunities_query.filter(models.Opportunity.work_format == work_format)
    if location:
        opportunities_query = opportunities_query.filter(models.Opportunity.location.ilike(f"%{location}%"))
    if tag_ids:
        for tag_id in tag_ids:
            opportunities_query = opportunities_query.filter(models.Opportunity.tags.any(id=tag_id))
    if search_query and search_query.strip():
        search = f"%{search_query.strip()}%"
        opportunities_query = opportunities_query.filter(
            or_(
                models.Opportunity.title.ilike(search),
                models.Opportunity.description.ilike(search),
                models.Opportunity.location.ilike(search),
                models.User.display_name.ilike(search),
                models.EmployerProfile.company_name.ilike(search),
                models.Opportunity.tags.any(models.Tag.name.ilike(search)),
            )
        )
    
    opportunities = (
        opportunities_query
        .order_by(models.Opportunity.published_at.desc(), models.Opportunity.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return opportunities


@router.get("/my", response_model=List[schemas.OpportunityOut])
def list_my_opportunities(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=100, description="Maximum number of records to return"),
    query: Optional[str] = Query(None, description="Search by title, description or location"),
    type: Optional[str] = Query(None, description="Filter by type"),
    is_active: Optional[bool] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("employer", "curator", "admin")),
):
    """Возвращает карточки текущего работодателя для личного кабинета."""
    opportunities_query = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .order_by(models.Opportunity.published_at.desc())
    )

    if current_user.role == "employer":
        opportunities_query = opportunities_query.filter(models.Opportunity.employer_id == current_user.id)

    if query:
        search = f"%{query}%"
        opportunities_query = opportunities_query.filter(
            models.Opportunity.title.ilike(search)
            | models.Opportunity.description.ilike(search)
            | models.Opportunity.location.ilike(search)
        )
    if type:
        opportunities_query = opportunities_query.filter(models.Opportunity.type == type)
    if is_active is not None:
        opportunities_query = opportunities_query.filter(models.Opportunity.is_active.is_(is_active))

    return opportunities_query.offset(skip).limit(limit).all()

@router.get("/{opp_id}", response_model=schemas.OpportunityOut)
def get_opportunity(opp_id: int, db: Session = Depends(get_db)):
    """Возвращает одну возможность по ее идентификатору."""
    opp = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(models.Opportunity.id == opp_id)
        .filter(*public_opportunity_filters())
        .first()
    )
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp

@router.put("/{opp_id}", response_model=schemas.OpportunityOut)
def update_opportunity(
    opp_id: int,
    opp_data: schemas.OpportunityUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """Обновляет возможность и пересчитывает координаты при необходимости."""
    opp = (
        db.query(models.Opportunity)
        .options(
            joinedload(models.Opportunity.tags),
            joinedload(models.Opportunity.employer).joinedload(models.User.employer_profile),
        )
        .filter(models.Opportunity.id == opp_id)
        .first()
    )
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    
    if current_user.role not in ["curator", "admin"] and opp.employer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    update_data = opp_data.model_dump(exclude_unset=True, exclude={"tag_ids"})
    if "expires_at" in update_data:
        update_data["expires_at"] = normalize_validated_expires_at(update_data["expires_at"])

    location = update_data.get("location", opp.location)
    work_format = update_data.get("work_format", opp.work_format)
    lat = update_data.get("lat", opp.lat)
    lng = update_data.get("lng", opp.lng)

    if (
        "location" in update_data
        or "work_format" in update_data
        or ("lat" in update_data and "lng" in update_data)
    ):
        lat, lng = resolve_coordinates(location, work_format, lat, lng)
        update_data["lat"] = lat
        update_data["lng"] = lng

    for field, value in update_data.items():
        setattr(opp, field, value)
    
    if opp_data.tag_ids is not None:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(opp_data.tag_ids)).all()
        opp.tags = tags
    
    db.commit()
    db.refresh(opp)
    return opp

@router.delete("/{opp_id}")
def delete_opportunity(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user)
):
    """Удаляет возможность, доступную текущему пользователю по правам."""
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    
    if current_user.role not in ["curator", "admin"] and opp.employer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    db.delete(opp)
    db.commit()
    return {"ok": True}
