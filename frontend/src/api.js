import { getToken } from './state.js';

const API_BASE = '/api';
const API_LOCK_CONTROL_SELECTOR = 'button, input[type="button"], input[type="submit"], input[type="reset"], a.btn';
let pendingLockedRequests = 0;

function shouldLockRequest(method) {
    return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function lockControls() {
    document.documentElement.classList.add('api-busy');
    document.querySelectorAll(API_LOCK_CONTROL_SELECTOR).forEach((control) => {
        if (control.matches('a')) {
            control.dataset.apiLockAriaDisabled = control.getAttribute('aria-disabled') || '';
            control.dataset.apiLockTabIndex = control.getAttribute('tabindex') || '';
            control.setAttribute('aria-disabled', 'true');
            control.setAttribute('tabindex', '-1');
            return;
        }

        if (!control.disabled) {
            control.disabled = true;
            control.dataset.apiLockDisabled = 'true';
        }
    });
}

function unlockControls() {
    document.documentElement.classList.remove('api-busy');
    document.querySelectorAll('[data-api-lock-disabled="true"]').forEach((control) => {
        control.disabled = false;
        delete control.dataset.apiLockDisabled;
    });
    document.querySelectorAll('[data-api-lock-aria-disabled], [data-api-lock-tab-index]').forEach((control) => {
        if (control.dataset.apiLockAriaDisabled) {
            control.setAttribute('aria-disabled', control.dataset.apiLockAriaDisabled);
        } else {
            control.removeAttribute('aria-disabled');
        }
        if (control.dataset.apiLockTabIndex) {
            control.setAttribute('tabindex', control.dataset.apiLockTabIndex);
        } else {
            control.removeAttribute('tabindex');
        }
        delete control.dataset.apiLockAriaDisabled;
        delete control.dataset.apiLockTabIndex;
    });
}

function beginRequestLock() {
    pendingLockedRequests += 1;
    lockControls();
}

function endRequestLock() {
    pendingLockedRequests = Math.max(0, pendingLockedRequests - 1);
    if (pendingLockedRequests === 0) {
        unlockControls();
    }
}

export function apiFetch(path, options = {}) {
    const { lockUi, ...fetchOptions } = options;
    const headers = new Headers(options.headers || {});
    const method = (options.method || 'GET').toUpperCase();
    const token = getToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const shouldLock = lockUi ?? shouldLockRequest(method);
    if (shouldLock) {
        beginRequestLock();
    }

    return fetch(`${API_BASE}${path}`, { ...fetchOptions, headers })
        .finally(() => {
            if (shouldLock) {
                endRequestLock();
            }
        });
}
