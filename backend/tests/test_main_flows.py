"""Интеграционные тесты для основных пользовательских сценариев."""

from datetime import UTC, datetime, timedelta

from app import models
from app.auth import create_access_token, get_password_hash
from app.email_service import EmailDeliveryError
from app.opportunity_visibility import is_expiration_datetime_allowed, normalize_expiration_datetime
from app.routers import opportunities as opportunities_router
from app.routers import auth as auth_router
from app.routers import responses as responses_router
from app.routers.opportunities import EMPLOYER_FREE_OPPORTUNITY_LIMIT
from app.tag_validation import MAX_TAGS_PER_CATEGORY


def utc_now_naive() -> datetime:
    """Возвращает текущее UTC-время без timezone для SQLite DateTime."""
    return datetime.now(UTC).replace(tzinfo=None)


def test_normalize_expiration_datetime_keeps_midnight_visible_through_day():
    """Проверяет, что срок в 00:00 считается концом выбранного дня."""
    expires_at = datetime(2026, 6, 3)

    assert normalize_expiration_datetime(expires_at) == datetime(
        2026, 6, 3, 23, 59, 59, 999999
    )


def test_normalize_expiration_datetime_preserves_explicit_time():
    """Проверяет, что явно выбранное время срока действия не меняется."""
    expires_at = datetime(2026, 6, 3, 18, 30)

    assert normalize_expiration_datetime(expires_at) == expires_at


def test_is_expiration_datetime_allowed_requires_minimum_lifetime():
    """Проверяет минимальный срок действия публичной карточки."""
    now = datetime(2026, 6, 3, 12, 0)

    assert not is_expiration_datetime_allowed(datetime(2026, 6, 4, 11, 59), now)
    assert is_expiration_datetime_allowed(datetime(2026, 6, 4, 12, 0), now)


def test_should_geocode_remote_format_when_location_is_physical_address():
    """Проверяет, что удаленный формат не запрещает геокодирование реального адреса."""
    assert opportunities_router.should_geocode("Москва, Лаврушинский переулок, 10", "remote")
    assert not opportunities_router.should_geocode("Удаленно, онлайн", "remote")


def test_resolve_coordinates_does_not_use_fallback_without_geocoder(monkeypatch):
    """Проверяет, что без настроенного геокодера координаты не подставляются заглушкой."""
    monkeypatch.setattr(opportunities_router, "geocoder_is_configured", lambda: False)

    lat, lng = opportunities_router.resolve_coordinates(
        "Москва, Лаврушинский переулок, 10",
        "office",
        None,
        None,
    )

    assert lat is None
    assert lng is None


def test_resolve_coordinates_does_not_use_fallback_on_geocoder_error(monkeypatch):
    """Проверяет, что ошибка геокодера не создает случайные координаты."""
    def broken_geocode_address(location):
        raise opportunities_router.GeocodingError("Invalid api key")

    monkeypatch.setattr(opportunities_router, "geocoder_is_configured", lambda: True)
    monkeypatch.setattr(opportunities_router, "geocode_address", broken_geocode_address)

    lat, lng = opportunities_router.resolve_coordinates(
        "Москва, Лаврушинский переулок, 10",
        "office",
        None,
        None,
    )

    assert lat is None
    assert lng is None


def register_user(client, *, email, password, display_name, role):
    """Регистрирует пользователя через API и возвращает ответ."""
    return client.post(
        "/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": display_name,
            "role": role,
        },
    )


