"""Маршруты для справочника тегов платформы."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies import require_roles
from app.tag_validation import ensure_tag_catalog_limit, validate_tag_name

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("/", response_model=list[schemas.TagOut])
def list_tags(
    category: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Возвращает справочник тегов с необязательной фильтрацией по категории."""
    tags_query = db.query(models.Tag).order_by(models.Tag.category.asc(), models.Tag.name.asc())
    if category:
        tags_query = tags_query.filter(models.Tag.category == category)
    return tags_query.all()


@router.post("/", response_model=schemas.TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: schemas.TagCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("employer", "curator", "admin")),
):
    """Добавляет новый тег в общий справочник платформы."""
    tag_name = validate_tag_name(payload.name)
    existing_tag = db.query(models.Tag).filter(models.Tag.name.ilike(tag_name)).first()
    if existing_tag:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")

    ensure_tag_catalog_limit(db, payload.category)

    tag = models.Tag(name=tag_name, category=payload.category)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("curator", "admin")),
):
    """Удаляет тег из справочника, если он не используется в карточках возможностей."""
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    in_use = db.query(models.Opportunity).filter(models.Opportunity.tags.any(models.Tag.id == tag_id)).first()
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя удалить тег, пока он используется в карточках возможностей.",
        )

    db.delete(tag)
    db.commit()
