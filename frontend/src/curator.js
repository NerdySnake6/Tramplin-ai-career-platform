import {
    createEl,
    curatorRoleLabel,
    el,
    includesText,
    isOpportunityExpirationValueAllowed,
    minimumOpportunityExpirationInputValue,
    normalizeText,
    normalizeUrl,
    OPPORTUNITY_EXPIRATION_VALIDATION_MESSAGE,
    showNotice,
    toDateTimeLocalValue,
} from './utils.js';
import { apiFetch } from './api.js';

export function createCuratorController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
    loadCuratorData,
    loadOpportunities,
    getCuratorUserModal,
    getCuratorCreateModal,
    getCuratorOpportunityModal,
}) {
    async function updateCuratorUser(userId, payload) {
        const response = await apiFetch(`/curator/users/${userId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось обновить пользователя.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось обновить пользователя.');
            return;
        }

        await loadCuratorData();
        showNotice('success', 'Пользователь обновлен.');
    }

    async function createCuratorAccount(payload) {
        const response = await apiFetch('/curator/curators', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось создать куратора.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось создать куратора.');
            return false;
        }

        await loadCuratorData();
        showNotice('success', 'Новый куратор создан.');
        return true;
    }

    async function updateCuratorOpportunity(opportunityId, payload) {
        const response = await apiFetch(`/curator/opportunities/${opportunityId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось обновить карточку.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось обновить карточку.');
            return;
        }

        await loadCuratorData();
        await loadOpportunities();
        showNotice('success', 'Карточка обновлена.');
    }

    function getFilteredCuratorUsers() {
        const filters = state.curatorFilters;
        return state.curatorUsers.filter((user) => {
            if (filters.role && user.role !== filters.role) return false;
            if (user.role === 'employer') {
                if (filters.verification === 'verified' && !user.is_verified) return false;
                if (filters.verification === 'unverified' && user.is_verified) return false;
                if (filters.verification === 'pending' && user.is_verified) return false;
            } else if (filters.verification === 'pending') {
                return false;
            }
            if (filters.userSearch) {
                const haystack = `${user.display_name} ${user.email}`;
                if (!includesText(haystack, filters.userSearch)) return false;
            }
            return true;
        });
    }

    function getFilteredCuratorOpportunities() {
        const filters = state.curatorFilters;
        return state.curatorOpportunities.filter((opportunity) => {
            if (filters.opportunityStatus === 'active' && !opportunity.is_active) return false;
            if (filters.opportunityStatus === 'inactive' && opportunity.is_active) return false;
            if (filters.opportunitySearch) {
                const haystack = `${opportunity.title} ${opportunity.employer_name} ${opportunity.location} ${opportunity.description}`;
                if (!includesText(haystack, filters.opportunitySearch)) return false;
            }
            return true;
        });
    }

    function curatorActionLabel(role) {
        if (role === 'employer') return 'Проверить';
        if (role === 'applicant') return 'Редактировать';
        if (role === 'curator') return 'Открыть';
        if (role === 'admin') return 'Открыть';
        return 'Редактировать';
    }

    function resetCuratorUserForm() {
        state.pendingCuratorUserId = null;
        state.pendingCuratorUserRole = null;
        el('curatorUserModalLabel').textContent = 'Модерация пользователя';
        el('curatorUserModalMeta').textContent = 'Куратор может обновить статус аккаунта и содержимое профиля.';
        el('curatorUserDisplayName').value = '';
        el('curatorApplicantFullName').value = '';
        el('curatorApplicantUniversity').value = '';
        el('curatorApplicantCourse').value = '';
        el('curatorApplicantSkills').value = '';
        el('curatorApplicantExperience').value = '';
        el('curatorApplicantBio').value = '';
        el('curatorApplicantGithub').value = '';
        el('curatorApplicantPortfolio').value = '';
        el('curatorApplicantPublic').checked = false;
        el('curatorApplicantShowResponses').checked = false;
        el('curatorEmployerCompanyName').value = '';
        el('curatorEmployerIndustry').value = '';
        el('curatorEmployerDescription').value = '';
        el('curatorEmployerWebsite').value = '';
        el('curatorEmployerSocialLinks').value = '';
        el('curatorEmployerCity').value = '';
        el('curatorEmployerAddress').value = '';
        el('curatorEmployerVerified').checked = false;
        el('curatorUserActive').checked = true;
        el('curatorApplicantFields').classList.add('d-none');
        el('curatorEmployerFields').classList.add('d-none');
    }

    function syncCuratorUserModal(role) {
        el('curatorApplicantFields').classList.toggle('d-none', role !== 'applicant');
        el('curatorEmployerFields').classList.toggle('d-none', role !== 'employer');
    }

    function renderCuratorSection() {
        const refreshBtn = el('refreshCuratorBtn');
        const createBtn = el('openCuratorCreateBtn');
        const adminHint = el('curatorAdminHint');
        const usersContainer = el('curator-users-list');
        const opportunitiesContainer = el('curator-opportunities-list');
        usersContainer.innerHTML = '';
        opportunitiesContainer.innerHTML = '';

        if (!state.currentUser || !['curator', 'admin'].includes(state.currentUser.role)) {
            refreshBtn.classList.add('d-none');
            createBtn.classList.add('d-none');
            adminHint.textContent = 'Здесь можно модерировать пользователей, карточки и справочник тегов.';
            usersContainer.appendChild(createEl('p', 'text-muted mb-0', 'Войди как куратор, чтобы модерировать пользователей.'));
            opportunitiesContainer.appendChild(createEl('p', 'text-muted mb-0', 'Карточки для модерации появятся здесь.'));
            renderWorkspaceHero();
            return;
        }

        refreshBtn.classList.remove('d-none');
        createBtn.classList.toggle('d-none', state.currentUser.role !== 'admin');
        adminHint.textContent = state.currentUser.role === 'admin'
            ? 'Администратор может управлять всеми аккаунтами и создавать новых кураторов.'
            : 'Куратор модерирует пользователей, карточки возможностей и справочник тегов.';

        if (state.currentUser.role === 'admin' && state.curatorFilters.role === 'employer' && !state.curatorFilters.userSearch) {
            state.curatorFilters.role = '';
        }
        el('curatorUserRoleFilter').value = state.curatorFilters.role;

        const filteredUsers = getFilteredCuratorUsers();
        if (!filteredUsers.length) {
            usersContainer.appendChild(createEl('p', 'text-muted mb-0', 'Пользователи по текущим фильтрам не найдены.'));
        } else {
            filteredUsers.forEach((user) => {
                const item = createEl('div', 'moderation-item py-2');
                const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
                top.appendChild(createEl('div', 'fw-semibold', user.display_name));
                top.appendChild(createEl('span', `status-pill ${user.is_active ? 'accepted' : 'rejected'}`, user.is_active ? 'Активен' : 'Отключен'));
                item.appendChild(top);
                item.appendChild(createEl('div', 'moderation-meta mt-1', `${curatorRoleLabel(user.role)} | ${user.email}`));

                if (user.role === 'employer') {
                    const verificationText = user.is_verified ? 'Компания верифицирована' : 'Ожидает верификации';
                    item.appendChild(createEl('div', 'moderation-meta', verificationText));
                    if (user.employer_profile?.company_name) {
                        item.appendChild(createEl('div', 'small mt-1', user.employer_profile.company_name));
                    }
                } else if (user.role === 'applicant' && user.applicant_profile) {
                    const profileBits = [
                        user.applicant_profile.full_name,
                        user.applicant_profile.university,
                        user.applicant_profile.course_or_year,
                    ].filter(Boolean);
                    if (profileBits.length) {
                        item.appendChild(createEl('div', 'moderation-meta', profileBits.join(' | ')));
                    }
                    if (user.applicant_profile.skills) {
                        item.appendChild(
                            createEl(
                                'div',
                                'small mt-1',
                                user.applicant_profile.skills.length > 120
                                    ? `${user.applicant_profile.skills.slice(0, 120)}...`
                                    : user.applicant_profile.skills
                            )
                        );
                    }
                }

                const actions = createEl('div', 'moderation-actions');
                const editBtn = createEl('button', 'btn btn-sm btn-outline-primary', curatorActionLabel(user.role));
                editBtn.type = 'button';
                editBtn.disabled = ['curator', 'admin'].includes(user.role) && state.currentUser.role !== 'admin';
                if (!editBtn.disabled) {
                    editBtn.addEventListener('click', () => openCuratorUserModal(user.id));
                }
                actions.appendChild(editBtn);

                const verifyBtn = createEl(
                    'button',
                    `btn btn-sm ${user.is_verified ? 'btn-outline-secondary' : 'btn-outline-success'}`,
                    user.is_verified ? 'Снять верификацию' : 'Верифицировать'
                );
                verifyBtn.type = 'button';
                verifyBtn.disabled = user.role !== 'employer';
                if (user.role === 'employer') {
                    verifyBtn.addEventListener('click', () => {
                        void updateCuratorUser(user.id, { is_verified: !user.is_verified });
                    });
                }
                actions.appendChild(verifyBtn);

                const activeBtn = createEl(
                    'button',
                    `btn btn-sm ${user.is_active ? 'btn-outline-danger' : 'btn-outline-primary'}`,
                    user.is_active ? 'Отключить' : 'Активировать'
                );
                activeBtn.type = 'button';
                activeBtn.addEventListener('click', () => {
                    void updateCuratorUser(user.id, { is_active: !user.is_active });
                });
                actions.appendChild(activeBtn);

                item.appendChild(actions);
                usersContainer.appendChild(item);
            });
        }

        const filteredOpportunities = getFilteredCuratorOpportunities();
        if (!filteredOpportunities.length) {
            opportunitiesContainer.appendChild(createEl('p', 'text-muted mb-0', 'Карточки по текущим фильтрам не найдены.'));
            renderWorkspaceHero();
            return;
        }

        filteredOpportunities.forEach((opportunity) => {
            const item = createEl('div', 'moderation-item py-2');
            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', opportunity.title));
            top.appendChild(createEl('span', `status-pill ${opportunity.is_active ? 'accepted' : 'rejected'}`, opportunity.is_active ? 'Активна' : 'Скрыта'));
            item.appendChild(top);
            item.appendChild(createEl('div', 'moderation-meta mt-1', `${opportunity.employer_name} | ${opportunity.location}`));
            item.appendChild(createEl('div', 'small mt-1', opportunity.description.length > 120 ? `${opportunity.description.slice(0, 120)}...` : opportunity.description));

            const actions = createEl('div', 'moderation-actions');
            const editBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Редактировать');
            editBtn.type = 'button';
            editBtn.addEventListener('click', () => openCuratorOpportunityModal(opportunity.id));
            actions.appendChild(editBtn);

            const toggleBtn = createEl(
                'button',
                `btn btn-sm ${opportunity.is_active ? 'btn-outline-danger' : 'btn-outline-success'}`,
                opportunity.is_active ? 'Скрыть карточку' : 'Опубликовать'
            );
            toggleBtn.type = 'button';
            toggleBtn.addEventListener('click', () => {
                void updateCuratorOpportunity(opportunity.id, { is_active: !opportunity.is_active });
            });
            actions.appendChild(toggleBtn);
            item.appendChild(actions);
            opportunitiesContainer.appendChild(item);
        });
        renderWorkspaceHero();
    }

    function openCuratorUserModal(userId) {
        const user = state.curatorUsers.find((item) => item.id === userId);
        if (!user) return;
        if (['curator', 'admin'].includes(user.role) && state.currentUser?.role !== 'admin') return;

        resetCuratorUserForm();
        state.pendingCuratorUserId = userId;
        state.pendingCuratorUserRole = user.role;
        el('curatorUserDisplayName').value = user.display_name || '';
        el('curatorUserActive').checked = Boolean(user.is_active);
        syncCuratorUserModal(user.role);

        if (user.role === 'employer') {
            el('curatorUserModalLabel').textContent = 'Проверка работодателя';
            el('curatorUserModalMeta').textContent = 'Здесь можно верифицировать компанию и отредактировать данные работодателя.';
            el('curatorEmployerCompanyName').value = user.employer_profile?.company_name || '';
            el('curatorEmployerIndustry').value = user.employer_profile?.industry || '';
            el('curatorEmployerDescription').value = user.employer_profile?.description || '';
            el('curatorEmployerWebsite').value = user.employer_profile?.website || '';
            el('curatorEmployerSocialLinks').value = user.employer_profile?.social_links || '';
            el('curatorEmployerCity').value = user.employer_profile?.city || '';
            el('curatorEmployerAddress').value = user.employer_profile?.address || '';
            el('curatorEmployerVerified').checked = Boolean(user.is_verified);
        } else if (user.role === 'applicant') {
            el('curatorUserModalLabel').textContent = 'Модерация соискателя';
            el('curatorUserModalMeta').textContent = 'Куратор может скорректировать профиль соискателя и его настройки приватности.';
            el('curatorApplicantFullName').value = user.applicant_profile?.full_name || '';
            el('curatorApplicantUniversity').value = user.applicant_profile?.university || '';
            el('curatorApplicantCourse').value = user.applicant_profile?.course_or_year || '';
            el('curatorApplicantSkills').value = user.applicant_profile?.skills || '';
            el('curatorApplicantExperience').value = user.applicant_profile?.experience || '';
            el('curatorApplicantBio').value = user.applicant_profile?.bio || '';
            el('curatorApplicantGithub').value = user.applicant_profile?.github_url || '';
            el('curatorApplicantPortfolio').value = user.applicant_profile?.portfolio_url || '';
            el('curatorApplicantPublic').checked = Boolean(user.applicant_profile?.is_profile_public);
            el('curatorApplicantShowResponses').checked = Boolean(user.applicant_profile?.show_responses);
        } else {
            el('curatorUserModalLabel').textContent = user.role === 'admin' ? 'Администратор платформы' : 'Куратор платформы';
            el('curatorUserModalMeta').textContent = 'Для служебных учетных записей здесь доступно только управление активностью аккаунта.';
        }

        refreshFieldCounters();
        getCuratorUserModal().show();
    }

    function openCuratorOpportunityModal(opportunityId) {
        const opportunity = state.curatorOpportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return;

        state.pendingCuratorOpportunityId = opportunityId;
        el('curatorOpportunityTitle').value = opportunity.title || '';
        el('curatorOpportunityType').value = opportunity.type || 'job';
        el('curatorOpportunityWorkFormat').value = opportunity.work_format || 'office';
        el('curatorOpportunityLocation').value = opportunity.location || '';
        el('curatorOpportunitySalary').value = opportunity.salary_range || '';
        el('curatorOpportunityExpiresAt').min = minimumOpportunityExpirationInputValue();
        el('curatorOpportunityExpiresAt').value = toDateTimeLocalValue(opportunity.expires_at);
        el('curatorOpportunityDescription').value = opportunity.description || '';
        el('curatorOpportunityActive').checked = Boolean(opportunity.is_active);
        renderCuratorOpportunityAiReview(null);
        refreshFieldCounters();
        getCuratorOpportunityModal().show();
    }

    function highlightLabel(level) {
        if (level === 'good') return 'Хорошо';
        if (level === 'suspicious') return 'Подозрительно';
        if (level === 'danger') return 'Опасно';
        return level;
    }

    function highlightClass(level) {
        if (level === 'good') return 'ai-text-highlight-good';
        if (level === 'suspicious') return 'ai-text-highlight-suspicious';
        if (level === 'danger') return 'ai-text-highlight-danger';
        return 'ai-text-highlight-suspicious';
    }

    function createHighlightedDescription(description, highlights) {
        if (!description || !Array.isArray(highlights) || !highlights.length) return null;

        const lowerDescription = description.toLowerCase();
        const ranges = [];
        highlights.forEach((highlight) => {
            const text = (highlight.text || '').trim();
            if (!text) return;

            const start = lowerDescription.indexOf(text.toLowerCase());
            if (start < 0) return;

            ranges.push({
                start,
                end: start + text.length,
                level: highlight.level,
                explanation: highlight.explanation || highlightLabel(highlight.level),
            });
        });

        const orderedRanges = [];
        ranges
            .sort((left, right) => left.start - right.start || right.end - left.end)
            .forEach((range) => {
                const previousRange = orderedRanges[orderedRanges.length - 1];
                if (!previousRange || range.start >= previousRange.end) {
                    orderedRanges.push(range);
                }
            });

        if (!orderedRanges.length) return null;

        const container = createEl('div', 'ai-highlighted-description');
        let cursor = 0;
        orderedRanges.forEach((range) => {
            if (range.start > cursor) {
                container.appendChild(document.createTextNode(description.slice(cursor, range.start)));
            }

            const marker = createEl('span', `ai-text-highlight ${highlightClass(range.level)}`, description.slice(range.start, range.end));
            marker.title = range.explanation;
            marker.setAttribute('aria-label', `${highlightLabel(range.level)}: ${range.explanation}`);
            container.appendChild(marker);
            cursor = range.end;
        });

        if (cursor < description.length) {
            container.appendChild(document.createTextNode(description.slice(cursor)));
        }

        return container;
    }

    function appendModerationHighlights(panel, description, highlights) {
        const highlightedDescription = createHighlightedDescription(description, highlights);
        if (!highlightedDescription) return;

        panel.appendChild(createEl('div', 'fw-semibold mt-3 mb-1', 'Подсветка описания:'));
        const legend = createEl('div', 'ai-highlight-legend mb-2');
        [
            ['good', 'сильная формулировка'],
            ['suspicious', 'требует проверки'],
            ['danger', 'опасный фрагмент'],
        ].forEach(([level, label]) => {
            const item = createEl('span', `ai-highlight-legend-item ${highlightClass(level)}`, `${highlightLabel(level)} - ${label}`);
            legend.appendChild(item);
        });
        panel.appendChild(legend);
        panel.appendChild(highlightedDescription);
    }

    function renderCuratorOpportunityAiReview(result, description = '') {
        const container = el('curatorOpportunityAiReviewResult');
        if (!container) return;
        container.innerHTML = '';
        container.classList.toggle('d-none', !result);
        if (!result) return;

        const riskLabels = {
            low: 'Низкий риск',
            medium: 'Средний риск',
            high: 'Высокий риск',
        };
        const riskClasses = {
            low: 'text-success',
            medium: 'text-warning',
            high: 'text-danger',
        };
        const panel = createEl('div', 'ai-helper-result');
        panel.appendChild(
            createEl('div', `fw-semibold mb-1 ${riskClasses[result.risk_level] || ''}`, riskLabels[result.risk_level] || result.risk_level)
        );
        if (Array.isArray(result.reasons) && result.reasons.length) {
            panel.appendChild(createEl('div', 'text-muted', `Причины: ${result.reasons.join('; ')}`));
        }
        appendModerationHighlights(panel, description, result.highlights);
        if (Array.isArray(result.checklist) && result.checklist.length) {
            panel.appendChild(createEl('div', 'fw-semibold mt-2', 'Проверить вручную:'));
            const checklist = createEl('ul', '');
            result.checklist.forEach((item) => {
                checklist.appendChild(createEl('li', '', item));
            });
            panel.appendChild(checklist);
        }
        if (result.recommended_action) {
            panel.appendChild(createEl('div', 'mt-2', `Рекомендация: ${result.recommended_action}`));
        }
        container.appendChild(panel);
    }

    async function handleCuratorOpportunityAiReview() {
        if (!state.pendingCuratorOpportunityId) return;

        const payload = {
            opportunity_id: state.pendingCuratorOpportunityId,
            title: normalizeText(el('curatorOpportunityTitle').value),
            type: el('curatorOpportunityType').value,
            work_format: el('curatorOpportunityWorkFormat').value,
            location: normalizeText(el('curatorOpportunityLocation').value),
            salary_range: normalizeText(el('curatorOpportunitySalary').value),
            description: normalizeText(el('curatorOpportunityDescription').value),
            is_active: el('curatorOpportunityActive').checked,
        };
        const button = el('curatorOpportunityAiReviewBtn');
        button.disabled = true;
        button.textContent = 'AI проверяет...';

        const response = await apiFetch('/ai/moderation-review', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        button.disabled = false;
        button.textContent = 'AI-проверка';

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'AI-проверка временно недоступна.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'AI-проверка временно недоступна.');
            return;
        }

        const result = await response.json();
        renderCuratorOpportunityAiReview(result, payload.description || '');
        showNotice('success', 'AI подготовил подсказку для ручной модерации.');
    }

    async function handleCuratorUserSubmit(event) {
        event.preventDefault();
        if (!state.pendingCuratorUserId || !state.pendingCuratorUserRole) return;

        const payload = {
            display_name: normalizeText(el('curatorUserDisplayName').value),
            is_active: el('curatorUserActive').checked,
        };

        if (state.pendingCuratorUserRole === 'employer') {
            payload.is_verified = el('curatorEmployerVerified').checked;
            payload.employer_profile = {
                company_name: normalizeText(el('curatorEmployerCompanyName').value),
                industry: normalizeText(el('curatorEmployerIndustry').value),
                description: normalizeText(el('curatorEmployerDescription').value),
                website: normalizeUrl(el('curatorEmployerWebsite').value),
                social_links: normalizeText(el('curatorEmployerSocialLinks').value),
                city: normalizeText(el('curatorEmployerCity').value),
                address: normalizeText(el('curatorEmployerAddress').value),
            };
        } else if (state.pendingCuratorUserRole === 'applicant') {
            payload.applicant_profile = {
                full_name: normalizeText(el('curatorApplicantFullName').value),
                university: normalizeText(el('curatorApplicantUniversity').value),
                course_or_year: normalizeText(el('curatorApplicantCourse').value),
                skills: normalizeText(el('curatorApplicantSkills').value),
                experience: normalizeText(el('curatorApplicantExperience').value),
                bio: normalizeText(el('curatorApplicantBio').value),
                github_url: normalizeUrl(el('curatorApplicantGithub').value),
                portfolio_url: normalizeUrl(el('curatorApplicantPortfolio').value),
                is_profile_public: el('curatorApplicantPublic').checked,
                show_responses: el('curatorApplicantShowResponses').checked,
            };
        }

        await updateCuratorUser(state.pendingCuratorUserId, payload);
        getCuratorUserModal().hide();
        resetCuratorUserForm();
    }

    async function handleCuratorCreateSubmit(event) {
        event.preventDefault();

        const success = await createCuratorAccount({
            display_name: normalizeText(el('curatorCreateName').value),
            email: el('curatorCreateEmail').value.trim(),
            password: el('curatorCreatePassword').value,
        });

        if (!success) return;

        getCuratorCreateModal().hide();
        event.target.reset();
    }

    async function handleCuratorOpportunitySubmit(event) {
        event.preventDefault();
        if (!state.pendingCuratorOpportunityId) return;
        if (!isOpportunityExpirationValueAllowed(el('curatorOpportunityExpiresAt').value)) {
            showNotice('warning', OPPORTUNITY_EXPIRATION_VALIDATION_MESSAGE);
            return;
        }

        await updateCuratorOpportunity(state.pendingCuratorOpportunityId, {
            title: normalizeText(el('curatorOpportunityTitle').value),
            type: el('curatorOpportunityType').value,
            work_format: el('curatorOpportunityWorkFormat').value,
            location: normalizeText(el('curatorOpportunityLocation').value),
            salary_range: normalizeText(el('curatorOpportunitySalary').value),
            expires_at: normalizeText(el('curatorOpportunityExpiresAt').value),
            description: normalizeText(el('curatorOpportunityDescription').value),
            is_active: el('curatorOpportunityActive').checked,
        });

        getCuratorOpportunityModal().hide();
    }

    return {
        renderCuratorSection,
        openCuratorUserModal,
        openCuratorOpportunityModal,
        handleCuratorUserSubmit,
        handleCuratorCreateSubmit,
        handleCuratorOpportunitySubmit,
        handleCuratorOpportunityAiReview,
    };
}
