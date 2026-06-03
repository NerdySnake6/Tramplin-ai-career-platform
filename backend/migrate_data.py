"""Переносит данные из SQLite-бэкапа в PostgreSQL."""

import os
import sys
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import sessionmaker

# Добавляем backend в sys.path, чтобы скрипт работал и локально, и внутри Docker.
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.models import (  # noqa: E402
    ApplicantProfile,
    Contact,
    EmployerProfile,
    Opportunity,
    Recommendation,
    Response,
    Tag,
    User,
    opportunity_tag,
)

SQLITE_BACKUP_PATH_ENV = "TRAMPLIN_SQLITE_BACKUP_PATH"
SQLITE_BACKUP_URL_ENV = "TRAMPLIN_SQLITE_BACKUP_URL"
DEFAULT_SQLITE_BACKUP_PATH = backend_dir.parent / "tramplin_backup.db"

SEQUENCED_MODELS = (
    Tag,
    User,
    ApplicantProfile,
    EmployerProfile,
    Opportunity,
    Response,
    Contact,
    Recommendation,
)


def normalize_postgres_url(url: str | None) -> str:
    """Возвращает корректный SQLAlchemy URL для PostgreSQL."""
    if not url:
        raise RuntimeError("Переменная TRAMPLIN_DATABASE_URL или DATABASE_URL не задана.")
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def sqlite_url_from_environment() -> str:
    """Возвращает SQLAlchemy URL SQLite-бэкапа из окружения или дефолтного пути."""
    explicit_url = os.getenv(SQLITE_BACKUP_URL_ENV)
    if explicit_url:
        return explicit_url

    backup_path = Path(
        os.getenv(SQLITE_BACKUP_PATH_ENV, str(DEFAULT_SQLITE_BACKUP_PATH))
    ).expanduser()
    if not backup_path.is_absolute():
        backup_path = (Path.cwd() / backup_path).resolve()

    if not backup_path.exists():
        raise RuntimeError(
            f"SQLite-бэкап не найден: {backup_path}. "
            f"Укажи путь через {SQLITE_BACKUP_PATH_ENV} или URL через {SQLITE_BACKUP_URL_ENV}."
        )

    return f"sqlite:///{backup_path}"


def reset_postgres_sequences(connection: Connection, model_classes: Iterable[type]) -> None:
    """Синхронизирует PostgreSQL sequences после вставки записей с явными id."""
    if connection.dialect.name != "postgresql":
        return

    preparer = connection.dialect.identifier_preparer

    for model_class in model_classes:
        table = model_class.__table__
        if "id" not in table.c:
            continue

        table_name = table.name if not table.schema else f"{table.schema}.{table.name}"
        sequence_name = connection.execute(
            text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
            {"table_name": table_name, "column_name": "id"},
        ).scalar()

        if not sequence_name:
            continue

        quoted_table = preparer.format_table(table)
        quoted_column = preparer.quote("id")
        max_id = connection.execute(
            text(f"SELECT COALESCE(MAX({quoted_column}), 0) FROM {quoted_table}")
        ).scalar_one()
        next_id = int(max_id) + 1

        connection.execute(
            text("SELECT setval(CAST(:sequence_name AS regclass), :next_id, false)"),
            {"sequence_name": sequence_name, "next_id": next_id},
        )
        print(f"Sequence обновлена: {table.name}.id -> {next_id}")


