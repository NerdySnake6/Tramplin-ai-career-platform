import os
import sys
from pathlib import Path

# Добавляем backend в sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, ApplicantProfile, EmployerProfile, Tag, Opportunity, Response, Contact, Recommendation, opportunity_tag

# Инициализируем engines
sqlite_url = "sqlite:///../tramplin_backup.db"
postgres_url = os.getenv("TRAMPLIN_DATABASE_URL") or os.getenv("DATABASE_URL")

if not postgres_url:
    print("Ошибка: Переменная TRAMPLIN_DATABASE_URL или DATABASE_URL не задана!")
    sys.exit(1)

# Заменяем postgres:// на postgresql:// если нужно
if postgres_url.startswith("postgres://"):
    postgres_url = postgres_url.replace("postgres://", "postgresql://", 1)

print(f"Подключение к SQLite: {sqlite_url}")
print(f"Подключение к PostgreSQL: {postgres_url}")

engine_sqlite = create_engine(sqlite_url)
engine_pg = create_engine(postgres_url)

SessionSqlite = sessionmaker(bind=engine_sqlite)
SessionPg = sessionmaker(bind=engine_pg)

session_sqlite = SessionSqlite()
session_pg = SessionPg()

try:
    # 1. Миграция тегов (Tags)
    print("Миграция тегов...")
    tags = session_sqlite.query(Tag).all()
    for tag in tags:
        # Проверяем, существует ли уже тег
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
                created_at=user.created_at
            )
            session_pg.add(new_user)
    session_pg.commit()

    # 3. Миграция профилей соискателей (ApplicantProfiles)
    print("Миграция профилей соискателей...")
    aps = session_sqlite.query(ApplicantProfile).all()
    for ap in aps:
        if not session_pg.query(ApplicantProfile).filter_by(id=ap.id).first():
            new_ap = ApplicantProfile(
                id=ap.id,
                user_id=ap.user_id,
                full_name=ap.full_name,
                university=ap.university,
                course_or_year=ap.course_or_year,
                bio=ap.bio,
                skills=ap.skills,
                experience=ap.experience,
                github_url=ap.github_url,
                portfolio_url=ap.portfolio_url,
                is_profile_public=ap.is_profile_public,
                show_responses=ap.show_responses
            )
            session_pg.add(new_ap)
    session_pg.commit()

    # 4. Миграция профилей работодателей (EmployerProfiles)
    print("Миграция профилей работодателей...")
    eps = session_sqlite.query(EmployerProfile).all()
    for ep in eps:
        if not session_pg.query(EmployerProfile).filter_by(id=ep.id).first():
            new_ep = EmployerProfile(
                id=ep.id,
                user_id=ep.user_id,
                company_name=ep.company_name,
                description=ep.description,
                industry=ep.industry,
                website=ep.website,
                social_links=ep.social_links,
                city=ep.city,
                address=ep.address
            )
            session_pg.add(new_ep)
    session_pg.commit()

    # 5. Миграция вакансий (Opportunities)
    print("Миграция вакансий...")
    opps = session_sqlite.query(Opportunity).all()
    for opp in opps:
        if not session_pg.query(Opportunity).filter_by(id=opp.id).first():
            new_opp = Opportunity(
                id=opp.id,
                employer_id=opp.employer_id,
                title=opp.title,
                description=opp.description,
                type=opp.type,
                work_format=opp.work_format,
                location=opp.location,
                lat=opp.lat,
                lng=opp.lng,
                salary_range=opp.salary_range,
                published_at=opp.published_at,
                expires_at=opp.expires_at,
                event_date=opp.event_date,
                is_active=opp.is_active,
                is_featured=opp.is_featured
            )
            session_pg.add(new_opp)
    session_pg.commit()

    # 6. Миграция связей Opportunity-Tag
    print("Миграция связей вакансий и тегов...")
    conn_sqlite = engine_sqlite.connect()
    conn_pg = engine_pg.connect()
    # Считываем из sqlite
    rows = conn_sqlite.execute(select(opportunity_tag)).all()
    for row in rows:
        # Проверяем, существует ли уже такая связь
        check = conn_pg.execute(
            select(opportunity_tag).where(
                opportunity_tag.c.opportunity_id == row.opportunity_id,
                opportunity_tag.c.tag_id == row.tag_id
            )
        ).first()
        if not check:
            conn_pg.execute(
                opportunity_tag.insert().values(
                    opportunity_id=row.opportunity_id,
                    tag_id=row.tag_id
                )
            )
    conn_pg.commit()
    conn_sqlite.close()
    conn_pg.close()

    # 7. Миграция откликов (Responses)
    print("Миграция откликов...")
    resps = session_sqlite.query(Response).all()
    for resp in resps:
        if not session_pg.query(Response).filter_by(id=resp.id).first():
            new_resp = Response(
                id=resp.id,
                applicant_id=resp.applicant_id,
                opportunity_id=resp.opportunity_id,
                status=resp.status,
                cover_letter=resp.cover_letter,
                created_at=resp.created_at,
                updated_at=resp.updated_at
            )
            session_pg.add(new_resp)
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
                accepted_at=contact.accepted_at
            )
            session_pg.add(new_contact)
    session_pg.commit()

    # 9. Миграция рекомендаций (Recommendations)
    print("Миграция рекомендаций...")
    recoms = session_sqlite.query(Recommendation).all()
    for recom in recoms:
        if not session_pg.query(Recommendation).filter_by(id=recom.id).first():
            new_recom = Recommendation(
                id=recom.id,
                recommender_id=recom.recommender_id,
                recommended_user_id=recom.recommended_user_id,
                opportunity_id=recom.opportunity_id,
                message=recom.message,
                created_at=recom.created_at
            )
            session_pg.add(new_recom)
    session_pg.commit()

    print("Миграция успешно завершена!")

except Exception as e:
    session_pg.rollback()
    print(f"Произошла ошибка при миграции: {e}")
    raise e
finally:
    session_sqlite.close()
    session_pg.close()
