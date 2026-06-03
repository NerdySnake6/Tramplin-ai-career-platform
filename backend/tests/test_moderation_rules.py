"""Тесты rule-based фильтра рискованных карточек возможностей."""

from app.moderation_rules import scan_moderation_rules


def match_categories(text: str):
    """Возвращает категории и уровни совпадений для компактных проверок."""
    return {(match.category, match.level) for match in scan_moderation_rules(description=text)}


def test_detects_illegal_finance_card_schemes():
    """Проверяет выявление покупки и аренды банковских карт."""
    text = "Купим банковские карты, также возможна аренда карты для приема платежей."

    matches = scan_moderation_rules(description=text)

    assert ("illegal_finance", "danger") in {(match.category, match.level) for match in matches}


def test_detects_illegal_delivery_masking():
    """Проверяет выявление замаскированной незаконной курьерской работы."""
    text = "Нужен курьер: адреса и товар выдаем ежедневно, без вопросов, выплаты каждый день."

    assert ("illegal_delivery", "danger") in match_categories(text)


def test_detects_unpaid_real_project_test_task():
    """Проверяет выявление неоплачиваемого тестового на реальном проекте."""
    text = "Перед оформлением нужно выполнить тестовое задание на реальном проекте без оплаты и без договора."

    assert ("scam_or_exploitation", "danger") in match_categories(text)


def test_detects_identity_documents_before_interview():
    """Проверяет выявление запроса документов до собеседования."""
    text = "До собеседования пришлите паспорт, номер карты и ИНН для проверки."

    assert ("identity_risk", "danger") in match_categories(text)


def test_detects_unrealistic_promises():
    """Проверяет выявление нереалистичных обещаний дохода."""
    text = "Гарантированный доход 250000 без опыта, любой возраст, работайте 2 часа в день."

    assert ("unrealistic_promises", "suspicious") in match_categories(text)


def test_ignores_normal_devops_vacancy():
    """Проверяет, что нормальная DevOps-вакансия не получает системных совпадений."""
    text = (
        "Ищем DevOps-инженера для поддержки CI/CD, Kubernetes и мониторинга. "
        "Официальное оформление, прозрачные задачи и работа с командой разработки."
    )

    assert scan_moderation_rules(description=text, salary_range="180 000 рублей") == []


def test_ignores_crypto_payment_without_other_red_flags():
    """Проверяет, что крипта сама по себе не считается системным red flag."""
    text = (
        "Международная remote-вакансия backend-разработчика. Возможна оплата в USDT "
        "или на криптокошелек из-за ограничений международных переводов."
    )

    assert scan_moderation_rules(description=text) == []
