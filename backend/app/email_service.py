"""SMTP-отправка сервисных писем платформы."""

from email.message import EmailMessage
from email.utils import formataddr
import os
import smtplib


class EmailDeliveryError(RuntimeError):
    """Ошибка отправки сервисного email."""


def smtp_port() -> int:
    """Возвращает SMTP-порт из окружения."""
    return int(os.getenv("SMTP_PORT", "465"))


def smtp_required_env(name: str) -> str:
    """Возвращает обязательную SMTP-переменную окружения."""
    value = os.getenv(name)
    if not value:
        raise EmailDeliveryError(f"Environment variable {name} is not set")
    return value


def send_verification_email(to_email: str, display_name: str, verification_url: str) -> None:
    """Отправляет письмо со ссылкой подтверждения email."""
    smtp_host = smtp_required_env("SMTP_HOST")
    smtp_username = smtp_required_env("SMTP_USERNAME")
    smtp_password = smtp_required_env("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM_EMAIL") or smtp_username
    from_name = os.getenv("SMTP_FROM_NAME") or "Трамплин"
    port = smtp_port()

    message = EmailMessage()
    message["Subject"] = "Подтверждение почты - Трамплин"
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                f"Привет, {display_name}!",
                "",
                "Спасибо за регистрацию на платформе Трамплин.",
                "Чтобы завершить регистрацию, подтверди email по ссылке:",
                verification_url,
                "",
                "Если ты не регистрировался на Трамплине, просто проигнорируй это письмо.",
            ]
        )
    )

    try:
        if port == 465:
            with smtplib.SMTP_SSL(smtp_host, port, timeout=10) as server:
                server.login(smtp_username, smtp_password)
                server.send_message(message)
            return

        with smtplib.SMTP(smtp_host, port, timeout=10) as server:
            server.starttls()
            server.login(smtp_username, smtp_password)
            server.send_message(message)
    except Exception as exc:
        raise EmailDeliveryError("Failed to send verification email") from exc