def login_user(client, *, email, password):
    """Выполняет вход и возвращает access token."""
    confirm_registered_email(client, email)
    response = client.post(
        "/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def confirm_registered_email(client, email):
    """Подтверждает email через token, перехваченный тестовым SMTP mock."""
    token = getattr(client.app.state, "email_verification_tokens", {}).pop(email, None)
    if not token:
        return

    response = client.get(f"/auth/verify-email?token={token}", follow_redirects=False)
    assert response.status_code == 303


def auth_headers(token):
    """Формирует HTTP-заголовки с bearer token."""
    return {"Authorization": f"Bearer {token}"}


def create_response_status_fixture(db_session, *, response_status="pending"):
    """Создает данные для проверки смены статуса отклика."""
    employer = models.User(
        email="status-employer@example.com",
        hashed_password=get_password_hash("supersecret"),
        display_name="Status Employer",
        role="employer",
        is_verified=True,
    )
    applicant = models.User(
        email="status-applicant@example.com",
        hashed_password=get_password_hash("supersecret"),
        display_name="Status Applicant",
        role="applicant",
    )
    db_session.add_all([employer, applicant])
    db_session.flush()

    opportunity = models.Opportunity(
        employer_id=employer.id,
        title="Backend Internship",
        description=(
            "Стажировка с наставником и понятными задачами."
        ),
        type="internship",
        work_format="remote",
        location="Удаленно",
        salary_range="до 80 000",
        is_active=True,
    )
    db_session.add(opportunity)
    db_session.flush()

    response = models.Response(
        applicant_id=applicant.id,
        opportunity_id=opportunity.id,
        cover_letter="Хочу пройти стажировку.",
        status=response_status,
    )
    db_session.add(response)
    db_session.commit()
    db_session.refresh(response)

    token = create_access_token({"sub": employer.email, "role": employer.role})
    return response.id, auth_headers(token), applicant.email


def test_public_registration_rejects_privileged_roles(client):
    """Проверяет, что публичная регистрация не выдает служебные роли."""
    for role in ("curator", "admin"):
        response = register_user(
            client,
            email=f"{role}@example.com",
            password="supersecret",
            display_name=f"{role.title()} User",
            role=role,
        )

        assert response.status_code == 422


def test_employer_auto_verification_can_be_disabled(client, monkeypatch):
    """Проверяет, что демо-верификацию работодателей можно отключить через env."""
    monkeypatch.setenv("TRAMPLIN_AUTO_VERIFY_EMPLOYERS", "false")

    response = register_user(
        client,
        email="manual-verification@example.com",
        password="supersecret",
        display_name="Manual Verification Employer",
        role="employer",
    )

    assert response.status_code == 201
    assert response.json()["is_verified"] is False


def test_employer_auto_verification_can_be_enabled_for_demo(client, monkeypatch):
    """Проверяет, что демо-верификацию работодателей можно явно включить."""
    monkeypatch.setenv("TRAMPLIN_AUTO_VERIFY_EMPLOYERS", "true")

    response = register_user(
        client,
        email="demo-verification@example.com",
        password="supersecret",
        display_name="Demo Verification Employer",
        role="employer",
    )

    assert response.status_code == 201
    assert response.json()["is_verified"] is True


def test_registration_requires_email_confirmation_before_login(client):
    """Проверяет, что вход блокируется до подтверждения email."""
    response = register_user(
        client,
        email="needs-email-confirmation@example.com",
        password="supersecret",
        display_name="Needs Email",
        role="applicant",
    )
    assert response.status_code == 201
    assert response.json()["is_email_verified"] is False
    assert client.app.state.email_verification_tokens["needs-email-confirmation@example.com"]

    blocked_login = client.post(
        "/auth/login",
        data={"username": "needs-email-confirmation@example.com", "password": "supersecret"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert blocked_login.status_code == 403

    confirm_registered_email(client, "needs-email-confirmation@example.com")

    token = login_user(
        client,
        email="needs-email-confirmation@example.com",
        password="supersecret",
    )
    assert token


def test_user_can_change_password(client):
    """Проверяет смену пароля для обычного пользователя."""
    register_response = register_user(
        client,
        email="change-password@example.com",
        password="oldsecret",
        display_name="Change Password",
        role="applicant",
    )
    assert register_response.status_code == 201
    token = login_user(client, email="change-password@example.com", password="oldsecret")

    response = client.post(
        "/auth/change-password",
        headers=auth_headers(token),
        json={
            "current_password": "oldsecret",
            "new_password": "newsecret",
        },
    )

    assert response.status_code == 200

    old_login = client.post(
        "/auth/login",
        data={"username": "change-password@example.com", "password": "oldsecret"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert old_login.status_code == 401

    new_login_token = login_user(client, email="change-password@example.com", password="newsecret")
    assert new_login_token


def test_change_password_rejects_wrong_current_password(client):
    """Проверяет отказ при неверном текущем пароле."""
    register_response = register_user(
        client,
        email="wrong-current-password@example.com",
        password="oldsecret",
        display_name="Wrong Current",
        role="employer",
    )
    assert register_response.status_code == 201
    token = login_user(client, email="wrong-current-password@example.com", password="oldsecret")

    response = client.post(
        "/auth/change-password",
        headers=auth_headers(token),
        json={
            "current_password": "badsecret",
            "new_password": "newsecret",
        },
    )

    assert response.status_code == 400


def test_admin_cannot_change_password_through_user_endpoint(client, db_session):
    """Проверяет, что системный администратор не меняет пароль через пользовательский endpoint."""
    admin_user = models.User(
        email="admin-password-change@example.com",
        hashed_password=get_password_hash("oldsecret"),
        display_name="Admin Password",
        role="admin",
        is_active=True,
        is_verified=True,
        is_email_verified=True,
    )
    db_session.add(admin_user)
    db_session.commit()

    token = create_access_token({"sub": admin_user.email, "role": admin_user.role})
    response = client.post(
        "/auth/change-password",
        headers=auth_headers(token),
        json={
            "current_password": "oldsecret",
            "new_password": "newsecret",
        },
    )

    assert response.status_code == 403


def test_registration_rolls_back_when_email_delivery_fails(client, db_session, monkeypatch):
    """Проверяет, что пользователь не остается в базе при ошибке SMTP."""
    def fail_delivery(**_):
        raise EmailDeliveryError("smtp down")

    monkeypatch.setattr(auth_router, "send_verification_email", fail_delivery)

    response = register_user(
        client,
        email="smtp-failure@example.com",
        password="supersecret",
        display_name="SMTP Failure",
        role="applicant",
    )

    assert response.status_code == 503
    assert (
        db_session.query(models.User)
        .filter(models.User.email == "smtp-failure@example.com")
        .first()
        is None
    )


def test_resend_verification_generates_new_token(client):
    """Проверяет повторную отправку письма подтверждения."""
    register_response = register_user(
        client,
        email="resend-verification@example.com",
        password="supersecret",
        display_name="Resend Verification",
        role="applicant",
    )
    assert register_response.status_code == 201
    first_token = client.app.state.email_verification_tokens["resend-verification@example.com"]

    resend_response = client.post(
        "/auth/resend-verification",
        json={"email": "resend-verification@example.com"},
    )

    assert resend_response.status_code == 200
    second_token = client.app.state.email_verification_tokens["resend-verification@example.com"]
    assert second_token
    assert second_token != first_token


def test_invalid_and_expired_verification_tokens_are_rejected(client, db_session, monkeypatch):
    """Проверяет, что неверный и просроченный tokens не подтверждают email."""
    register_response = register_user(
        client,
        email="expired-verification@example.com",
        password="supersecret",
        display_name="Expired Verification",
        role="applicant",
    )
    assert register_response.status_code == 201
    token = client.app.state.email_verification_tokens["expired-verification@example.com"]

    invalid_response = client.get("/auth/verify-email?token=wrong-token", follow_redirects=False)
    assert invalid_response.status_code == 400

    user = (
        db_session.query(models.User)
        .filter(models.User.email == "expired-verification@example.com")
        .first()
    )
    user.email_verification_sent_at = utc_now_naive() - timedelta(minutes=2)
    db_session.commit()
    monkeypatch.setenv("EMAIL_VERIFICATION_TTL_MINUTES", "1")

    expired_response = client.get(f"/auth/verify-email?token={token}", follow_redirects=False)
    assert expired_response.status_code == 400
    db_session.refresh(user)
    assert user.is_email_verified is False


def test_unverified_employer_can_create_only_free_limit_before_verification(client, db_session):
    """Проверяет лимит карточек работодателя до ручной верификации."""
    response = register_user(
        client,
        email="limited-employer@example.com",
        password="supersecret",
        display_name="Limited Employer",
        role="employer",
    )
    assert response.status_code == 201
    assert response.json()["is_verified"] is False

    token = login_user(
        client,
        email="limited-employer@example.com",
        password="supersecret",
    )
    headers = auth_headers(token)

    for index in range(EMPLOYER_FREE_OPPORTUNITY_LIMIT):
        create_response = client.post(
            "/opportunities/",
            headers=headers,
            json={
                "title": f"Limited vacancy {index}",
                "description": "Карточка для проверки лимита непроверенного работодателя.",
                "type": "job",
                "work_format": "remote",
                "location": "Удаленно",
                "tag_ids": [],
            },
        )
        assert create_response.status_code == 201

    blocked_response = client.post(
        "/opportunities/",
        headers=headers,
        json={
            "title": "Limited vacancy blocked",
            "description": "Шестая карточка должна требовать верификацию администратора.",
            "type": "job",
            "work_format": "remote",
            "location": "Удаленно",
            "tag_ids": [],
        },
    )
    assert blocked_response.status_code == 403

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "limited-employer@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    approved_response = client.post(
        "/opportunities/",
        headers=headers,
        json={
            "title": "Limited vacancy approved",
            "description": "После ручной верификации работодатель может добавить еще карточку.",
            "type": "job",
            "work_format": "remote",
            "location": "Удаленно",
            "tag_ids": [],
        },
    )
    assert approved_response.status_code == 201


def test_public_endpoints_and_public_opportunities(client, db_session):
    """Проверяет публичные маршруты и фильтрацию возможностей."""
    root_response = client.get("/")
    assert root_response.status_code == 200
    assert root_response.json()["message"] == "Трамплин API работает!"

    health_response = client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}

    robots_response = client.get("/robots.txt")
    assert robots_response.status_code == 200
    assert "Sitemap: https://tramplin.site/sitemap.xml" in robots_response.text
    assert "Disallow: /api/docs" in robots_response.text

    robots_head_response = client.head("/robots.txt")
    assert robots_head_response.status_code == 200
    assert robots_head_response.headers["content-type"].startswith("text/plain")
    assert robots_head_response.text == ""

    sitemap_head_response = client.head("/sitemap.xml")
    assert sitemap_head_response.status_code == 200
    assert sitemap_head_response.headers["content-type"].startswith("application/xml")
    assert sitemap_head_response.text == ""

    employer = models.User(
        email="employer-public@example.com",
        hashed_password="hash",
        display_name="Public employer",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    db_session.add(employer)
    db_session.commit()
    db_session.refresh(employer)

    active_opp = models.Opportunity(
        employer_id=employer.id,
        title="Python Internship",
        description="Стажировка по backend-разработке для начинающих специалистов.",
        type="internship",
        work_format="office",
        location="Москва",
        is_active=True,
        expires_at=utc_now_naive() + timedelta(days=7),
    )
    inactive_opp = models.Opportunity(
        employer_id=employer.id,
        title="Hidden vacancy",
        description="Эта вакансия не должна попадать в публичный список возможностей.",
        type="job",
        work_format="remote",
        location="Санкт-Петербург",
        is_active=False,
    )
    expired_opp = models.Opportunity(
        employer_id=employer.id,
        title="Expired event",
        description="Это мероприятие уже завершилось и не должно быть видно публично.",
        type="event",
        work_format="office",
        location="Казань",
        is_active=True,
        expires_at=utc_now_naive() - timedelta(days=1),
    )

    db_session.add_all([active_opp, inactive_opp, expired_opp])
    db_session.commit()

    opportunities_response = client.get("/opportunities/")
    assert opportunities_response.status_code == 200

    payload = opportunities_response.json()
    assert len(payload) == 1
    assert payload[0]["title"] == "Python Internship"
    assert payload[0]["employer_name"] == "Public employer"

    active_detail_response = client.get(f"/opportunities/{active_opp.id}")
    assert active_detail_response.status_code == 200
    assert active_detail_response.json()["title"] == "Python Internship"
    assert client.get(f"/opportunities/{inactive_opp.id}").status_code == 404
    assert client.get(f"/opportunities/{expired_opp.id}").status_code == 404

    active_seo_response = client.get(f"/seo/opportunities/{active_opp.id}")
    assert active_seo_response.status_code == 200
    assert "Python Internship" in active_seo_response.text
    assert client.get(f"/seo/opportunities/{inactive_opp.id}").status_code == 404
    assert client.get(f"/seo/opportunities/{expired_opp.id}").status_code == 404

    sitemap_response = client.get("/sitemap.xml")
    assert sitemap_response.status_code == 200
    assert sitemap_response.headers["content-type"].startswith("application/xml")
    assert "<loc>https://tramplin.site/opportunities</loc>" in sitemap_response.text
    assert "<loc>https://tramplin.site/internships</loc>" in sitemap_response.text
    assert f"<loc>https://tramplin.site/opportunities/{active_opp.id}</loc>" in sitemap_response.text
    assert f"<loc>https://tramplin.site/opportunities/{inactive_opp.id}</loc>" not in sitemap_response.text
    assert f"<loc>https://tramplin.site/opportunities/{expired_opp.id}</loc>" not in sitemap_response.text


def test_applicant_cannot_respond_to_non_public_opportunities(client, db_session):
    """Проверяет запрет отклика на скрытые и истекшие карточки."""
    employer = models.User(
        email="employer-hidden@example.com",
        hashed_password="hash",
        display_name="Hidden employer",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    db_session.add(employer)
    db_session.commit()
    db_session.refresh(employer)

    inactive_opp = models.Opportunity(
        employer_id=employer.id,
        title="Hidden QA Vacancy",
        description="Скрытая карточка не должна принимать отклики от соискателей.",
        type="job",
        work_format="remote",
        location="Удаленно",
        is_active=False,
    )
    expired_opp = models.Opportunity(
        employer_id=employer.id,
        title="Expired QA Event",
        description="Истекшая карточка не должна принимать отклики от соискателей.",
        type="event",
        work_format="office",
        location="Москва",
        is_active=True,
        expires_at=utc_now_naive() - timedelta(days=1),
    )
    db_session.add_all([inactive_opp, expired_opp])
    db_session.commit()

    register_user(
        client,
        email="hidden-applicant@example.com",
        password="supersecret",
        display_name="Hidden Applicant",
        role="applicant",
    )
    token = login_user(
        client,
        email="hidden-applicant@example.com",
        password="supersecret",
    )

    for opportunity in (inactive_opp, expired_opp):
        response = client.post(
            "/responses/",
            headers=auth_headers(token),
            json={
                "opportunity_id": opportunity.id,
                "cover_letter": "Хочу откликнуться на эту карточку.",
            },
        )
        assert response.status_code == 404


def test_auth_and_profile_flow(client):
    """Проверяет регистрацию, вход и обновление профиля соискателя."""
    register_response = register_user(
        client,
        email="student@example.com",
        password="supersecret",
        display_name="Student One",
        role="applicant",
    )
    assert register_response.status_code == 201

    token = login_user(
        client,
        email="student@example.com",
        password="supersecret",
    )

    me_response = client.get("/auth/me", headers=auth_headers(token))
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "student@example.com"

    update_response = client.put(
        "/profiles/me",
        headers=auth_headers(token),
        json={
            "display_name": "Student Updated",
            "applicant_profile": {
                "full_name": "Иван Студентов",
                "university": "ИТМО",
                "course_or_year": "4 курс",
                "is_profile_public": True,
            },
        },
    )
    assert update_response.status_code == 200

    profile_response = client.get("/profiles/me", headers=auth_headers(token))
    assert profile_response.status_code == 200
    profile = profile_response.json()
    assert profile["display_name"] == "Student Updated"
    assert profile["applicant_profile"]["full_name"] == "Иван Студентов"
    assert profile["applicant_profile"]["is_profile_public"] is True


def test_employer_opportunity_and_response_flow(client, db_session, monkeypatch):
    """Проверяет создание возможности, отклик и смену статуса работодателем."""
    sent_emails = []

    def fake_send_response_status_email(**kwargs):
        sent_emails.append(kwargs)

    monkeypatch.setattr(
        responses_router.email_service,
        "send_response_status_email",
        fake_send_response_status_email,
    )

    employer_register = register_user(
        client,
        email="employer@example.com",
        password="supersecret",
        display_name="Employer",
        role="employer",
    )
    assert employer_register.status_code == 201

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "employer@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    employer_token = login_user(
        client,
        email="employer@example.com",
        password="supersecret",
    )

    create_opportunity_response = client.post(
        "/opportunities/",
        headers=auth_headers(employer_token),
        json={
            "title": "Junior Backend Intern",
            "description": "Стажировка по Python и FastAPI с наставничеством и реальными задачами.",
            "type": "internship",
            "work_format": "remote",
            "location": "Москва",
            "salary_range": "до 80 000",
            "tag_ids": [],
        },
    )
    assert create_opportunity_response.status_code == 201
    opportunity_id = create_opportunity_response.json()["id"]

    applicant_register = register_user(
        client,
        email="applicant@example.com",
        password="supersecret",
        display_name="Applicant",
        role="applicant",
    )
    assert applicant_register.status_code == 201

    applicant_token = login_user(
        client,
        email="applicant@example.com",
        password="supersecret",
    )

    create_response_result = client.post(
        "/responses/",
        headers=auth_headers(applicant_token),
        json={
            "opportunity_id": opportunity_id,
            "cover_letter": "Хочу попасть на стажировку и готов выполнить тестовое задание.",
        },
    )
    assert create_response_result.status_code == 201
    response_id = create_response_result.json()["id"]

    my_responses = client.get("/responses/my", headers=auth_headers(applicant_token))
    assert my_responses.status_code == 200
    assert len(my_responses.json()) == 1

    employer_responses = client.get(
        "/responses/employer",
        headers=auth_headers(employer_token),
    )
    assert employer_responses.status_code == 200
    assert len(employer_responses.json()) == 1
    assert employer_responses.json()[0]["opportunity_id"] == opportunity_id

    update_status = client.patch(
        f"/responses/{response_id}/status",
        headers=auth_headers(employer_token),
        json={"status": "accepted"},
    )
    assert update_status.status_code == 200
    assert update_status.json()["status"] == "accepted"
    assert sent_emails == [
        {
            "to_email": "applicant@example.com",
            "display_name": "Applicant",
            "opportunity_title": "Junior Backend Intern",
            "status_value": "accepted",
        }
    ]


def test_response_status_email_sent_only_for_accepted_and_rejected(
    client,
    db_session,
    monkeypatch,
):
    """Проверяет, что письма уходят только для принятого и отклоненного отклика."""
    response_id, headers, applicant_email = create_response_status_fixture(db_session)
    sent_emails = []

    def fake_send_response_status_email(**kwargs):
        sent_emails.append(kwargs)

    monkeypatch.setattr(
        responses_router.email_service,
        "send_response_status_email",
        fake_send_response_status_email,
    )

    accepted_response = client.patch(
        f"/responses/{response_id}/status",
        headers=headers,
        json={"status": "accepted"},
    )
    assert accepted_response.status_code == 200
    assert accepted_response.json()["status"] == "accepted"
    assert len(sent_emails) == 1
    assert sent_emails[0]["to_email"] == applicant_email
    assert sent_emails[0]["status_value"] == "accepted"

    repeated_response = client.patch(
        f"/responses/{response_id}/status",
        headers=headers,
        json={"status": "accepted"},
    )
    assert repeated_response.status_code == 200
    assert len(sent_emails) == 1

    reserve_response = client.patch(
        f"/responses/{response_id}/status",
        headers=headers,
        json={"status": "reserve"},
    )
    assert reserve_response.status_code == 200
    assert reserve_response.json()["status"] == "reserve"
    assert len(sent_emails) == 1

    rejected_response = client.patch(
        f"/responses/{response_id}/status",
        headers=headers,
        json={"status": "rejected"},
    )
    assert rejected_response.status_code == 200
    assert rejected_response.json()["status"] == "rejected"
    assert len(sent_emails) == 2
    assert sent_emails[1]["to_email"] == applicant_email
    assert sent_emails[1]["status_value"] == "rejected"


def test_response_status_update_survives_email_delivery_error(
    client,
    db_session,
    monkeypatch,
):
    """Проверяет, что ошибка SMTP не отменяет сохранение статуса отклика."""
    response_id, headers, _ = create_response_status_fixture(db_session)

    def fail_send_response_status_email(**_):
        raise EmailDeliveryError("smtp down")

    monkeypatch.setattr(
        responses_router.email_service,
        "send_response_status_email",
        fail_send_response_status_email,
    )

    update_status = client.patch(
        f"/responses/{response_id}/status",
        headers=headers,
        json={"status": "accepted"},
    )
    assert update_status.status_code == 200
    assert update_status.json()["status"] == "accepted"

    saved_response = (
        db_session.query(models.Response)
        .filter(models.Response.id == response_id)
        .first()
    )
    assert saved_response.status == "accepted"


def test_employer_cannot_create_opportunity_with_unreasonable_salary(client, db_session):
    """Проверяет, что случайная числовая строка не сохраняется как вознаграждение."""
    register_response = register_user(
        client,
        email="invalid-salary-employer@example.com",
        password="supersecret",
        display_name="Invalid Salary Employer",
        role="employer",
    )
    assert register_response.status_code == 201

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "invalid-salary-employer@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    token = login_user(
        client,
        email="invalid-salary-employer@example.com",
        password="supersecret",
    )

    # 1. Reject huge number
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "123333222221112233333222112233321321312",
            "tag_ids": [],
        },
    )
    assert response.status_code == 422
    assert "реалистичное вознаграждение" in response.text

    # 2. Reject negative number
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "-100",
            "tag_ids": [],
        },
    )
    assert response.status_code == 422
    assert "реалистичное вознаграждение" in response.text

    # 3. Reject salary > 3_000_000
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "3 000 001",
            "tag_ids": [],
        },
    )
    assert response.status_code == 422
    assert "реалистичное вознаграждение" in response.text

    # 4. Reject salary with dots as thousands separators
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "100.000.000",
            "tag_ids": [],
        },
    )
    assert response.status_code == 422
    assert "реалистичное вознаграждение" in response.text

    # 5. Reject salary with commas as thousands separators
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "100,000,000",
            "tag_ids": [],
        },
    )
    assert response.status_code == 422
    assert "реалистичное вознаграждение" in response.text

    # 6. Accept salary 3_000_000
    response = client.post(
        "/opportunities/",
        headers=auth_headers(token),
        json={
            "title": "Junior Backend Developer 3M",
            "description": "Работа с Python и FastAPI под руководством опытного наставника.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Москва",
            "salary_range": "3 000 000",
            "tag_ids": [],
        },
    )
    assert response.status_code == 201


