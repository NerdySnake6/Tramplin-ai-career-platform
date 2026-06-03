"""SQLAlchemy-модели домена платформы «Трамплин»."""

from datetime import UTC, datetime
from typing import List, Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Float, Boolean, Table, Column
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now_naive() -> datetime:
    """Возвращает текущее UTC-время без timezone для SQLite DateTime."""
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    """Базовый класс для всех моделей"""
    pass


# Связующая таблица многие-ко-многим: Opportunity <-> Tag
opportunity_tag = Table(
    "opportunity_tag",
    Base.metadata,
    Column("opportunity_id", ForeignKey("opportunities.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class User(Base):
    """Пользователь платформы (соискатель, работодатель, куратор)"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))
    
    # Роль: applicant (соискатель), employer (работодатель), curator (куратор), admin (админ)
    role: Mapped[str] = mapped_column(String(20), default="applicant")
    
    # Статусы
    is_active: Mapped[bool] = mapped_column(default=True)
    is_verified: Mapped[bool] = mapped_column(default=True)  # для работодателей
    is_email_verified: Mapped[bool] = mapped_column(default=True)
    email_verification_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email_verification_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Метаданные
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    
    # Связи
    # Профиль соискателя (если роль applicant)
    applicant_profile: Mapped[Optional["ApplicantProfile"]] = relationship(back_populates="user", uselist=False)
    
    # Профиль работодателя (если роль employer)
    employer_profile: Mapped[Optional["EmployerProfile"]] = relationship(back_populates="user", uselist=False)
    
    # Вакансии/мероприятия созданные пользователем (для работодателей)
    opportunities: Mapped[List["Opportunity"]] = relationship(back_populates="employer")

    # AI-проверки, запущенные пользователем как куратором или администратором
    ai_moderation_reviews: Mapped[List["AIModerationReview"]] = relationship(back_populates="reviewer")
    
    # Отклики пользователя (для соискателей)
    responses: Mapped[List["Response"]] = relationship(back_populates="applicant")

    # Рекомендации, которые пользователь отправил контактам
    sent_recommendations: Mapped[List["Recommendation"]] = relationship(
        foreign_keys="Recommendation.recommender_id",
        back_populates="recommender",
    )

    # Рекомендации, которые пользователь получил от контактов
    received_recommendations: Mapped[List["Recommendation"]] = relationship(
        foreign_keys="Recommendation.recommended_user_id",
        back_populates="recommended_user",
    )
    
    # Нетворкинг: контакты, где пользователь инициатор
    sent_contacts: Mapped[List["Contact"]] = relationship(foreign_keys="Contact.requester_id", back_populates="requester")
    
    # Нетворкинг: контакты, где пользователь получатель
    received_contacts: Mapped[List["Contact"]] = relationship(foreign_keys="Contact.addressee_id", back_populates="addressee")


class ApplicantProfile(Base):
    """Профиль соискателя (студента/выпускника)"""
    __tablename__ = "applicant_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    
    # Основная информация
    full_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    university: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    course_or_year: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # "3 курс" или "2024 выпуск"
    
    # Резюме/портфолио
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    skills: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON строка или просто текст
    experience: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    github_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    portfolio_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    # Приватность
    is_profile_public: Mapped[bool] = mapped_column(default=False)  # виден ли профиль другим соискателям
    show_responses: Mapped[bool] = mapped_column(default=False)    # видны ли отклики другим
    
    # Связь
    user: Mapped["User"] = relationship(back_populates="applicant_profile")


class EmployerProfile(Base):
    """Профиль работодателя (компании)"""
    __tablename__ = "employer_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    
    # Информация о компании
    company_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # сфера деятельности
    website: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    social_links: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON с ссылками
    
    # Локация (для карты)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    
    # Связь
    user: Mapped["User"] = relationship(back_populates="employer_profile")


class Tag(Base):
    """Теги для навыков, технологий, уровней"""
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(30))  # "tech", "level", "employment_type", "format"
    
    # Связь многие-ко-многим с возможностями
    opportunities: Mapped[List["Opportunity"]] = relationship(secondary=opportunity_tag, back_populates="tags")


class Opportunity(Base):
    """Вакансия, стажировка, менторство или мероприятие"""
    __tablename__ = "opportunities"

    id: Mapped[int] = mapped_column(primary_key=True)
    employer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    
    # Основная информация
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    
    # Тип: internship, job, mentorship, event
    type: Mapped[str] = mapped_column(String(20))
    
    # Формат: office, hybrid, remote
    work_format: Mapped[str] = mapped_column(String(20))
    
    # Локация
    location: Mapped[str] = mapped_column(String(300))  # адрес или "Удаленно"
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # широта для карты
    lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # долгота для карты
    
    # Зарплата/вознаграждение
    salary_range: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Даты
    published_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # срок действия
    event_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # для мероприятий
    
    # Статус
    is_active: Mapped[bool] = mapped_column(default=True)
    is_featured: Mapped[bool] = mapped_column(default=False)  # выделенная на главной
    
    # Связи
    employer: Mapped["User"] = relationship(back_populates="opportunities")
    tags: Mapped[List["Tag"]] = relationship(secondary=opportunity_tag, back_populates="opportunities")
    responses: Mapped[List["Response"]] = relationship(back_populates="opportunity")
    recommendations: Mapped[List["Recommendation"]] = relationship(back_populates="opportunity")
    ai_moderation_reviews: Mapped[List["AIModerationReview"]] = relationship(back_populates="opportunity")

    @property
    def employer_name(self) -> str:
        """Возвращает название компании или отображаемое имя работодателя."""
        if self.employer and self.employer.employer_profile and self.employer.employer_profile.company_name:
            return self.employer.employer_profile.company_name
        if self.employer:
            return self.employer.display_name
        return "Работодатель"

    @property
    def employer_is_verified(self) -> bool:
        """Возвращает статус верификации работодателя."""
        if self.employer:
            return self.employer.is_verified
        return True


class Response(Base):
    """Отклик соискателя на вакансию/мероприятие"""
    __tablename__ = "responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    applicant_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    opportunity_id: Mapped[int] = mapped_column(ForeignKey("opportunities.id"))
    
    # Статус: pending, accepted, rejected, reserve
    status: Mapped[str] = mapped_column(String(20), default="pending")
    
    # Сопроводительное письмо/комментарий
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)
    
    # Связи
    applicant: Mapped["User"] = relationship(back_populates="responses")
    opportunity: Mapped["Opportunity"] = relationship(back_populates="responses")


class AIModerationReview(Base):
    """Сохраненная AI-проверка карточки возможности для аудита куратора."""
    __tablename__ = "ai_moderation_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    opportunity_id: Mapped[int] = mapped_column(ForeignKey("opportunities.id"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    risk_level: Mapped[str] = mapped_column(String(20))
    risk_sources: Mapped[str] = mapped_column(Text, default="[]")
    rule_matches: Mapped[str] = mapped_column(Text, default="[]")
    model: Mapped[str] = mapped_column(String(120))
    duration_ms: Mapped[Optional[int]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    opportunity: Mapped["Opportunity"] = relationship(back_populates="ai_moderation_reviews")
    reviewer: Mapped["User"] = relationship(back_populates="ai_moderation_reviews")


class Contact(Base):
    """Нетворкинг: связь между соискателями"""
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    
    # Статус: pending, accepted, declined
    status: Mapped[str] = mapped_column(String(20), default="pending")
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Связи
    requester: Mapped["User"] = relationship(foreign_keys=[requester_id], back_populates="sent_contacts")
    addressee: Mapped["User"] = relationship(foreign_keys=[addressee_id], back_populates="received_contacts")


class Recommendation(Base):
    """Рекомендация возможности одному из профессиональных контактов."""
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    recommender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    recommended_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    opportunity_id: Mapped[int] = mapped_column(ForeignKey("opportunities.id"))
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    recommender: Mapped["User"] = relationship(
        foreign_keys=[recommender_id],
        back_populates="sent_recommendations",
    )
    recommended_user: Mapped["User"] = relationship(
        foreign_keys=[recommended_user_id],
        back_populates="received_recommendations",
    )
    opportunity: Mapped["Opportunity"] = relationship(back_populates="recommendations")
