"""Общие фикстуры для интеграционных тестов backend."""

from argparse import Namespace
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient

from app import auth, database
from app.main import app
from app.routers import auth as auth_router


def build_alembic_config(db_url: str) -> Config:
    """Создает Alembic-конфиг для временной SQLite-базы в тестах."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.cmd_opts = Namespace(x=[f"db_url={db_url}"])
    return config


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Создает тестовый клиент с отдельной временной базой SQLite."""
    db_path = tmp_path / "test_tramplin.db"
    db_url = f"sqlite:///{db_path}"
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
    )
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    monkeypatch.setattr(database, "SQLALCHEMY_DATABASE_URL", db_url)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", session_local)
    monkeypatch.setattr(auth, "SECRET_KEY", "test-secret-key")
    monkeypatch.delenv("TRAMPLIN_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("TRAMPLIN_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("TRAMPLIN_ADMIN_NAME", raising=False)
    monkeypatch.delenv("TRAMPLIN_AUTO_VERIFY_EMPLOYERS", raising=False)

    app.state.email_verification_tokens = {}

    def fake_send_verification_email(*, to_email, verification_url, **_):
        token = parse_qs(urlparse(verification_url).query)["token"][0]
        app.state.email_verification_tokens[to_email] = token

    monkeypatch.setattr(auth_router, "send_verification_email", fake_send_verification_email)

    command.upgrade(build_alembic_config(db_url), "head")

    with TestClient(app) as test_client:
        yield test_client

    engine.dispose()


@pytest.fixture()
def db_session():
    """Возвращает SQLAlchemy-сессию для прямой подготовки тестовых данных."""
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()
