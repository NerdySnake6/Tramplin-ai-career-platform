export function el(id) {
    return document.getElementById(id);
}

export function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function normalizeText(value) {
    const text = (value || '').trim();
    return text || null;
}

export function normalizeUrl(value) {
    const text = (value || '').trim();
    return text || null;
}

export function selectedTagIdsFromContainer(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .tag-choice.active`))
        .map((item) => Number(item.dataset.tagId))
        .filter((value) => Number.isInteger(value));
}

export function toDateTimeLocalValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const OPPORTUNITY_EXPIRATION_VALIDATION_MESSAGE = 'Срок действия должен быть минимум на 1 день позже текущего времени.';

export function minimumOpportunityExpirationInputValue(now = new Date()) {
    const minimumDate = new Date(now);
    minimumDate.setDate(minimumDate.getDate() + 1);
    minimumDate.setHours(0, 0, 0, 0);
    return toDateTimeLocalValue(minimumDate);
}

export function isOpportunityExpirationValueAllowed(value, now = new Date()) {
    if (!value) return true;

    const expirationDate = new Date(value);
    if (Number.isNaN(expirationDate.getTime())) return false;

    if (
        expirationDate.getHours() === 0
        && expirationDate.getMinutes() === 0
        && expirationDate.getSeconds() === 0
        && expirationDate.getMilliseconds() === 0
    ) {
        expirationDate.setHours(23, 59, 59, 999);
    }

    return expirationDate.getTime() >= now.getTime() + DAY_IN_MS;
}

export function includesText(haystack, needle) {
    return (haystack || '').toLowerCase().includes((needle || '').toLowerCase());
}

export function debounce(callback, delay = 300) {
    let timeoutId;
    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => callback(...args), delay);
    };
}

export function tagCategoryLabel(category) {
    if (category === 'tech') return 'Технология';
    if (category === 'level') return 'Уровень';
    if (category === 'employment_type') return 'Занятость';
    if (category === 'format') return 'Формат';
    return category;
}

export function formatDate(dateString) {
    if (!dateString) return 'Без срока';
    return new Date(dateString).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });
}

export function renderAlert(container, kind, text) {
    container.innerHTML = '';
    container.appendChild(createEl('div', `alert alert-${kind} mb-0`, text));
}

export function showNotice(kind, text, options = {}) {
    const noticeOptions = { ...options };
    const placement = noticeOptions.placement || 'auto';
    delete noticeOptions.inline;
    delete noticeOptions.placement;

    if (shouldRenderInModal(kind, placement) && showModalNotice(kind, text, noticeOptions)) {
        return;
    }

    showToast(kind, noticeTitle(kind), text, noticeOptions);
}

const TOAST_LIMIT = 3;
const DEFAULT_TOAST_KIND = 'info';

const TOAST_CONFIG = {
    success: {
        title: 'Готово',
        icon: '✓',
        duration: 5000,
        role: 'status',
        live: 'polite',
    },
    danger: {
        title: 'Ошибка',
        icon: '!',
        duration: 10000,
        role: 'alert',
        live: 'assertive',
        sticky: true,
    },
    warning: {
        title: 'Внимание',
        icon: '!',
        duration: 8000,
        role: 'status',
        live: 'polite',
        sticky: true,
    },
    info: {
        title: 'Сообщение',
        icon: 'i',
        duration: 5000,
        role: 'status',
        live: 'polite',
    },
};

function noticeTitle(kind) {
    return toastConfig(kind).title;
}

function toastConfig(kind) {
    return TOAST_CONFIG[kind] || TOAST_CONFIG[DEFAULT_TOAST_KIND];
}

function toastKindClass(kind) {
    return TOAST_CONFIG[kind] ? kind : DEFAULT_TOAST_KIND;
}

function toastDuration(config, options) {
    if (options.autoClose === false || options.sticky === true || Boolean(options.actionLabel)) return null;
    if (Number.isFinite(options.autoClose) && options.autoClose > 0) return options.autoClose;
    if (config.sticky === true) return null;
    return config.duration;
}

function shouldRenderInModal(kind, placement) {
    if (placement === 'global') return false;
    if (placement === 'modal') return true;
    return Boolean(activeModal());
}

function activeModal() {
    const modals = Array.from(document.querySelectorAll('.modal'));
    const visibleModal = modals.find(m => m.classList.contains('show') || (window.getComputedStyle(m).display === 'block' && m.offsetWidth > 0));
    return visibleModal || null;
}

function cleanupModalNoticeTimer(noticeEl) {
    if (typeof noticeEl.cleanupModalNoticeTimer === 'function') {
        noticeEl.cleanupModalNoticeTimer();
    }
}

function dismissModalNotice(noticeEl) {
    if (!noticeEl) return;
    cleanupModalNoticeTimer(noticeEl);
    noticeEl.remove();
}

function bindModalNoticeCleanup(modalEl) {
    if (modalEl.dataset.noticeCleanupBound === 'true') return;

    modalEl.dataset.noticeCleanupBound = 'true';
    modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl.querySelectorAll('.app-modal-notice').forEach((noticeEl) => dismissModalNotice(noticeEl));
    });
}

function createModalNoticeCloseButton(noticeEl) {
    const closeBtn = createEl('button', 'btn-close app-modal-notice-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.addEventListener('click', () => dismissModalNotice(noticeEl));
    return closeBtn;
}

function createModalNoticeAction(options) {
    if (!options.actionLabel || typeof options.onAction !== 'function') return null;

    const actionBtn = createEl('button', 'btn btn-sm app-modal-notice-action', options.actionLabel);
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', () => {
        options.onAction();
    });
    return actionBtn;
}

function scrollModalNoticeIntoView(modalBody, noticeEl) {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = prefersReducedMotion ? 'auto' : 'smooth';

    if (typeof modalBody.scrollTo === 'function') {
        modalBody.scrollTo({ top: 0, behavior });
    } else {
        modalBody.scrollTop = 0;
    }

    if (typeof noticeEl.scrollIntoView === 'function') {
        noticeEl.scrollIntoView({ block: 'nearest', behavior });
    }
}

function showModalNotice(kind, text, options = {}) {
    const modalEl = activeModal();
    const modalBody = modalEl?.querySelector('.modal-body');
    if (!modalBody) return false;

    const config = toastConfig(kind);
    const normalizedKind = toastKindClass(kind);
    const noticeEl = createEl('div', `app-modal-notice app-modal-notice-${normalizedKind}`);
    noticeEl.setAttribute('role', config.role);
    noticeEl.setAttribute('aria-live', config.live);
    noticeEl.setAttribute('aria-atomic', 'true');

    const icon = createEl('span', 'app-modal-notice-icon', config.icon);
    icon.setAttribute('aria-hidden', 'true');

    const content = createEl('div', 'app-modal-notice-content');
    const closeBtn = createModalNoticeCloseButton(noticeEl);
    const body = createEl('div', 'app-modal-notice-body', text);
    const actionBtn = createModalNoticeAction(options);

    content.appendChild(body);
    if (actionBtn) content.appendChild(actionBtn);

    noticeEl.appendChild(icon);
    noticeEl.appendChild(content);
    noticeEl.appendChild(closeBtn);

    bindModalNoticeCleanup(modalEl);
    modalBody.querySelectorAll('.app-modal-notice').forEach((item) => dismissModalNotice(item));
    modalBody.prepend(noticeEl);

    const duration = toastDuration(config, options);
    if (duration) {
        const timeoutId = window.setTimeout(() => dismissModalNotice(noticeEl), duration);
        noticeEl.cleanupModalNoticeTimer = () => window.clearTimeout(timeoutId);
    }

    window.requestAnimationFrame(() => {
        scrollModalNoticeIntoView(modalBody, noticeEl);
    });

    return true;
}

function dismissToast(toastEl) {
    if (!toastEl || toastEl.dataset.closing === 'true') return;

    toastEl.dataset.closing = 'true';
    if (typeof toastEl.cleanupToastTimer === 'function') {
        toastEl.cleanupToastTimer();
    }

    toastEl.classList.add('app-toast-exit');
    toastEl.classList.remove('show');

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
        toastEl.remove();
    }, prefersReducedMotion ? 0 : 300);
}

function trimToastStack(container) {
    const activeToasts = Array.from(container.querySelectorAll('.app-toast')).filter((item) => item.dataset.closing !== 'true');
    activeToasts.slice(TOAST_LIMIT).forEach((item) => dismissToast(item));
}

function createToastCloseButton(toastEl) {
    const closeBtn = createEl('button', 'app-toast-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 14 16" fill="currentColor"><path fill-rule="evenodd" d="M7.71 8.23l3.75 3.75-1.48 1.48-3.75-3.75-3.75 3.75L1 11.98l3.75-3.75L1 4.48 2.48 3l3.75 3.75L9.98 3l1.48 1.48-3.75 3.75z"></path></svg>';
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        dismissToast(toastEl);
    });
    return closeBtn;
}

function createToastAction(options) {
    if (!options.actionLabel || typeof options.onAction !== 'function') return null;

    const actionBtn = createEl('button', 'btn btn-sm app-toast-action', options.actionLabel);
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onAction();
    });
    return actionBtn;
}

function bindToastTimer(toastEl, progressBar, duration, options) {
    if (!duration) return () => {};

    let timeoutId;
    let startedAt = 0;
    let remaining = duration;
    let isHoverPaused = false;
    let isFocusPaused = false;

    const clearTimer = () => {
        if (!timeoutId) return;
        window.clearTimeout(timeoutId);
        timeoutId = null;
    };

    const resume = () => {
        if (toastEl.dataset.closing === 'true') return;
        if (timeoutId) return;
        if (remaining <= 0) {
            dismissToast(toastEl);
            return;
        }

        startedAt = Date.now();
        timeoutId = window.setTimeout(() => dismissToast(toastEl), remaining);
        progressBar.style.animationPlayState = 'running';
    };

    const pause = () => {
        if (!timeoutId) return;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        clearTimer();
        progressBar.style.animationPlayState = 'paused';
    };

    const resumeWhenReady = () => {
        if (isHoverPaused || isFocusPaused) return;
        resume();
    };

    resume();

    if (options.pauseOnHover !== false) {
        toastEl.addEventListener('mouseenter', () => {
            isHoverPaused = true;
            pause();
        });
        toastEl.addEventListener('mouseleave', () => {
            isHoverPaused = false;
            resumeWhenReady();
        });
        toastEl.addEventListener('focusin', () => {
            isFocusPaused = true;
            pause();
        });
        toastEl.addEventListener('focusout', (event) => {
            if (toastEl.contains(event.relatedTarget)) return;
            isFocusPaused = false;
            resumeWhenReady();
        });
    }

    return clearTimer;
}

export function statusLabel(status) {
    if (status === 'accepted') return 'Принят';
    if (status === 'rejected') return 'Отклонен';
    if (status === 'reserve') return 'В резерве';
    return 'На рассмотрении';
}

export function contactStatusLabel(status) {
    if (status === 'accepted') return 'Контакт подтвержден';
    if (status === 'declined') return 'Заявка отклонена';
    return 'Заявка отправлена';
}

export function curatorRoleLabel(role) {
    if (role === 'employer') return 'Работодатель';
    if (role === 'applicant') return 'Соискатель';
    if (role === 'curator') return 'Куратор';
    if (role === 'admin') return 'Администратор';
    return role;
}

export function currentRoleLabel(role) {
    if (role === 'applicant') return 'Соискатель';
    if (role === 'employer') return 'Работодатель';
    if (role === 'curator') return 'Куратор';
    if (role === 'admin') return 'Администратор';
    return role;
}

export function opportunityTypeLabel(type) {
    if (type === 'internship') return 'Стажировка';
    if (type === 'job') return 'Работа';
    if (type === 'mentorship') return 'Менторство';
    if (type === 'event') return 'Событие';
    return type;
}

export function workFormatLabel(workFormat) {
    if (workFormat === 'office') return 'Офис';
    if (workFormat === 'hybrid') return 'Гибрид';
    if (workFormat === 'remote') return 'Удаленно';
    return workFormat;
}

export function showToast(kind, title, text, options = {}) {
    const container = el('toastContainer');
    if (!container) return;

    const config = toastConfig(kind);
    const normalizedKind = toastKindClass(kind);
    const duration = toastDuration(config, options);
    const toastId = `toast-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const toastEl = createEl('div', `toast app-toast app-toast-${normalizedKind} border-0`);
    toastEl.setAttribute('role', config.role);
    toastEl.setAttribute('aria-live', config.live);
    toastEl.setAttribute('aria-atomic', 'true');
    toastEl.id = toastId;

    const shell = createEl('div', 'app-toast-shell');
    const icon = createEl('span', 'app-toast-icon', config.icon);
    icon.setAttribute('aria-hidden', 'true');

    const content = createEl('div', 'app-toast-content');
    const header = createEl('div', 'app-toast-header');
    const titleEl = createEl('strong', 'app-toast-title', title || config.title);
    const closeBtn = createToastCloseButton(toastEl);

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    const body = createEl('div', 'app-toast-body', text);
    const actionBtn = createToastAction(options);

    content.appendChild(header);
    content.appendChild(body);
    if (actionBtn) content.appendChild(actionBtn);

    shell.appendChild(icon);
    shell.appendChild(content);
    toastEl.appendChild(shell);

    if (duration) {
        const progress = createEl('div', 'app-toast-progress');
        const progressBar = createEl('span', 'app-toast-progress-bar');
        progressBar.style.setProperty('--toast-duration', `${duration}ms`);
        progress.appendChild(progressBar);
        toastEl.appendChild(progress);
        toastEl.cleanupToastTimer = bindToastTimer(toastEl, progressBar, duration, options);
    }

    if (options.closeOnClick === true) {
        toastEl.addEventListener('click', (event) => {
            const target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('button, a, input, textarea, select')) return;
            dismissToast(toastEl);
        });
    }

    container.prepend(toastEl);
    trimToastStack(container);

    window.requestAnimationFrame(() => {
        toastEl.classList.add('show');
    });
}
