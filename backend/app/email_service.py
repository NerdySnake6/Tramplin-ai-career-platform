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


def _send_message(message: EmailMessage, error_message: str) -> None:
    smtp_host = smtp_required_env("SMTP_HOST")
    smtp_username = smtp_required_env("SMTP_USERNAME")
    smtp_password = smtp_required_env("SMTP_PASSWORD")
    port = smtp_port()

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
        raise EmailDeliveryError(error_message) from exc


def _sender() -> str:
    return formataddr(
        (
            os.getenv("SMTP_FROM_NAME") or "Трамплин",
            os.getenv("SMTP_FROM_EMAIL") or smtp_required_env("SMTP_USERNAME"),
        )
    )


def send_verification_email(to_email: str, display_name: str, verification_url: str) -> None:
    """Отправляет письмо со ссылкой подтверждения email."""
    message = EmailMessage()
    message["Subject"] = "Подтверждение почты - Трамплин"
    message["From"] = _sender()
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

    _send_message(message, "Failed to send verification email")


def send_response_status_email(
    *,
    to_email: str,
    display_name: str,
    opportunity_title: str,
    status_value: str,
) -> None:
    """Отправляет соискателю письмо о результате рассмотрения отклика."""
    status_copy = {
        "accepted": {
            "subject": "Ваш отклик принят - Трамплин",
            "title": "Ваш отклик принят.",
            "body": (
                "Работодатель заинтересовался вашим откликом "
                "и сможет связаться с вами для следующих шагов."
            ),
        },
        "rejected": {
            "subject": "Ваш отклик отклонен - Трамплин",
            "title": "Ваш отклик отклонен.",
            "body": (
                "Это нормальная часть поиска: продолжайте откликаться "
                "на подходящие возможности на Трамплине."
            ),
        },
    }
    copy = status_copy.get(status_value)
    if not copy:
        return

    frontend_url = os.getenv("FRONTEND_PUBLIC_URL", "https://tramplin.site").rstrip("/")

    message = EmailMessage()
    message["Subject"] = copy["subject"]
    message["From"] = _sender()
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                f"Привет, {display_name}!",
                "",
                copy["title"],
                f"Карточка: {opportunity_title}",
                "",
                copy["body"],
                "",
                f"Перейти на платформу: {frontend_url}",
                "",
                "Если вы не оставляли отклик на Трамплине, просто проигнорируйте это письмо.",
            ]
        )
    )

    _send_message(message, "Failed to send response status email")