def main() -> int:
    """Запускает перенос данных из SQLite в PostgreSQL."""
    sqlite_url = sqlite_url_from_environment()
    postgres_url = normalize_postgres_url(
        os.getenv("TRAMPLIN_DATABASE_URL") or os.getenv("DATABASE_URL")
    )

    print(f"Подключение к SQLite: {sqlite_url}")
    print(f"Подключение к PostgreSQL: {postgres_url}")

    engine_sqlite = create_engine(sqlite_url)
    engine_pg = create_engine(postgres_url)

    session_sqlite = sessionmaker(bind=engine_sqlite)()
    session_pg = sessionmaker(bind=engine_pg)()

    try:
        # 1. Миграция тегов (Tags)
        print("Миграция тегов...")
        tags = session_sqlite.query(Tag).all()
        for tag in tags:
            if not session_pg.query(Tag).filter_by(id=tag.id).first():
                new_tag = Tag(id=tag.id, name=tag.name, category=tag.category)
                session_pg.add(new_tag)
        session_pg.commit()

        # 2. Миграция пользователей (Users)
        print("Миграция пользователей...")
        users = session_sqlite.query(User).all()
        for user in users:
            if not session_pg.query(User).filter_by(id=user.id).first():
                new_user = User(
                    id=user.id,
                    email=user.email,
                    hashed_password=user.hashed_password,
                    display_name=user.display_name,
                    role=user.role,
                    is_active=user.is_active,
                    is_verified=user.is_verified,
                    is_email_verified=user.is_email_verified,
                    email_verification_token_hash=user.email_verification_token_hash,
                    email_verification_sent_at=user.email_verification_sent_at,
                    email_verified_at=user.email_verified_at,
                    created_at=user.created_at,
                )
                session_pg.add(new_user)
        session_pg.commit()

        # 3. Миграция профилей соискателей (ApplicantProfiles)
        print("Миграция профилей соискателей...")
        applicant_profiles = session_sqlite.query(ApplicantProfile).all()
        for applicant_profile in applicant_profiles:
            if not session_pg.query(ApplicantProfile).filter_by(id=applicant_profile.id).first():
                new_applicant_profile = ApplicantProfile(
                    id=applicant_profile.id,
                    user_id=applicant_profile.user_id,
                    full_name=applicant_profile.full_name,
                    university=applicant_profile.university,
                    course_or_year=applicant_profile.course_or_year,
                    bio=applicant_profile.bio,
                    skills=applicant_profile.skills,
                    experience=applicant_profile.experience,
                    github_url=applicant_profile.github_url,
                    portfolio_url=applicant_profile.portfolio_url,
                    is_profile_public=applicant_profile.is_profile_public,
                    show_responses=applicant_profile.show_responses,
                )
                session_pg.add(new_applicant_profile)
        session_pg.commit()

        # 4. Миграция профилей работодателей (EmployerProfiles)
        print("Миграция профилей работодателей...")
        employer_profiles = session_sqlite.query(EmployerProfile).all()
        for employer_profile in employer_profiles:
            if not session_pg.query(EmployerProfile).filter_by(id=employer_profile.id).first():
                new_employer_profile = EmployerProfile(
                    id=employer_profile.id,
                    user_id=employer_profile.user_id,
                    company_name=employer_profile.company_name,
                    description=employer_profile.description,
                    industry=employer_profile.industry,
                    website=employer_profile.website,
                    social_links=employer_profile.social_links,
                    city=employer_profile.city,
                    address=employer_profile.address,
                )
                session_pg.add(new_employer_profile)
        session_pg.commit()

        # 5. Миграция вакансий (Opportunities)
        print("Миграция вакансий...")
        opportunities = session_sqlite.query(Opportunity).all()
        for opportunity in opportunities:
            if not session_pg.query(Opportunity).filter_by(id=opportunity.id).first():
                new_opportunity = Opportunity(
                    id=opportunity.id,
                    employer_id=opportunity.employer_id,
                    title=opportunity.title,
                    description=opportunity.description,
                    type=opportunity.type,
                    work_format=opportunity.work_format,
                    location=opportunity.location,
                    lat=opportunity.lat,
                    lng=opportunity.lng,
                    salary_range=opportunity.salary_range,
                    published_at=opportunity.published_at,
                    expires_at=opportunity.expires_at,
                    event_date=opportunity.event_date,
                    is_active=opportunity.is_active,
                    is_featured=opportunity.is_featured,
                )
                session_pg.add(new_opportunity)
        session_pg.commit()

        # 6. Миграция связей Opportunity-Tag
        print("Миграция связей вакансий и тегов...")
        with engine_sqlite.connect() as conn_sqlite, engine_pg.connect() as conn_pg:
            rows = conn_sqlite.execute(select(opportunity_tag)).all()
            for row in rows:
                check = conn_pg.execute(
                    select(opportunity_tag).where(
                        opportunity_tag.c.opportunity_id == row.opportunity_id,
                        opportunity_tag.c.tag_id == row.tag_id,
                    )
                ).first()
                if not check:
                    conn_pg.execute(
                        opportunity_tag.insert().values(
                            opportunity_id=row.opportunity_id,
                            tag_id=row.tag_id,
                        )
                    )
            conn_pg.commit()

        # 7. Миграция откликов (Responses)
        print("Миграция откликов...")
        responses = session_sqlite.query(Response).all()
        for response in responses:
            if not session_pg.query(Response).filter_by(id=response.id).first():
                new_response = Response(
                    id=response.id,
                    applicant_id=response.applicant_id,
                    opportunity_id=response.opportunity_id,
                    status=response.status,
                    cover_letter=response.cover_letter,
                    created_at=response.created_at,
                    updated_at=response.updated_at,
                )
                session_pg.add(new_response)
        session_pg.commit()

        # 8. Миграция контактов (Contacts)
        print("Миграция контактов...")
        contacts = session_sqlite.query(Contact).all()
        for contact in contacts:
            if not session_pg.query(Contact).filter_by(id=contact.id).first():
                new_contact = Contact(
                    id=contact.id,
                    requester_id=contact.requester_id,
                    addressee_id=contact.addressee_id,
                    status=contact.status,
                    created_at=contact.created_at,
                    accepted_at=contact.accepted_at,
                )
                session_pg.add(new_contact)
        session_pg.commit()

        # 9. Миграция рекомендаций (Recommendations)
        print("Миграция рекомендаций...")
        recommendations = session_sqlite.query(Recommendation).all()
        for recommendation in recommendations:
            if not session_pg.query(Recommendation).filter_by(id=recommendation.id).first():
                new_recommendation = Recommendation(
                    id=recommendation.id,
                    recommender_id=recommendation.recommender_id,
                    recommended_user_id=recommendation.recommended_user_id,
                    opportunity_id=recommendation.opportunity_id,
                    message=recommendation.message,
                    created_at=recommendation.created_at,
                )
                session_pg.add(new_recommendation)
        session_pg.commit()

        with engine_pg.begin() as connection:
            reset_postgres_sequences(connection, SEQUENCED_MODELS)

        print("Миграция успешно завершена!")
        return 0

    except Exception as exc:
        session_pg.rollback()
        print(f"Произошла ошибка при миграции: {exc}")
        raise
    finally:
        session_sqlite.close()
        session_pg.close()


if __name__ == "__main__":
    raise SystemExit(main())
