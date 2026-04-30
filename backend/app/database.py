"""Настройка подключения к базе данных и фабрики сессий."""

import os
from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker, Session

from app import models
from app.auth import get_password_hash
from app.models import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_CONFIG_PATH = BACKEND_DIR / "alembic.ini"
DATABASE_PATH = Path(os.getenv("TRAMPLIN_DATABASE_PATH", BACKEND_DIR / "tramplin.db")).resolve()
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

DEFAULT_TAGS = [
    {"name": "Python", "category": "tech"},
    {"name": "Java", "category": "tech"},
    {"name": "JavaScript", "category": "tech"},
    {"name": "SQL", "category": "tech"},
    {"name": "React", "category": "tech"},
    {"name": "FastAPI", "category": "tech"},
    {"name": "Junior", "category": "level"},
    {"name": "Middle", "category": "level"},
    {"name": "Стажировка", "category": "employment_type"},
    {"name": "Частичная занятость", "category": "employment_type"},
    {"name": "Полная занятость", "category": "employment_type"},
    {"name": "Проектная работа", "category": "employment_type"},
]

REQUIRED_TABLES = {
    "users",
    "applicant_profiles",
    "employer_profiles",
    "tags",
    "opportunities",
    "responses",
    "contacts",
    "recommendations",
    "opportunity_tag",
}


@lru_cache(maxsize=1)
def get_expected_alembic_revisions() -> set[str]:
    """Возвращает актуальные head-ревизии из локального каталога миграций."""
    config = Config(str(ALEMBIC_CONFIG_PATH))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return set(ScriptDirectory.from_config(config).get_heads())


def get_current_alembic_revisions() -> set[str]:
    """Читает примененные Alembic-ревизии из таблицы alembic_version."""
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT version_num FROM alembic_version")).all()
    return {row[0] for row in rows}


def get_db() -> Session:
    """Предоставляет SQLAlchemy-сессию на время текущего запроса."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Проверяет схему и ревизию БД, затем добавляет стартовые данные."""
    existing_tables = set(inspect(engine).get_table_names())
    missing_tables = REQUIRED_TABLES - existing_tables
    if missing_tables:
        missing = ", ".join(sorted(missing_tables))
        raise RuntimeError(
            "Схема базы данных не инициализирована. "
            "Сначала примени миграции Alembic командой "
            "`cd backend && source venv/bin/activate && python3 -m alembic upgrade head`. "
            f"Отсутствуют таблицы: {missing}."
        )
    if "alembic_version" not in existing_tables:
        raise RuntimeError(
            "Схема базы данных создана без Alembic-метаданных. "
            "Похоже, таблицы были подняты напрямую через create_all(). "
            "Сначала пересоздай базу или примени миграции командой "
            "`cd backend && source venv/bin/activate && python3 -m alembic upgrade head`."
        )

    expected_revisions = get_expected_alembic_revisions()
    current_revisions = get_current_alembic_revisions()
    if current_revisions != expected_revisions:
        raise RuntimeError(
            "Схема базы данных не соответствует актуальной ревизии Alembic. "
            "Сначала примени миграции командой "
            "`cd backend && source venv/bin/activate && python3 -m alembic upgrade head`. "
            f"Ожидались ревизии: {', '.join(sorted(expected_revisions))}; "
            f"найдены: {', '.join(sorted(current_revisions)) or 'нет данных'}."
        )

    seed_default_tags()
    seed_default_admin()


def seed_default_tags():
    """Добавляет стартовый справочник тегов, если их еще нет в базе."""
    db = SessionLocal()
    try:
        existing_names = {
            row[0]
            for row in db.query(models.Tag.name).all()
        }
        missing_tags = [
            models.Tag(name=item["name"], category=item["category"])
            for item in DEFAULT_TAGS
            if item["name"] not in existing_names
        ]
        if missing_tags:
            db.add_all(missing_tags)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
    finally:
        db.close()


def seed_default_admin():
    """Создает администратора из переменных окружения, если его еще нет в базе."""
    db = SessionLocal()
    try:
        existing_admin = (
            db.query(models.User)
            .filter(models.User.role == "admin")
            .first()
        )
        if existing_admin:
            return

        admin_email = (os.getenv("TRAMPLIN_ADMIN_EMAIL") or "").strip()
        admin_password = os.getenv("TRAMPLIN_ADMIN_PASSWORD")
        admin_name = (os.getenv("TRAMPLIN_ADMIN_NAME") or "Администратор").strip() or "Администратор"
        if not admin_email or not admin_password:
            return

        admin_user = models.User(
            email=admin_email,
            hashed_password=get_password_hash(admin_password),
            display_name=admin_name,
            role="admin",
            is_active=True,
            is_verified=True,
            is_email_verified=True,
        )
        db.add(admin_user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    finally:
        db.close()
