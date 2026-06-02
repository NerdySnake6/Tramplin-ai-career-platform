"""Интеграционные тесты AI-помощников."""

from datetime import timedelta

from app import auth, models
from app.routers import ai as ai_router


def confirm_registered_email(client, email):
    """Подтверждает email пользователя через тестовый token."""
    token = client.app.state.email_verification_tokens[email]
    response = client.get(f"/auth/verify-email?token={token}", follow_redirects=False)
    assert response.status_code == 303


def register_and_login(client, *, email, role="applicant"):
    """Регистрирует пользователя, подтверждает email и возвращает auth headers."""
    register_response = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret",
            "display_name": email.split("@")[0],
            "role": role,
        },
    )
    assert register_response.status_code == 201
    confirm_registered_email(client, email)

    login_response = client.post(
        "/auth/login",
        data={"username": email, "password": "supersecret"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_service_user(db_session, *, email, role):
    """Создает служебного пользователя для ролей, недоступных публичной регистрации."""
    user = models.User(
        email=email,
        hashed_password=auth.get_password_hash("supersecret"),
        display_name=email.split("@")[0],
        role=role,
        is_active=True,
        is_verified=True,
        is_email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def login_existing_user(client, *, email):
    """Возвращает auth headers для заранее созданного пользователя."""
    login_response = client.post(
        "/auth/login",
        data={"username": email, "password": "supersecret"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def enable_ai(monkeypatch):
    """Включает AI-интеграцию для теста."""
    monkeypatch.setenv("AI_FEATURES_ENABLED", "true")
    monkeypatch.setenv("POLZA_API_KEY", "test-key")
    monkeypatch.setenv("POLZA_MODEL", "test-model")
    ai_router._user_request_log.clear()


def test_ai_status_reflects_configuration(client, monkeypatch):
    """Проверяет, что статус не раскрывает секреты и корректно отражает готовность."""
    monkeypatch.delenv("POLZA_API_KEY", raising=False)
    monkeypatch.setenv("AI_FEATURES_ENABLED", "false")

    disabled_response = client.get("/ai/status")
    assert disabled_response.status_code == 200
    assert disabled_response.json()["ready"] is False

    enable_ai(monkeypatch)
    enabled_response = client.get("/ai/status")
    assert enabled_response.status_code == 200
    payload = enabled_response.json()
    assert payload["enabled"] is True
    assert payload["configured"] is True
    assert payload["ready"] is True
    assert "test-key" not in str(payload)


def test_employer_can_use_opportunity_assist(client, db_session, monkeypatch):
    """Проверяет генерацию описания и сопоставление тегов из справочника."""
    enable_ai(monkeypatch)
    assert db_session.query(models.Tag).filter(models.Tag.name.in_(["Python", "Junior"])).count() == 2

    def fake_chat_json(messages, **_):
        assert "Доступные теги" in messages[-1]["content"]
        return {
            "description": "Стажировка для junior-разработчика с практикой Python, наставником и понятными задачами.",
            "summary": "Практика Python для начинающего разработчика.",
            "suggested_tag_names": ["Python", "Junior", "Несуществующий тег"],
            "warnings": ["Уточните длительность стажировки."],
        }

    monkeypatch.setattr(ai_router.ai_service, "call_chat_json", fake_chat_json)
    headers = register_and_login(client, email="ai-employer@example.com", role="employer")

    response = client.post(
        "/ai/opportunity-assist",
        headers=headers,
        json={
            "title": "Python internship",
            "description": "Нужен стажер.",
            "type": "internship",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "до 80 000",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == "Практика Python для начинающего разработчика."
    assert [tag["name"] for tag in payload["suggested_tags"]] == ["Python", "Junior"]


def test_applicant_cannot_use_opportunity_assist(client, monkeypatch):
    """Проверяет ролевой запрет для AI-помощника работодателя."""
    enable_ai(monkeypatch)
    headers = register_and_login(client, email="ai-applicant@example.com", role="applicant")

    response = client.post(
        "/ai/opportunity-assist",
        headers=headers,
        json={
            "title": "Python internship",
            "description": "Нужен стажер.",
            "type": "internship",
            "work_format": "remote",
            "location": "Москва",
        },
    )

    assert response.status_code == 403


def test_invalid_ai_json_returns_bad_gateway(client, monkeypatch):
    """Проверяет, что невалидный структурный ответ AI не ломает backend."""
    enable_ai(monkeypatch)
    monkeypatch.setattr(ai_router.ai_service, "call_chat_json", lambda *_args, **_kwargs: {"unexpected": "shape"})
    headers = register_and_login(client, email="bad-ai-employer@example.com", role="employer")

    response = client.post(
        "/ai/opportunity-assist",
        headers=headers,
        json={
            "title": "Python internship",
            "description": "Нужен стажер.",
            "type": "internship",
            "work_format": "remote",
            "location": "Москва",
        },
    )

    assert response.status_code == 502


def test_curator_can_request_moderation_review(client, db_session, monkeypatch):
    """Проверяет AI-подсказку для ручной модерации текущего состояния формы."""
    enable_ai(monkeypatch)
    curator = create_service_user(db_session, email="curator-ai@example.com", role="curator")
    employer = create_service_user(db_session, email="employer-for-review@example.com", role="employer")
    opportunity = models.Opportunity(
        employer_id=employer.id,
        title="Стажировка без опыта",
        description="Обещаем быстрый рост и интересные задачи для начинающих.",
        type="internship",
        work_format="remote",
        location="Москва",
        salary_range=None,
        expires_at=models.utc_now_naive() + timedelta(days=14),
    )
    db_session.add(opportunity)
    db_session.commit()

    def fake_moderation_chat_json(messages, **_kwargs):
        assert "Описание после несохраненной правки куратора" in messages[-1]["content"]
        assert "Статус публикации: неактивна" in messages[-1]["content"]
        return {
            "risk_level": "medium",
            "reasons": ["Не указано вознаграждение"],
            "checklist": ["Проверить юридическое лицо"],
            "recommended_action": "Запросить детали условий перед публикацией.",
        }

    monkeypatch.setattr(ai_router.ai_service, "call_chat_json", fake_moderation_chat_json)
    headers = login_existing_user(client, email=curator.email)

    response = client.post(
        "/ai/moderation-review",
        headers=headers,
        json={
            "opportunity_id": opportunity.id,
            "title": "Стажировка после правки",
            "type": "internship",
            "work_format": "remote",
            "location": "Москва",
            "salary_range": None,
            "description": "Описание после несохраненной правки куратора",
            "is_active": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["risk_level"] == "medium"
    db_session.refresh(opportunity)
    assert opportunity.is_active is True


def test_employer_cannot_request_moderation_review(client, db_session, monkeypatch):
    """Проверяет, что работодатель не может запускать AI-проверку куратора."""
    enable_ai(monkeypatch)
    employer = create_service_user(db_session, email="blocked-review-employer@example.com", role="employer")
    opportunity = models.Opportunity(
        employer_id=employer.id,
        title="Backend стажировка",
        description="Практика с наставником и понятными задачами.",
        type="internship",
        work_format="hybrid",
        location="Москва",
        expires_at=models.utc_now_naive() + timedelta(days=14),
    )
    db_session.add(opportunity)
    db_session.commit()
    headers = login_existing_user(client, email=employer.email)

    response = client.post(
        "/ai/moderation-review",
        headers=headers,
        json={"opportunity_id": opportunity.id},
    )

    assert response.status_code == 403


def test_applicant_can_generate_cover_letter(client, db_session, monkeypatch):
    """Проверяет генерацию сопроводительного письма для соискателя."""
    enable_ai(monkeypatch)
    headers = register_and_login(client, email="cover-ai-applicant@example.com", role="applicant")
    employer = create_service_user(db_session, email="cover-ai-employer@example.com", role="employer")
    opportunity = models.Opportunity(
        employer_id=employer.id,
        title="Frontend стажировка",
        description="Ищем стажера, который хочет развиваться во фронтенде.",
        type="internship",
        work_format="hybrid",
        location="Санкт-Петербург",
        salary_range="до 60 000",
        expires_at=models.utc_now_naive() + timedelta(days=14),
    )
    db_session.add(opportunity)
    db_session.commit()

    monkeypatch.setattr(
        ai_router.ai_service,
        "call_chat_json",
        lambda *_args, **_kwargs: {
            "cover_letter": "Здравствуйте! Хочу откликнуться на стажировку, потому что развиваюсь во фронтенде и готов быстро учиться.",
            "fit_reasons": ["Есть мотивация развиваться", "Подходит формат"],
            "gaps": ["Уточнить стек проекта"],
        },
    )

    response = client.post(
        "/ai/cover-letter",
        headers=headers,
        json={"opportunity_id": opportunity.id},
    )

    assert response.status_code == 200
    assert "стажировку" in response.json()["cover_letter"]
