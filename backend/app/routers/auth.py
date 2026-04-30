"""Маршруты для регистрации, входа и получения текущего пользователя."""

from datetime import timedelta
import hashlib
import os
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import models, schemas, auth
from app.database import get_db
from app.email_service import EmailDeliveryError, send_verification_email

router = APIRouter(prefix="/auth", tags=["authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def auto_verify_employers_enabled() -> bool:
    """Возвращает, включена ли автоматическая верификация работодателей."""
    value = os.getenv("TRAMPLIN_AUTO_VERIFY_EMPLOYERS", "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


def email_verification_ttl() -> timedelta:
    """Возвращает срок действия ссылки подтверждения email."""
    raw_value = os.getenv("EMAIL_VERIFICATION_TTL_MINUTES", "60")
    try:
        minutes = int(raw_value)
    except ValueError:
        minutes = 60
    return timedelta(minutes=max(minutes, 1))


def public_backend_url() -> str:
    """Возвращает публичный URL backend для ссылок в письмах."""
    return os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8000").rstrip("/")


def public_frontend_url() -> str:
    """Возвращает публичный URL frontend для редиректа после подтверждения."""
    return os.getenv("FRONTEND_PUBLIC_URL", "http://localhost:5173").rstrip("/")


def hash_email_verification_token(token: str) -> str:
    """Хеширует одноразовый token подтверждения email."""
    payload = f"{token}{auth.SECRET_KEY}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_verification_url(token: str) -> str:
    """Формирует публичную ссылку подтверждения email."""
    params = urlencode({"token": token})
    return f"{public_backend_url()}/auth/verify-email?{params}"


def generate_email_verification_token(user: models.User) -> str:
    """Создает token подтверждения и сохраняет его hash у пользователя."""
    token = secrets.token_urlsafe(32)
    user.email_verification_token_hash = hash_email_verification_token(token)
    user.email_verification_sent_at = models.utc_now_naive()
    return token


def send_user_verification_email(user: models.User, token: str) -> None:
    """Отправляет пользователю письмо подтверждения email."""
    send_verification_email(
        to_email=user.email,
        display_name=user.display_name,
        verification_url=build_verification_url(token),
    )


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register(user_data: schemas.UserCreate, db: Session = Depends(get_db)):
    """Регистрирует пользователя и создает пустой профиль по его роли."""
    db_user = db.query(models.User).filter(models.User.email == user_data.email).first()
    if db_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    hashed_password = auth.get_password_hash(user_data.password)
    token = secrets.token_urlsafe(32)
    db_user = models.User(
        email=user_data.email,
        hashed_password=hashed_password,
        display_name=user_data.display_name,
        role=user_data.role,
        is_active=True,
        is_verified=user_data.role != "employer" or auto_verify_employers_enabled(),
        is_email_verified=False,
        email_verification_token_hash=hash_email_verification_token(token),
        email_verification_sent_at=models.utc_now_naive(),
    )
    db.add(db_user)
    db.flush()

    if user_data.role == "applicant":
        profile = models.ApplicantProfile(user_id=db_user.id)
        db.add(profile)
    elif user_data.role == "employer":
        profile = models.EmployerProfile(user_id=db_user.id, company_name="")
        db.add(profile)

    try:
        send_user_verification_email(db_user, token)
    except EmailDeliveryError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Не удалось отправить письмо подтверждения. Попробуй зарегистрироваться позже.",
        ) from exc

    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    """Подтверждает email по одноразовому token из письма."""
    token_hash = hash_email_verification_token(token)
    user = (
        db.query(models.User)
        .filter(models.User.email_verification_token_hash == token_hash)
        .first()
    )
    if not user or not user.email_verification_sent_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")

    expires_at = user.email_verification_sent_at + email_verification_ttl()
    if models.utc_now_naive() > expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token expired")

    user.is_email_verified = True
    user.email_verification_token_hash = None
    user.email_verification_sent_at = None
    user.email_verified_at = models.utc_now_naive()
    db.commit()

    redirect_url = f"{public_frontend_url()}/?verified=1"
    return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/resend-verification")
def resend_verification(payload: schemas.EmailVerificationResend, db: Session = Depends(get_db)):
    """Повторно отправляет письмо подтверждения, если пользователь ожидает верификации."""
    neutral_response = {"message": "Если email ожидает подтверждения, мы отправим письмо повторно."}
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or user.is_email_verified:
        return neutral_response

    token = generate_email_verification_token(user)
    try:
        send_user_verification_email(user, token)
    except EmailDeliveryError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Не удалось отправить письмо подтверждения. Попробуй позже.",
        ) from exc

    db.commit()
    return neutral_response


@router.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Проверяет учетные данные и возвращает bearer-токен."""
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    if not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    if not user.is_email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Подтверди email перед входом")

    access_token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=schemas.UserOut)
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Возвращает пользователя, извлеченного из access token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user