def test_public_opportunities_tolerate_legacy_invalid_salary(client, db_session):
    """Проверяет, что старая невалидная зарплата в БД не роняет публичный список."""
    employer = models.User(
        email="legacy-salary-employer@example.com",
        hashed_password=get_password_hash("supersecret"),
        display_name="Legacy Salary Employer",
        role="employer",
        is_verified=True,
    )
    db_session.add(employer)
    db_session.flush()

    opportunity = models.Opportunity(
        employer_id=employer.id,
        title="Legacy Salary Job",
        description="Карточка со старым значением зарплаты, которое уже лежит в базе.",
        type="job",
        work_format="office",
        location="Москва",
        salary_range="100.000.000",
        is_active=True,
    )
    db_session.add(opportunity)
    db_session.commit()

    response = client.get("/opportunities/")

    assert response.status_code == 200
    assert response.json()[0]["salary_range"] == "100.000.000"


def test_employer_can_manage_own_opportunities(client, db_session):
    """Проверяет создание, просмотр, редактирование и удаление своих карточек работодателем."""
    register_response = register_user(
        client,
        email="owner@example.com",
        password="supersecret",
        display_name="Owner Employer",
        role="employer",
    )
    assert register_response.status_code == 201

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "owner@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    token = login_user(
        client,
        email="owner@example.com",
        password="supersecret",
    )
    headers = auth_headers(token)

    invalid_expiration_response = client.post(
        "/opportunities/",
        headers=headers,
        json={
            "title": "Too Short Vacancy",
            "description": "Карточка с некорректно коротким сроком действия должна быть отклонена API.",
            "type": "job",
            "work_format": "office",
            "location": "Москва, ул. Льва Толстого, 16",
            "expires_at": (utc_now_naive() + timedelta(hours=12)).isoformat(),
            "tag_ids": [],
        },
    )
    assert invalid_expiration_response.status_code == 422
    assert "минимум на 1 день" in invalid_expiration_response.json()["detail"]

    create_response = client.post(
        "/opportunities/",
        headers=headers,
        json={
            "title": "Junior Python Developer",
            "description": "Полноценная стартовая позиция для начинающего backend-разработчика с наставничеством.",
            "type": "job",
            "work_format": "office",
            "location": "Москва, ул. Льва Толстого, 16",
            "salary_range": "80 000 - 120 000",
            "expires_at": (utc_now_naive() + timedelta(days=14)).isoformat(),
            "tag_ids": [],
        },
    )
    assert create_response.status_code == 201
    opportunity_id = create_response.json()["id"]

    my_response = client.get("/opportunities/my", headers=headers)
    assert my_response.status_code == 200
    assert len(my_response.json()) == 1
    assert my_response.json()[0]["title"] == "Junior Python Developer"

    filtered_response = client.get("/opportunities/my?query=Python", headers=headers)
    assert filtered_response.status_code == 200
    assert len(filtered_response.json()) == 1

    update_response = client.put(
        f"/opportunities/{opportunity_id}",
        headers=headers,
        json={
            "title": "Junior Python Developer Updated",
            "description": "Обновленная карточка с уточненным стеком, условиями работы и расширенным описанием задач.",
            "type": "job",
            "work_format": "hybrid",
            "location": "Санкт-Петербург",
            "salary_range": "до 140 000",
            "is_active": False,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Junior Python Developer Updated"
    assert update_response.json()["work_format"] == "hybrid"
    assert update_response.json()["is_active"] is False

    archived_response = client.get("/opportunities/my?is_active=false", headers=headers)
    assert archived_response.status_code == 200
    assert len(archived_response.json()) == 1
    assert archived_response.json()[0]["id"] == opportunity_id

    delete_response = client.delete(f"/opportunities/{opportunity_id}", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json() == {"ok": True}

    empty_response = client.get("/opportunities/my", headers=headers)
    assert empty_response.status_code == 200
    assert empty_response.json() == []


def test_applicants_can_build_network_contacts(client):
    """Проверяет поиск открытых профилей, заявку в контакты и подтверждение связи."""
    first_user = register_user(
        client,
        email="network-one@example.com",
        password="supersecret",
        display_name="Network One",
        role="applicant",
    )
    second_user = register_user(
        client,
        email="network-two@example.com",
        password="supersecret",
        display_name="Network Two",
        role="applicant",
    )
    assert first_user.status_code == 201
    assert second_user.status_code == 201

    first_token = login_user(
        client,
        email="network-one@example.com",
        password="supersecret",
    )
    second_token = login_user(
        client,
        email="network-two@example.com",
        password="supersecret",
    )

    first_profile_response = client.put(
        "/profiles/me",
        headers=auth_headers(first_token),
        json={
            "display_name": "Network One Updated",
            "applicant_profile": {
                "full_name": "Иван Нетворкинг",
                "university": "ИТМО",
                "skills": "Python, FastAPI",
                "is_profile_public": True,
            },
        },
    )
    assert first_profile_response.status_code == 200

    second_profile_response = client.put(
        "/profiles/me",
        headers=auth_headers(second_token),
        json={
            "display_name": "Network Two Updated",
            "applicant_profile": {
                "full_name": "Мария Контакт",
                "university": "СПбГУ",
                "skills": "React, TypeScript",
                "is_profile_public": True,
            },
        },
    )
    assert second_profile_response.status_code == 200

    suggestions_response = client.get("/contacts/suggestions", headers=auth_headers(first_token))
    assert suggestions_response.status_code == 200
    suggestions = suggestions_response.json()
    assert len(suggestions) == 1
    assert suggestions[0]["display_name"] == "Network Two Updated"

    create_contact_response = client.post(
        "/contacts/",
        headers=auth_headers(first_token),
        json={"addressee_id": suggestions[0]["id"]},
    )
    assert create_contact_response.status_code == 201
    contact_id = create_contact_response.json()["id"]

    outgoing_contacts = client.get("/contacts/", headers=auth_headers(first_token))
    assert outgoing_contacts.status_code == 200
    assert outgoing_contacts.json()[0]["direction"] == "outgoing"
    assert outgoing_contacts.json()[0]["peer"]["display_name"] == "Network Two Updated"

    incoming_contacts = client.get("/contacts/", headers=auth_headers(second_token))
    assert incoming_contacts.status_code == 200
    assert incoming_contacts.json()[0]["direction"] == "incoming"
    assert incoming_contacts.json()[0]["status"] == "pending"

    accept_response = client.patch(
        f"/contacts/{contact_id}",
        headers=auth_headers(second_token),
        json={"status": "accepted"},
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["status"] == "accepted"

    accepted_contacts = client.get("/contacts/", headers=auth_headers(first_token))
    assert accepted_contacts.status_code == 200
    assert accepted_contacts.json()[0]["status"] == "accepted"
    assert accepted_contacts.json()[0]["peer"]["applicant_profile"]["skills"] == "React, TypeScript"

    repeat_suggestions = client.get("/contacts/suggestions", headers=auth_headers(first_token))
    assert repeat_suggestions.status_code == 200
    assert repeat_suggestions.json() == []


def test_applicants_can_recommend_opportunities_to_contacts(client, db_session):
    """Проверяет рекомендации вакансий и мероприятий между подтвержденными контактами."""
    first_user = register_user(
        client,
        email="recommend-one@example.com",
        password="supersecret",
        display_name="Recommend One",
        role="applicant",
    )
    second_user = register_user(
        client,
        email="recommend-two@example.com",
        password="supersecret",
        display_name="Recommend Two",
        role="applicant",
    )
    employer_user = register_user(
        client,
        email="recommend-employer@example.com",
        password="supersecret",
        display_name="Recommend Employer",
        role="employer",
    )
    assert first_user.status_code == 201
    assert second_user.status_code == 201
    assert employer_user.status_code == 201

    first_token = login_user(
        client,
        email="recommend-one@example.com",
        password="supersecret",
    )
    second_token = login_user(
        client,
        email="recommend-two@example.com",
        password="supersecret",
    )
    employer_token = login_user(
        client,
        email="recommend-employer@example.com",
        password="supersecret",
    )

    first_profile = client.put(
        "/profiles/me",
        headers=auth_headers(first_token),
        json={
            "display_name": "Recommend One Updated",
            "applicant_profile": {
                "full_name": "Иван Рекомендатор",
                "skills": "Python",
                "is_profile_public": True,
            },
        },
    )
    second_profile = client.put(
        "/profiles/me",
        headers=auth_headers(second_token),
        json={
            "display_name": "Recommend Two Updated",
            "applicant_profile": {
                "full_name": "Мария Получатель",
                "skills": "React",
                "is_profile_public": True,
            },
        },
    )
    assert first_profile.status_code == 200
    assert second_profile.status_code == 200

    employer_model = (
        db_session.query(models.User)
        .filter(models.User.email == "recommend-employer@example.com")
        .first()
    )
    employer_model.is_verified = True
    db_session.commit()

    create_opportunity = client.post(
        "/opportunities/",
        headers=auth_headers(employer_token),
        json={
            "title": "Frontend Event",
            "description": "Карьерное мероприятие для студентов с воркшопами, лекциями и знакомством с командой.",
            "type": "event",
            "work_format": "office",
            "location": "Санкт-Петербург",
            "tag_ids": [],
        },
    )
    assert create_opportunity.status_code == 201
    opportunity_id = create_opportunity.json()["id"]

    create_contact = client.post(
        "/contacts/",
        headers=auth_headers(first_token),
        json={"addressee_id": second_profile.json()["id"]},
    )
    assert create_contact.status_code == 201
    contact_id = create_contact.json()["id"]

    accept_contact = client.patch(
        f"/contacts/{contact_id}",
        headers=auth_headers(second_token),
        json={"status": "accepted"},
    )
    assert accept_contact.status_code == 200

    recommendation_response = client.post(
        "/recommendations/",
        headers=auth_headers(first_token),
        json={
            "recommended_user_id": second_profile.json()["id"],
            "opportunity_id": opportunity_id,
            "message": "Мне кажется, это событие подойдет под твой стек и интерес к фронтенду.",
        },
    )
    assert recommendation_response.status_code == 201
    assert recommendation_response.json()["direction"] == "outgoing"
    assert recommendation_response.json()["opportunity"]["title"] == "Frontend Event"

    my_recommendations = client.get("/recommendations/", headers=auth_headers(second_token))
    assert my_recommendations.status_code == 200
    assert len(my_recommendations.json()) == 1
    assert my_recommendations.json()[0]["direction"] == "incoming"
    assert my_recommendations.json()[0]["peer"]["display_name"] == "Recommend One Updated"
    assert my_recommendations.json()[0]["message"].startswith("Мне кажется")


def test_applicant_profile_privacy_controls_access(client, db_session):
    """Проверяет приватность профиля и видимость откликов для других соискателей."""
    private_user = register_user(
        client,
        email="privacy-private@example.com",
        password="supersecret",
        display_name="Private User",
        role="applicant",
    )
    viewer_user = register_user(
        client,
        email="privacy-viewer@example.com",
        password="supersecret",
        display_name="Viewer User",
        role="applicant",
    )
    employer_user = register_user(
        client,
        email="privacy-employer@example.com",
        password="supersecret",
        display_name="Privacy Employer",
        role="employer",
    )
    assert private_user.status_code == 201
    assert viewer_user.status_code == 201
    assert employer_user.status_code == 201

    private_token = login_user(
        client,
        email="privacy-private@example.com",
        password="supersecret",
    )
    viewer_token = login_user(
        client,
        email="privacy-viewer@example.com",
        password="supersecret",
    )
    employer_token = login_user(
        client,
        email="privacy-employer@example.com",
        password="supersecret",
    )

    private_profile = client.put(
        "/profiles/me",
        headers=auth_headers(private_token),
        json={
            "display_name": "Private User Updated",
            "applicant_profile": {
                "full_name": "Скрытый Соискатель",
                "skills": "Python",
                "bio": "Не хочу показывать профиль всем подряд.",
                "is_profile_public": False,
                "show_responses": False,
            },
        },
    )
    assert private_profile.status_code == 200
    private_user_id = private_profile.json()["id"]

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "privacy-employer@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    opportunity = client.post(
        "/opportunities/",
        headers=auth_headers(employer_token),
        json={
            "title": "Privacy Job",
            "description": "Вакансия для проверки видимости откликов и поведения приватного профиля.",
            "type": "job",
            "work_format": "remote",
            "location": "Москва",
            "tag_ids": [],
        },
    )
    assert opportunity.status_code == 201

    response = client.post(
        "/responses/",
        headers=auth_headers(private_token),
        json={
            "opportunity_id": opportunity.json()["id"],
            "cover_letter": "Отклик для проверки приватности.",
        },
    )
    assert response.status_code == 201

    forbidden_profile = client.get(
        f"/profiles/applicants/{private_user_id}",
        headers=auth_headers(viewer_token),
    )
    assert forbidden_profile.status_code == 403

    open_profile = client.put(
        "/profiles/me",
        headers=auth_headers(private_token),
        json={
            "applicant_profile": {
                "is_profile_public": True,
                "show_responses": True,
            },
        },
    )
    assert open_profile.status_code == 200

    visible_profile = client.get(
        f"/profiles/applicants/{private_user_id}",
        headers=auth_headers(viewer_token),
    )
    assert visible_profile.status_code == 200
    payload = visible_profile.json()
    assert payload["applicant_profile"]["bio"] == "Не хочу показывать профиль всем подряд."
    assert len(payload["visible_responses"]) == 1
    assert payload["visible_responses"][0]["cover_letter"] == "Отклик для проверки приватности."


def test_tags_catalog_creation_and_public_filtering(client, db_session):
    """Проверяет стартовые теги, создание нового тега и фильтрацию карточек по нему."""
    tags_response = client.get("/tags/")
    assert tags_response.status_code == 200
    assert any(tag["name"] == "Python" for tag in tags_response.json())

    employer_register = register_user(
        client,
        email="tag-employer@example.com",
        password="supersecret",
        display_name="Tag Employer",
        role="employer",
    )
    assert employer_register.status_code == 201

    employer = (
        db_session.query(models.User)
        .filter(models.User.email == "tag-employer@example.com")
        .first()
    )
    employer.is_verified = True
    db_session.commit()

    employer_token = login_user(
        client,
        email="tag-employer@example.com",
        password="supersecret",
    )

    create_tag_response = client.post(
        "/tags/",
        headers=auth_headers(employer_token),
        json={
            "name": "GraphQLCustomTest",
            "category": "tech",
        },
    )
    assert create_tag_response.status_code == 201
    tag_id = create_tag_response.json()["id"]

    opportunity_response = client.post(
        "/opportunities/",
        headers=auth_headers(employer_token),
        json={
            "title": "Data Science Internship",
            "description": "Стажировка с аналитикой данных, Python и практикой работы с продуктовой командой.",
            "type": "internship",
            "work_format": "hybrid",
            "location": "Москва",
            "tag_ids": [tag_id],
        },
    )
    assert opportunity_response.status_code == 201

    filtered_response = client.get(f"/opportunities/?tag_ids={tag_id}")
    assert filtered_response.status_code == 200
    assert len(filtered_response.json()) == 1
    assert filtered_response.json()[0]["tags"][0]["name"] == "GraphQLCustomTest"


def test_tag_creation_rejects_zalgo_and_enforces_category_limit(client, db_session):
    """Проверяет защиту справочника тегов от Zalgo-текста и переполнения категории."""
    employer_user = models.User(
        email="tag-limits@example.com",
        hashed_password="hash",
        display_name="Tag Limits",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    db_session.add(employer_user)
    db_session.commit()
    db_session.refresh(employer_user)

    employer_token = create_access_token({"sub": employer_user.email})
    headers = auth_headers(employer_token)

    zalgo_response = client.post(
        "/tags/",
        headers=headers,
        json={"name": "P\u0335y\u0336t\u0337h\u0338o\u0334n", "category": "tech"},
    )
    assert zalgo_response.status_code == 400
    assert "комбинирующие" in zalgo_response.json()["detail"]

    db_session.query(models.Tag).filter(models.Tag.category == "tech").delete()
    db_session.add_all(
        models.Tag(name=f"Tech Limit {index}", category="tech")
        for index in range(MAX_TAGS_PER_CATEGORY)
    )
    db_session.commit()

    limit_response = client.post(
        "/tags/",
        headers=headers,
        json={"name": "Overflow Tech", "category": "tech"},
    )
    assert limit_response.status_code == 400
    assert limit_response.json()["detail"] == (
        f"В одной категории может быть не больше {MAX_TAGS_PER_CATEGORY} тегов."
    )


def test_curator_can_delete_unused_tags_and_cannot_delete_used_tags(client, db_session):
    """Проверяет удаление тегов куратором и защиту от удаления используемых тегов."""
    curator_user = models.User(
        email="tag-curator@example.com",
        hashed_password="hash",
        display_name="Tag Curator",
        role="curator",
        is_active=True,
        is_verified=True,
    )
    employer_user = models.User(
        email="tag-owner@example.com",
        hashed_password="hash",
        display_name="Tag Owner",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([curator_user, employer_user])
    db_session.commit()
    db_session.refresh(curator_user)
    db_session.refresh(employer_user)

    unused_tag = models.Tag(name="Delete Me", category="tech")
    used_tag = models.Tag(name="In Use", category="tech")
    db_session.add_all([unused_tag, used_tag])
    db_session.commit()
    db_session.refresh(unused_tag)
    db_session.refresh(used_tag)

    opportunity = models.Opportunity(
        employer_id=employer_user.id,
        title="Tagged opportunity",
        description="Карточка с тегом, который нельзя удалять.",
        type="job",
        work_format="office",
        location="Москва",
        is_active=True,
        tags=[used_tag],
    )
    db_session.add(opportunity)
    db_session.commit()

    curator_token = create_access_token({"sub": curator_user.email})

    delete_unused = client.delete(f"/tags/{unused_tag.id}", headers=auth_headers(curator_token))
    assert delete_unused.status_code == 204
    assert db_session.query(models.Tag).filter(models.Tag.id == unused_tag.id).first() is None

    delete_used = client.delete(f"/tags/{used_tag.id}", headers=auth_headers(curator_token))
    assert delete_used.status_code == 409
    assert delete_used.json()["detail"] == "Нельзя удалить тег, пока он используется в карточках возможностей."


def test_curator_can_verify_employers_and_moderate_opportunities(client, db_session):
    """Проверяет основные сценарии кабинета куратора."""
    curator_user = models.User(
        email="curator@example.com",
        hashed_password="hash",
        display_name="Curator",
        role="curator",
        is_active=True,
        is_verified=True,
    )
    employer_user = models.User(
        email="needs-review@example.com",
        hashed_password="hash",
        display_name="Needs Review",
        role="employer",
        is_active=True,
        is_verified=False,
    )
    db_session.add_all([curator_user, employer_user])
    db_session.commit()
    db_session.refresh(curator_user)
    db_session.refresh(employer_user)

    employer_profile = models.EmployerProfile(
        user_id=employer_user.id,
        company_name="Review Corp",
        city="Москва",
    )
    opportunity = models.Opportunity(
        employer_id=employer_user.id,
        title="Moderation target",
        description="Карточка, которую куратор должен иметь возможность скрыть или опубликовать.",
        type="job",
        work_format="office",
        location="Москва",
        is_active=True,
    )
    db_session.add_all([employer_profile, opportunity])
    db_session.commit()
    db_session.refresh(opportunity)

    token = create_access_token({"sub": curator_user.email, "role": curator_user.role})
    headers = auth_headers(token)

    users_response = client.get("/curator/users?role=employer", headers=headers)
    assert users_response.status_code == 200
    assert len(users_response.json()) == 1
    assert users_response.json()[0]["is_verified"] is False

    verify_response = client.patch(
        f"/curator/users/{employer_user.id}",
        headers=headers,
        json={
            "display_name": "Checked Employer",
            "is_verified": True,
            "employer_profile": {
                "company_name": "Review Corp Updated",
                "description": "Компания прошла ручную модерацию куратора.",
                "website": "https://review.example.com",
                "city": "Санкт-Петербург",
            },
        },
    )
    assert verify_response.status_code == 200
    assert verify_response.json()["is_verified"] is True
    assert verify_response.json()["display_name"] == "Checked Employer"
    assert verify_response.json()["employer_profile"]["company_name"] == "Review Corp Updated"

    opportunities_response = client.get("/curator/opportunities", headers=headers)
    assert opportunities_response.status_code == 200
    assert opportunities_response.json()[0]["title"] == "Moderation target"

    moderate_response = client.patch(
        f"/curator/opportunities/{opportunity.id}",
        headers=headers,
        json={
            "title": "Moderated title",
            "description": "Куратор обновил описание карточки и оставил ее скрытой после повторной проверки.",
            "location": "Санкт-Петербург",
            "salary_range": "до 120 000",
            "is_active": False,
        },
    )
    assert moderate_response.status_code == 200
    assert moderate_response.json()["is_active"] is False
    assert moderate_response.json()["title"] == "Moderated title"
    assert moderate_response.json()["location"] == "Санкт-Петербург"

    invalid_salary_response = client.patch(
        f"/curator/opportunities/{opportunity.id}",
        headers=headers,
        json={"salary_range": "123333222221112233333222112233321321312"},
    )
    assert invalid_salary_response.status_code == 422
    assert "реалистичное вознаграждение" in invalid_salary_response.text


def test_curator_update_retries_geocoding_for_existing_card_without_coordinates(client, db_session, monkeypatch):
    """Проверяет повторное геокодирование старой карточки без координат при сохранении куратором."""
    geocoded_locations = []

    def fake_geocode_address(location):
        geocoded_locations.append(location)
        return {
            "lat": 55.744,
            "lng": 37.62,
            "formatted_address": location,
            "precision": "exact",
        }

    monkeypatch.setattr(opportunities_router, "geocoder_is_configured", lambda: True)
    monkeypatch.setattr(opportunities_router, "geocode_address", fake_geocode_address)

    curator_user = models.User(
        email="curator-geocode@example.com",
        hashed_password="hash",
        display_name="Curator Geocode",
        role="curator",
        is_active=True,
        is_verified=True,
    )
    employer_user = models.User(
        email="employer-geocode@example.com",
        hashed_password="hash",
        display_name="Employer Geocode",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([curator_user, employer_user])
    db_session.commit()
    db_session.refresh(curator_user)
    db_session.refresh(employer_user)

    opportunity = models.Opportunity(
        employer_id=employer_user.id,
        title="Remote card with address",
        description="Карточка была создана до исправления ключа геокодера и пока не имеет координат.",
        type="job",
        work_format="remote",
        location="Москва, Лаврушинский переулок, 10",
        lat=None,
        lng=None,
        salary_range="150 000 рублей",
        is_active=True,
    )
    db_session.add(opportunity)
    db_session.commit()
    db_session.refresh(opportunity)

    token = create_access_token({"sub": curator_user.email, "role": curator_user.role})
    response = client.patch(
        f"/curator/opportunities/{opportunity.id}",
        headers=auth_headers(token),
        json={"is_active": True},
    )

    assert response.status_code == 200
    assert response.json()["lat"] == 55.744
    assert response.json()["lng"] == 37.62
    assert geocoded_locations == ["Москва, Лаврушинский переулок, 10"]


def test_curator_can_update_applicant_profile(client, db_session):
    """Проверяет, что куратор может модерировать профиль соискателя."""
    curator_user = models.User(
        email="curator-profiles@example.com",
        hashed_password="hash",
        display_name="Curator Profiles",
        role="curator",
        is_active=True,
        is_verified=True,
    )
    applicant_user = models.User(
        email="student-review@example.com",
        hashed_password="hash",
        display_name="Student Draft",
        role="applicant",
        is_active=True,
        is_verified=False,
    )
    db_session.add_all([curator_user, applicant_user])
    db_session.commit()
    db_session.refresh(curator_user)
    db_session.refresh(applicant_user)

    applicant_profile = models.ApplicantProfile(
        user_id=applicant_user.id,
        full_name="Черновик Профиля",
        university="МИФИ",
        course_or_year="2 курс",
    )
    db_session.add(applicant_profile)
    db_session.commit()

    token = create_access_token({"sub": curator_user.email, "role": curator_user.role})
    headers = auth_headers(token)

    update_response = client.patch(
        f"/curator/users/{applicant_user.id}",
        headers=headers,
        json={
            "display_name": "Student Reviewed",
            "is_active": True,
            "applicant_profile": {
                "full_name": "Ирина Студентова",
                "university": "ИТМО",
                "course_or_year": "4 курс",
                "skills": "Python, FastAPI, SQL",
                "experience": "Учебные проекты и хакатоны",
                "bio": "Ищу первую стажировку в backend-разработке.",
                "is_profile_public": True,
                "show_responses": True,
            },
        },
    )
    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["display_name"] == "Student Reviewed"
    assert payload["applicant_profile"]["full_name"] == "Ирина Студентова"
    assert payload["applicant_profile"]["is_profile_public"] is True
    assert payload["applicant_profile"]["show_responses"] is True


def test_admin_can_create_curator_accounts(client, db_session):
    """Проверяет, что только администратор может создавать кураторов."""
    admin_user = models.User(
        email="admin-create@example.com",
        hashed_password="hash",
        display_name="Administrator",
        role="admin",
        is_active=True,
        is_verified=True,
    )
    curator_user = models.User(
        email="plain-curator@example.com",
        hashed_password="hash",
        display_name="Plain Curator",
        role="curator",
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([admin_user, curator_user])
    db_session.commit()
    db_session.refresh(admin_user)
    db_session.refresh(curator_user)

    admin_headers = auth_headers(create_access_token({"sub": admin_user.email, "role": admin_user.role}))
    curator_headers = auth_headers(create_access_token({"sub": curator_user.email, "role": curator_user.role}))

    forbidden_response = client.post(
        "/curator/curators",
        headers=curator_headers,
        json={
            "email": "blocked-curator@example.com",
            "display_name": "Blocked",
            "password": "supersecret",
        },
    )
    assert forbidden_response.status_code == 403

    create_response = client.post(
        "/curator/curators",
        headers=admin_headers,
        json={
            "email": "new-curator@example.com",
            "display_name": "New Curator",
            "password": "supersecret",
        },
    )
    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["role"] == "curator"
    assert payload["is_active"] is True
    assert payload["is_verified"] is True


def test_opportunity_employer_is_verified_serialization(client, db_session):
    """Проверяет, что свойство employer_is_verified верно передается со схемой OpportunityOut."""
    verified_employer = models.User(
        email="verified-emp@example.com",
        hashed_password="hash",
        display_name="Verified Employer Inc",
        role="employer",
        is_active=True,
        is_verified=True,
    )
    unverified_employer = models.User(
        email="unverified-emp@example.com",
        hashed_password="hash",
        display_name="Unverified Employer LLC",
        role="employer",
        is_active=True,
        is_verified=False,
    )
    db_session.add_all([verified_employer, unverified_employer])
    db_session.commit()

    opp_verified = models.Opportunity(
        employer_id=verified_employer.id,
        title="Opportunity of Verified Employer",
        description="Очень длинное описание для прохождения валидации схемы, минимум двадцать символов.",
        type="job",
        work_format="office",
        location="Москва",
        salary_range="100 000 руб",
        is_active=True,
    )
    opp_unverified = models.Opportunity(
        employer_id=unverified_employer.id,
        title="Opportunity of Unverified Employer",
        description="Очень длинное описание для прохождения валидации схемы, минимум двадцать символов.",
        type="job",
        work_format="office",
        location="Москва",
        salary_range="100 000 руб",
        is_active=True,
    )
    db_session.add_all([opp_verified, opp_unverified])
    db_session.commit()

    response = client.get("/opportunities/")
    assert response.status_code == 200
    data = response.json()
    
    # Ищем наши вакансии в списке
    verified_json = [o for o in data if o["id"] == opp_verified.id][0]
    unverified_json = [o for o in data if o["id"] == opp_unverified.id][0]
    
    assert verified_json["employer_is_verified"] is True
    assert unverified_json["employer_is_verified"] is False
