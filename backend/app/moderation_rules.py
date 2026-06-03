"""Rule-based фильтр рискованных и незаконных карточек возможностей."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal, Sequence


ModerationRuleCategory = Literal[
    "illegal_finance",
    "illegal_delivery",
    "scam_or_exploitation",
    "identity_risk",
    "unrealistic_promises",
]
ModerationRuleLevel = Literal["suspicious", "danger"]


@dataclass(frozen=True)
class ModerationRuleMatch:
    """Совпадение системного правила модерации."""

    category: ModerationRuleCategory
    level: ModerationRuleLevel
    text: str
    reason: str


@dataclass(frozen=True)
class TextField:
    """Текстовое поле карточки, участвующее в rule-based проверке."""

    name: str
    value: str


LATIN_TO_CYRILLIC = str.maketrans(
    {
        "a": "а",
        "e": "е",
        "o": "о",
        "p": "р",
        "c": "с",
        "x": "х",
        "y": "у",
        "k": "к",
        "m": "м",
        "t": "т",
        "b": "в",
        "h": "н",
    }
)
MAX_MATCHES = 12


def normalize_text(value: str) -> str:
    """Нормализует текст для устойчивого поиска рискованных формулировок."""
    normalized_chars = []
    for char in value.lower().replace("ё", "е").translate(LATIN_TO_CYRILLIC):
        if char.isalnum() or "а" <= char <= "я":
            normalized_chars.append(char)
        else:
            normalized_chars.append(" ")
    return re.sub(r"\s+", " ", "".join(normalized_chars)).strip()


def compact_text(value: str) -> str:
    """Возвращает нормализованный текст без пробелов для поиска маскировки."""
    return normalize_text(value).replace(" ", "")


def compact_pattern(value: str) -> str:
    """Готовит нормализованный паттерн для compact-поиска."""
    return compact_text(value)


def contains_any(text: str, patterns: Sequence[str]) -> bool:
    """Проверяет наличие хотя бы одного regex-паттерна в тексте."""
    return any(re.search(pattern, text) for pattern in patterns)


def compact_contains_any(text: str, patterns: Sequence[str]) -> bool:
    """Проверяет наличие хотя бы одного паттерна в compact-тексте."""
    compact = compact_text(text)
    return any(pattern in compact for pattern in patterns)


def compact_has_any(text: str, fragments: Sequence[str]) -> bool:
    """Проверяет наличие compact-фрагментов с учетом нормализации."""
    compact = compact_text(text)
    return any(compact_pattern(fragment) in compact for fragment in fragments)


def first_snippet(original: str, patterns: Sequence[str]) -> str:
    """Возвращает короткий исходный фрагмент рядом с первым совпадением."""
    normalized = normalize_text(original)
    for pattern in patterns:
        match = re.search(pattern, normalized)
        if not match:
            continue
        found = match.group(0).strip()
        if found:
            exact = find_case_insensitive_fragment(original, found)
            if exact:
                return exact
            return found
    return original.strip()[:160]


def find_case_insensitive_fragment(original: str, normalized_fragment: str) -> str:
    """Пытается найти в исходном тексте фрагмент, похожий на нормализованное совпадение."""
    fragment_words = [word for word in normalized_fragment.split() if len(word) > 2]
    if not fragment_words:
        return ""

    lower_original = original.lower().replace("ё", "е").translate(LATIN_TO_CYRILLIC)
    first_word = fragment_words[0]
    start = lower_original.find(first_word)
    if start < 0:
        return ""

    end = start
    for word in fragment_words:
        word_at = lower_original.find(word, end)
        if word_at < 0:
            return ""
        end = word_at + len(word)
    return original[start:end].strip(" .,;:!?\n\t")


def add_match(
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
    *,
    category: ModerationRuleCategory,
    level: ModerationRuleLevel,
    text: str,
    reason: str,
) -> None:
    """Добавляет совпадение без дублей и с ограничением общего числа."""
    cleaned_text = re.sub(r"\s+", " ", text).strip(" .,;:!?\n\t")
    key = (category, level, cleaned_text.casefold())
    if not cleaned_text or key in seen or len(matches) >= MAX_MATCHES:
        return
    seen.add(key)
    matches.append(
        ModerationRuleMatch(
            category=category,
            level=level,
            text=cleaned_text[:300],
            reason=reason,
        )
    )


def scan_moderation_rules(
    *,
    title: str | None = None,
    description: str | None = None,
    salary_range: str | None = None,
    location: str | None = None,
    opportunity_type: str | None = None,
    work_format: str | None = None,
) -> list[ModerationRuleMatch]:
    """Ищет системные red flags в карточке возможности."""
    fields = [
        TextField("title", title or ""),
        TextField("description", description or ""),
        TextField("salary_range", salary_range or ""),
        TextField("location", location or ""),
        TextField("type", opportunity_type or ""),
        TextField("work_format", work_format or ""),
    ]
    combined = " ".join(field.value for field in fields if field.value).strip()
    if not combined:
        return []

    matches: list[ModerationRuleMatch] = []
    seen: set[tuple[str, str, str]] = set()

    scan_illegal_finance(combined, matches, seen)
    scan_illegal_delivery(combined, matches, seen)
    scan_scam_or_exploitation(combined, matches, seen)
    scan_identity_risk(combined, matches, seen)
    scan_unrealistic_promises(combined, matches, seen)

    return matches


CARD_OBJECT_PATTERNS = [
    r"\bбанк\w*\s+карт\w*\b",
    r"\bкарт\w*\b",
    r"\bсчет\w*\b",
    r"\bреквизит\w*\b",
    r"\bдроп\w*\b",
]
CARD_OBJECT_COMPACT = [
    compact_pattern(value)
    for value in ("карта", "банккарта", "банковскиекарт", "счет", "реквизиты", "дроп")
]
CARD_ACTION_PATTERNS = [
    r"\bкуп\w*\b",
    r"\bпрод\w*\b",
    r"\bаренд\w*\b",
    r"\bсда\w*\b",
    r"\bпереда\w*\b",
    r"\bоформ\w*\b",
    r"\bпринима\w*\s+платеж\w*\b",
    r"\bприем\w*\s+платеж\w*\b",
    r"\bобнал\w*\b",
]
CARD_ACTION_COMPACT = [
    "куп",
    "прод",
    "аренд",
    "сда",
    "переда",
    "оформ",
    "приемплатеж",
    "приниматьплатеж",
    "обнал",
]


def scan_illegal_finance(
    text: str,
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
) -> None:
    """Ищет признаки дропперства, обнала и операций с чужими картами."""
    normalized = normalize_text(text)
    has_object = contains_any(normalized, CARD_OBJECT_PATTERNS) or compact_contains_any(text, CARD_OBJECT_COMPACT)
    has_action = contains_any(normalized, CARD_ACTION_PATTERNS) or compact_has_any(text, CARD_ACTION_COMPACT)
    has_drop_marker = contains_any(normalized, [r"\bдроп\w*\b", r"\bобнал\w*\b"]) or compact_has_any(text, ["дроп", "обнал"])
    if has_drop_marker or (has_object and has_action):
        add_match(
            matches,
            seen,
            category="illegal_finance",
            level="danger",
            text=first_snippet(text, CARD_OBJECT_PATTERNS + CARD_ACTION_PATTERNS),
            reason="Обнаружены признаки операций с банковскими картами, счетами, дропами или обналичиванием.",
        )


COURIER_PATTERNS = [
    r"\bкурьер\w*\b",
    r"\bдостав\w*\b",
    r"\bразнос\w*\b",
    r"\bпоездк\w*\b",
]
COURIER_COMPACT = ["курьер", "достав", "разнос", "поездк"]
ILLEGAL_DELIVERY_PATTERNS = [
    r"\bклад\w*\b",
    r"\bзаклад\w*\b",
    r"\bкоординат(?:ы|ам|ах|ами|ов)?\b",
    r"\bтайник\w*\b",
    r"\bадрес\w*\b",
    r"\bтовар\w*\b",
    r"\bбез\s+вопрос\w*\b",
    r"\bаноним\w*\b",
    r"\bежедневн\w*\s+выплат\w*\b",
]
ILLEGAL_DELIVERY_COMPACT = [
    "клад",
    "заклад",
    "координаты",
    "координатам",
    "координатах",
    "тайник",
    "адрес",
    "товар",
    "безвопрос",
    "аноним",
    "ежедневнвыплат",
]


def scan_illegal_delivery(
    text: str,
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
) -> None:
    """Ищет маскировку незаконной курьерской работы."""
    normalized = normalize_text(text)
    if contains_any(normalized, [r"\bклад\w*\b", r"\bзаклад\w*\b"]) or compact_has_any(text, ["клад", "заклад"]):
        add_match(
            matches,
            seen,
            category="illegal_delivery",
            level="danger",
            text=first_snippet(text, ILLEGAL_DELIVERY_PATTERNS),
            reason="Обнаружены явные маркеры незаконной доставки или закладок.",
        )
        return

    if not contains_any(normalized, COURIER_PATTERNS) and not compact_has_any(text, COURIER_COMPACT):
        return

    suspicious_count = sum(
        1
        for pattern, fragment in zip(ILLEGAL_DELIVERY_PATTERNS, ILLEGAL_DELIVERY_COMPACT)
        if re.search(pattern, normalized) or compact_has_any(text, [fragment])
    )
    if suspicious_count >= 2:
        add_match(
            matches,
            seen,
            category="illegal_delivery",
            level="danger",
            text=first_snippet(text, COURIER_PATTERNS + ILLEGAL_DELIVERY_PATTERNS),
            reason="Курьерская вакансия содержит несколько маркеров маскировки незаконной доставки.",
        )
    elif suspicious_count == 1:
        add_match(
            matches,
            seen,
            category="illegal_delivery",
            level="suspicious",
            text=first_snippet(text, COURIER_PATTERNS + ILLEGAL_DELIVERY_PATTERNS),
            reason="Курьерская вакансия содержит неоднозначный маркер, который стоит проверить вручную.",
        )


DEPOSIT_PATTERNS = [
    r"\bдепозит\w*\b",
    r"\bвзнос\w*\b",
    r"\bпредоплат\w*\b",
    r"\bоплат\w*\s+доступ\w*\b",
]
DEPOSIT_COMPACT = ["депозит", "взнос", "предоплат", "оплатдоступ"]
UNPAID_TEST_PATTERNS = [
    r"\bтестов\w*\b",
    r"\bиспытательн\w*\b",
]
UNPAID_TEST_COMPACT = ["тестов", "испытательн"]
UNPAID_MARKERS = [
    r"\bбез\s+оплат\w*\b",
    r"\bнеоплач\w*\b",
    r"\bреальн\w*\s+проект\w*\b",
    r"\bпосле\s+выполнен\w*\b",
]
UNPAID_MARKER_COMPACT = ["безоплат", "неоплач", "реальнпроект", "послевыполнен"]
NO_CONTRACT_PATTERNS = [
    r"\bбез\s+договор\w*\b",
    r"\bдоговор\w*\s+после\w*\b",
    r"\bоформлен\w*\s+после\w*\b",
]
NO_CONTRACT_COMPACT = ["бездоговор", "договорпосле", "оформленпосле"]


def scan_scam_or_exploitation(
    text: str,
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
) -> None:
    """Ищет эксплуатационные или мошеннические условия вакансии."""
    normalized = normalize_text(text)
    if contains_any(normalized, DEPOSIT_PATTERNS) or compact_has_any(text, DEPOSIT_COMPACT):
        add_match(
            matches,
            seen,
            category="scam_or_exploitation",
            level="danger",
            text=first_snippet(text, DEPOSIT_PATTERNS),
            reason="Работодатель требует депозит, взнос, предоплату или оплату доступа.",
        )

    has_test = contains_any(normalized, UNPAID_TEST_PATTERNS) or compact_has_any(text, UNPAID_TEST_COMPACT)
    has_unpaid_marker = contains_any(normalized, UNPAID_MARKERS) or compact_has_any(text, UNPAID_MARKER_COMPACT)
    if has_test and has_unpaid_marker:
        add_match(
            matches,
            seen,
            category="scam_or_exploitation",
            level="danger",
            text=first_snippet(text, UNPAID_TEST_PATTERNS + UNPAID_MARKERS),
            reason="Тестовое задание похоже на неоплачиваемую работу или работу на реальном проекте.",
        )

    if contains_any(normalized, NO_CONTRACT_PATTERNS) or compact_has_any(text, NO_CONTRACT_COMPACT):
        add_match(
            matches,
            seen,
            category="scam_or_exploitation",
            level="danger",
            text=first_snippet(text, NO_CONTRACT_PATTERNS),
            reason="Условия указывают на отсутствие договора или отложенное оформление.",
        )


IDENTITY_PATTERNS = [
    r"\bпаспорт\w*\b",
    r"\bфото\s+документ\w*\b",
    r"\bскан\w*\s+документ\w*\b",
    r"\bснилс\w*\b",
    r"\bинн\w*\b",
    r"\bномер\w*\s+карт\w*\b",
]
IDENTITY_COMPACT = ["паспорт", "фотодокумент", "скандокумент", "снилс", "инн", "номеркарт"]
EARLY_STAGE_PATTERNS = [
    r"\bдо\s+собеседован\w*\b",
    r"\bдо\s+оффер\w*\b",
    r"\bдля\s+регистрац\w*\b",
    r"\bдля\s+провер\w*\b",
    r"\bсразу\s+пришл\w*\b",
]
EARLY_STAGE_COMPACT = ["дособеседован", "дооффер", "длярегистрац", "дляпровер", "сразупришл"]


def scan_identity_risk(
    text: str,
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
) -> None:
    """Ищет преждевременный запрос документов или платежных данных."""
    normalized = normalize_text(text)
    has_identity = contains_any(normalized, IDENTITY_PATTERNS) or compact_has_any(text, IDENTITY_COMPACT)
    if not has_identity:
        return

    has_early_stage = contains_any(normalized, EARLY_STAGE_PATTERNS) or compact_has_any(text, EARLY_STAGE_COMPACT)
    level: ModerationRuleLevel = "danger" if has_early_stage else "suspicious"
    add_match(
        matches,
        seen,
        category="identity_risk",
        level=level,
        text=first_snippet(text, IDENTITY_PATTERNS + EARLY_STAGE_PATTERNS),
        reason="Карточка просит документы или платежные данные кандидата на раннем этапе.",
    )


UNREALISTIC_PROMISE_PATTERNS = [
    r"\bгарантированн\w*\s+доход\w*\b",
    r"\bбез\s+опыт\w*\b",
    r"\bлюбой\s+возраст\w*\b",
    r"\b2\s*час\w*\s+в\s+день\b",
    r"\bпассивн\w*\s+доход\w*\b",
]
UNREALISTIC_PROMISE_COMPACT = ["гарантированндоход", "безопыт", "любойвозраст", "2часвдень", "пассивнодоход"]
HIGH_SALARY_PATTERN = re.compile(r"\b(?:[2-9]\d{5}|[1-9]\d{2}\s?000|[2-9]\d{2}\s?к)\b")


def scan_unrealistic_promises(
    text: str,
    matches: list[ModerationRuleMatch],
    seen: set[tuple[str, str, str]],
) -> None:
    """Ищет нереалистичные обещания, требующие ручной проверки."""
    normalized = normalize_text(text)
    marker_count = sum(
        1
        for pattern, fragment in zip(UNREALISTIC_PROMISE_PATTERNS, UNREALISTIC_PROMISE_COMPACT)
        if re.search(pattern, normalized) or compact_has_any(text, [fragment])
    )
    has_high_salary = bool(HIGH_SALARY_PATTERN.search(normalized))
    if marker_count >= 2 or (marker_count >= 1 and has_high_salary):
        add_match(
            matches,
            seen,
            category="unrealistic_promises",
            level="suspicious",
            text=first_snippet(text, UNREALISTIC_PROMISE_PATTERNS),
            reason="Вакансия содержит нереалистичные обещания дохода или условий без достаточных требований.",
        )
