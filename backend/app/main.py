"""Точка входа FastAPI-приложения проекта «Трамплин»."""

from contextlib import asynccontextmanager
from pathlib import Path
import os

from fastapi import FastAPI


def load_local_env() -> None:
    """Подгружает переменные из backend/.env без внешних зависимостей."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()

from app.database import init_db
from app.routers import (
    auth,
    contacts,
    curator,
    map,
    opportunities,
    profiles,
    recommendations,
    responses,
    seo,
    tags,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Инициализирует приложение при старте, и освобождает ресурсы при завершении."""
    init_db()
    yield

app = FastAPI(
    title="Трамплин",
    description="Платформа для студентов и работодателей",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(curator.router)
app.include_router(map.router)
app.include_router(opportunities.router)
app.include_router(profiles.router)
app.include_router(recommendations.router)
app.include_router(responses.router)
app.include_router(seo.router)
app.include_router(tags.router)

@app.get("/")
def root():
    """Возвращает сообщение о том, что API запущен."""
    return {"message": "Трамплин API работает!"}

@app.get("/health")
def health_check():
    """Возвращает простой ответ для проверки доступности сервиса."""
    return {"status": "ok"}
