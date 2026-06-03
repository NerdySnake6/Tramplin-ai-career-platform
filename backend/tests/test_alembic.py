"""Тесты для Alembic-миграций и инициализации схемы БД."""

from argparse import Namespace
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import database, models


BACKEND_DIR = Path(__file__).resolve().parents[1]
HEAD_REVISION = "c8f2a1d4b6e9"


def build_alembic_config(db_url: str) -> Config:
    """Создает Alembic-конфиг для временной SQLite-базы в тесте."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.cmd_opts = Namespace(x=[f"db_url={db_url}"])
    return config


def configure_test_database(tmp_path, monkeypatch):
    """Подменяет engine и session factory на временную SQLite-базу."""
    db_path = tmp_path / "alembic_test.db"
    db_url = f"sqlite:///{db_path}"
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
    )
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    monkeypatch.setattr(database, "SQLALCHEMY_DATABASE_URL", db_url)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", session_local)
    monkeypatch.delenv("TRAMPLIN_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("TRAMPLIN_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("TRAMPLIN_ADMIN_NAME", raising=False)

    return engine, db_url


def make_integrity_error() -> IntegrityError:
    """Создает тестовый IntegrityError для имитации гонки сидеров."""
    return IntegrityError("INSERT", {}, Exception("unique constraint"))


def test_init_db_requires_applied_migrations(tmp_path, monkeypatch):
    """Проверяет, что init_db не поднимает схему сам и требует Alembic-миграций."""
    engine, _ = configure_test_database(tmp_path, monkeypatch)

    with pytest.raises(RuntimeError, match="alembic upgrade head"):
        database.init_db()

    engine.dispose()


def test_default_postgres_url():
    """Проверяет, что дефолтный URL базы данных ведет на PostgreSQL."""
    assert database.SQLALCHEMY_DATABASE_URL.startswith("postgresql://")


def test_init_db_rejects_schema_created_via_create_all(tmp_path, monkeypatch):
    """Проверяет, что create_all без alembic_version больше не считается валидной схемой."""
    engine, _ = configure_test_database(tmp_path, monkeypatch)

    models.Base.metadata.create_all(bind=engine)

    with pytest.raises(RuntimeError, match="create_all"):
        database.init_db()

    engine.dispose()


def test_alembic_upgrade_head_creates_schema_and_bootstrap_data(tmp_path, monkeypatch):
    """Проверяет, что Alembic создает схему, а init_db безопасно сидирует стартовые данные."""
    engine, db_url = configure_test_database(tmp_path, monkeypatch)
    alembic_config = build_alembic_config(db_url)

    command.upgrade(alembic_config, "head")

    database.init_db()
    database.init_db()

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    assert database.REQUIRED_TABLES <= existing_tables
    assert "alembic_version" in existing_tables

    with engine.connect() as connection:
        current_revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
    assert current_revision == HEAD_REVISION

    session = database.SessionLocal()
    try:
        assert session.query(models.Tag).count() == len(database.DEFAULT_TAGS)
        admins = session.query(models.User).filter(models.User.role == "admin").all()
        assert admins == []
    finally:
        session.close()
        engine.dispose()


def test_init_db_seeds_admin_only_from_explicit_environment(tmp_path, monkeypatch):
    """Проверяет, что администратор создается только из явных переменных окружения."""
    engine, db_url = configure_test_database(tmp_path, monkeypatch)
    alembic_config = build_alembic_config(db_url)
    monkeypatch.setenv("TRAMPLIN_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("TRAMPLIN_ADMIN_PASSWORD", "supersecret")
    monkeypatch.setenv("TRAMPLIN_ADMIN_NAME", "Администратор")

    command.upgrade(alembic_config, "head")
    database.init_db()

    session = database.SessionLocal()
    try:
        admins = session.query(models.User).filter(models.User.role == "admin").all()
        assert len(admins) == 1
        assert admins[0].email == "admin@example.com"
    finally:
        session.close()
        engine.dispose()


def test_email_verification_migration_keeps_existing_users_enabled(tmp_path, monkeypatch):
    """Проверяет, что миграция не блокирует уже созданные аккаунты."""
    engine, db_url = configure_test_database(tmp_path, monkeypatch)
    alembic_config = build_alembic_config(db_url)

    command.upgrade(alembic_config, "a7a8aa0eae8f")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users (
                    email, hashed_password, display_name, role,
                    is_active, is_verified, created_at
                )
                VALUES (
                    'existing@example.com', 'hash', 'Existing User', 'applicant',
                    1, 1, '2026-04-30 00:00:00'
                )
                """
            )
        )

    command.upgrade(alembic_config, "head")

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT is_email_verified FROM users WHERE email = 'existing@example.com'")
        ).first()
    assert row is not None
    assert row[0] is True or row[0] == 1

    engine.dispose()


def test_init_db_rejects_outdated_alembic_revision(tmp_path, monkeypatch):
    """Проверяет, что init_db валидирует не только таблицы, но и актуальную ревизию Alembic."""
    engine, db_url = configure_test_database(tmp_path, monkeypatch)
    alembic_config = build_alembic_config(db_url)

    command.upgrade(alembic_config, "head")

    with engine.begin() as connection:
        connection.execute(
            text("UPDATE alembic_version SET version_num = :revision"),
            {"revision": "stale-revision"},
        )

    with pytest.raises(RuntimeError, match="актуальной ревизии Alembic"):
        database.init_db()

    engine.dispose()


def test_seed_default_tags_handles_integrity_error(monkeypatch):
    """Проверяет, что сидер тегов не падает при конкурентной вставке."""
    session = Mock()
    session.query.return_value.all.return_value = []
    session.commit.side_effect = make_integrity_error()

    monkeypatch.setattr(database, "SessionLocal", lambda: session)

    database.seed_default_tags()

    session.add_all.assert_called_once()
    session.rollback.assert_called_once()
    session.close.assert_called_once()


def test_seed_default_admin_handles_integrity_error(monkeypatch):
    """Проверяет, что сидер администратора не падает при конкурентной вставке."""
    session = Mock()
    session.query.return_value.filter.return_value.first.return_value = None
    session.commit.side_effect = make_integrity_error()

    monkeypatch.setattr(database, "SessionLocal", lambda: session)
    monkeypatch.setenv("TRAMPLIN_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("TRAMPLIN_ADMIN_PASSWORD", "supersecret")

    database.seed_default_admin()

    session.add.assert_called_once()
    session.rollback.assert_called_once()
    session.close.assert_called_once()
