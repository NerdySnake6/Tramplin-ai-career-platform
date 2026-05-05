import {
    createEl,
    el,
    formatDate,
    includesText,
    normalizeText,
    selectedTagIdsFromContainer,
    showNotice,
    statusLabel,
    toDateTimeLocalValue,
    opportunityTypeLabel,
    workFormatLabel,
} from './utils.js';
import { apiFetch } from './api.js';

const EMPLOYER_FREE_OPPORTUNITY_LIMIT = 5;

export function createEmployerController({
    state,
    renderWorkspaceHero,
    renderOpportunitiesSection,
    refreshFieldCounters,
    renderTagChoices,
    loadEmployerResponses,
    loadEmployerOpportunities,
    loadOpportunities,
    getEmployerOpportunityModal,
}) {
    async function updateEmployerResponseStatus(responseId, status) {
        const response = await apiFetch(`/responses/${responseId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось обновить статус.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось обновить статус.');
            return;
        }

        await loadEmployerResponses();
        showNotice('success', 'Статус отклика обновлен.');
    }

    function getFilteredEmployerOpportunities() {
        const filters = state.employerOpportunityFilters;
        return state.employerOpportunities.filter((opportunity) => {
            if (filters.status === 'active' && !opportunity.is_active) return false;
            if (filters.status === 'inactive' && opportunity.is_active) return false;
            if (filters.type && opportunity.type !== filters.type) return false;
            if (filters.search) {
                const haystack = `${opportunity.title} ${opportunity.description} ${opportunity.location} ${opportunity.salary_range || ''}`;
                if (!includesText(haystack, filters.search)) return false;
            }
            return true;
        });
    }

    function canCreateEmployerOpportunity() {
        if (state.currentUser?.is_verified) return true;
        return state.employerOpportunities.length < EMPLOYER_FREE_OPPORTUNITY_LIMIT;
    }

    function renderEmployerResponses() {
        const container = el('employer-responses-list');
        const refreshBtn = el('refreshEmployerResponsesBtn');
        container.innerHTML = '';

        if (!state.currentUser || state.currentUser.role !== 'employer') {
            refreshBtn.classList.add('d-none');
            container.appendChild(createEl('p', 'text-muted mb-0', 'Войди как работодатель, чтобы видеть входящие отклики.'));
            renderWorkspaceHero();
            return;
        }

        refreshBtn.classList.remove('d-none');

        const filteredResponses = getFilteredEmployerResponses();

        if (!state.employerResponses.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'Пока нет входящих откликов.'));
            renderWorkspaceHero();
            return;
        }

        if (!filteredResponses.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'По текущим фильтрам откликов не найдено.'));
            renderWorkspaceHero();
            return;
        }

        filteredResponses.forEach((response) => {
            const item = createEl('div', 'response-item py-2');
            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', response.opportunity_title));
            top.appendChild(createEl('span', `status-pill ${response.status}`, statusLabel(response.status)));

            item.appendChild(top);
            item.appendChild(createEl('div', 'small text-muted mt-1', `${response.applicant_name} (${response.applicant_email})`));
            item.appendChild(createEl('div', 'small text-muted', `Отклик: ${formatDate(response.created_at)}`));

            if (response.cover_letter) {
                item.appendChild(createEl('div', 'small mt-2', response.cover_letter));
            }

            const actions = createEl('div', 'response-actions');
            const statuses = [
                { value: 'pending', label: 'На рассмотрение', style: 'outline-secondary' },
                { value: 'accepted', label: 'Принять', style: 'outline-success' },
                { value: 'rejected', label: 'Отклонить', style: 'outline-danger' },
                { value: 'reserve', label: 'Резерв', style: 'outline-warning' },
            ];

            statuses.forEach(({ value, label, style }) => {
                const button = createEl(
                    'button',
                    `btn btn-sm ${response.status === value ? 'btn-' + style.replace('outline-', '') : 'btn-' + style}`,
                    label
                );
                button.type = 'button';
                if (response.status === value) {
                    button.disabled = true;
                } else {
                    button.addEventListener('click', () => {
                        void updateEmployerResponseStatus(response.id, value);
                    });
                }
                actions.appendChild(button);
            });

            item.appendChild(actions);
            container.appendChild(item);
        });
        renderWorkspaceHero();
    }

    function renderEmployerOpportunities() {
        const container = el('employer-opportunities-list');
        const refreshBtn = el('refreshEmployerOpportunitiesBtn');
        const createBtn = el('openEmployerOpportunityCreateBtn');
        container.innerHTML = '';

        if (!state.currentUser || state.currentUser.role !== 'employer') {
            refreshBtn.classList.add('d-none');
            createBtn.classList.add('d-none');
            container.appendChild(createEl('p', 'text-muted mb-0', 'Войди как работодатель, чтобы создавать и редактировать свои карточки.'));
            renderWorkspaceHero();
            return;
        }

        refreshBtn.classList.remove('d-none');
        createBtn.classList.remove('d-none');
        const canCreate = canCreateEmployerOpportunity();
        const remainingFreeOpportunities = Math.max(
            EMPLOYER_FREE_OPPORTUNITY_LIMIT - state.employerOpportunities.length,
            0
        );
        createBtn.disabled = !canCreate;
        createBtn.title = canCreate
            ? 'Создать новую карточку возможности'
            : 'Лимит карточек до верификации исчерпан';

        if (!state.currentUser.is_verified) {
            const moderationText = canCreate
                ? `До ручной верификации можно создать еще ${remainingFreeOpportunities} из ${EMPLOYER_FREE_OPPORTUNITY_LIMIT} карточек. После лимита администратор или куратор должен подтвердить работодателя.`
                : `Лимит ${EMPLOYER_FREE_OPPORTUNITY_LIMIT} карточек до верификации исчерпан. Попроси администратора или куратора подтвердить работодателя.`;
            container.appendChild(
                createEl(
                    'div',
                    canCreate ? 'alert alert-info py-2 px-3 mb-3' : 'alert alert-warning py-2 px-3 mb-3',
                    moderationText
                )
            );
        }

        if (!state.employerOpportunities.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'Пока нет созданных карточек. Создай первую возможность для студентов и выпускников.'));
            renderWorkspaceHero();
            return;
        }

        const filtered = getFilteredEmployerOpportunities();
        if (!filtered.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'По текущим фильтрам карточки не найдены.'));
            renderWorkspaceHero();
            return;
        }

        filtered.forEach((opportunity) => {
            const item = createEl('div', 'opportunity-manage-item py-2');
            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', opportunity.title));
            top.appendChild(createEl('span', `status-pill ${opportunity.is_active ? 'accepted' : 'rejected'}`, opportunity.is_active ? 'Активна' : 'Закрыта'));
            item.appendChild(top);
            item.appendChild(createEl('div', 'opportunity-manage-meta mt-1', `${opportunityTypeLabel(opportunity.type)} | ${workFormatLabel(opportunity.work_format)} | ${opportunity.location}`));

            const secondaryMeta = [];
            if (opportunity.salary_range) secondaryMeta.push(opportunity.salary_range);
            if (opportunity.expires_at) secondaryMeta.push(`До ${formatDate(opportunity.expires_at)}`);
            if (opportunity.event_date) secondaryMeta.push(`Событие ${formatDate(opportunity.event_date)}`);
            if (secondaryMeta.length) {
                item.appendChild(createEl('div', 'small text-muted mt-1', secondaryMeta.join(' | ')));
            }

            item.appendChild(
                createEl(
                    'div',
                    'small mt-1',
                    opportunity.description.length > 140 ? `${opportunity.description.slice(0, 140)}...` : opportunity.description
                )
            );

            const actions = createEl('div', 'opportunity-manage-actions');
            const editBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Редактировать');
            editBtn.type = 'button';
            editBtn.addEventListener('click', () => openEmployerOpportunityModal(opportunity.id));
            actions.appendChild(editBtn);

            const toggleBtn = createEl(
                'button',
                `btn btn-sm ${opportunity.is_active ? 'btn-warning' : 'btn-outline-success'}`,
                opportunity.is_active ? 'Перевести в архив' : 'Опубликовать'
            );
            toggleBtn.type = 'button';
            toggleBtn.addEventListener('click', () => {
                void saveEmployerOpportunity({
                    id: opportunity.id,
                    payload: { is_active: !opportunity.is_active },
                    successMessage: opportunity.is_active ? 'Карточка переведена в архив.' : 'Карточка снова опубликована.',
                });
            });
            actions.appendChild(toggleBtn);

            const deleteBtn = createEl('button', 'btn btn-sm btn-outline-danger', 'Удалить');
            deleteBtn.type = 'button';
            deleteBtn.addEventListener('click', () => {
                void deleteEmployerOpportunity(opportunity.id);
            });
            actions.appendChild(deleteBtn);

            item.appendChild(actions);
            container.appendChild(item);
        });
        renderWorkspaceHero();
    }

    function getFilteredEmployerResponses() {
        const filters = state.employerResponseFilters;
        return state.employerResponses.filter((response) => {
            if (filters.status && response.status !== filters.status) return false;
            if (filters.search) {
                const combined = `${response.opportunity_title} ${response.applicant_name} ${response.applicant_email} ${response.cover_letter || ''}`;
                if (!includesText(combined, filters.search)) return false;
            }
            return true;
        });
    }

    function applyEmployerResponseFilters() {
        state.employerResponseFilters.status = el('employerResponseStatusFilter').value;
        state.employerResponseFilters.search = el('employerResponseSearch').value.trim();
        renderEmployerResponses();
    }

    function resetEmployerResponseFilters() {
        el('employerResponseStatusFilter').value = '';
        el('employerResponseSearch').value = '';
        applyEmployerResponseFilters();
    }

    function resetEmployerOpportunityForm() {
        state.pendingEmployerOpportunityId = null;
        el('employerOpportunityModalLabel').textContent = 'Новая карточка возможности';
        el('employerOpportunityTitle').value = '';
        el('employerOpportunityType').value = 'job';
        el('employerOpportunityWorkFormat').value = 'office';
        el('employerOpportunityLocation').value = '';
        el('employerOpportunitySalary').value = '';
        el('employerOpportunityExpiresAt').value = '';
        el('employerOpportunityEventDate').value = '';
        el('employerOpportunityDescription').value = '';
        el('employerOpportunityActive').checked = true;
        renderTagChoices('employerOpportunityTagOptions', []);
        syncEmployerOpportunityFieldHints();
        refreshFieldCounters();
    }

    function openEmployerOpportunityModal(opportunityId = null) {
        if (!opportunityId) {
            if (!canCreateEmployerOpportunity()) {
                showNotice('warning', `Лимит ${EMPLOYER_FREE_OPPORTUNITY_LIMIT} карточек до верификации исчерпан.`);
                return;
            }
            resetEmployerOpportunityForm();
            const employerProfile = state.profile?.employer_profile;
            const defaultLocation = employerProfile?.address || employerProfile?.city || '';
            if (defaultLocation) {
                el('employerOpportunityLocation').value = defaultLocation;
            }
            refreshFieldCounters();
            getEmployerOpportunityModal().show();
            return;
        }

        const opportunity = state.employerOpportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return;

        state.pendingEmployerOpportunityId = opportunityId;
        el('employerOpportunityModalLabel').textContent = 'Редактирование карточки';
        el('employerOpportunityTitle').value = opportunity.title || '';
        el('employerOpportunityType').value = opportunity.type || 'job';
        el('employerOpportunityWorkFormat').value = opportunity.work_format || 'office';
        el('employerOpportunityLocation').value = opportunity.location || '';
        el('employerOpportunitySalary').value = opportunity.salary_range || '';
        el('employerOpportunityExpiresAt').value = toDateTimeLocalValue(opportunity.expires_at);
        el('employerOpportunityEventDate').value = toDateTimeLocalValue(opportunity.event_date);
        el('employerOpportunityDescription').value = opportunity.description || '';
        el('employerOpportunityActive').checked = Boolean(opportunity.is_active);
        renderTagChoices(
            'employerOpportunityTagOptions',
            Array.isArray(opportunity.tags) ? opportunity.tags.map((tag) => tag.id) : []
        );
        syncEmployerOpportunityFieldHints();
        refreshFieldCounters();
        getEmployerOpportunityModal().show();
    }

    function syncEmployerOpportunityFieldHints() {
        const type = el('employerOpportunityType').value;
        const workFormat = el('employerOpportunityWorkFormat').value;
        const locationInput = el('employerOpportunityLocation');
        const locationHint = el('employerOpportunityLocationHint');
        const eventDateGroup = el('employerOpportunityEventDateGroup');

        if (type === 'event') {
            eventDateGroup.classList.remove('d-none');
        } else {
            eventDateGroup.classList.add('d-none');
            el('employerOpportunityEventDate').value = '';
        }

        if (workFormat === 'remote') {
            locationInput.placeholder = 'Например: Москва';
            locationHint.textContent = 'Для удаленного формата укажи город работодателя или организатора.';
        } else if (type === 'event') {
            locationInput.placeholder = 'Например: Санкт-Петербург, Кронверкский пр., 49';
            locationHint.textContent = 'Для офлайн-мероприятия лучше указать точный адрес площадки.';
        } else {
            locationInput.placeholder = 'Например: Москва, ул. Льва Толстого, 16';
            locationHint.textContent = 'Укажи адрес офиса, площадки или город работодателя.';
        }
    }

    function buildEmployerOpportunityPayload() {
        return {
            title: (el('employerOpportunityTitle').value || '').trim(),
            description: (el('employerOpportunityDescription').value || '').trim(),
            type: el('employerOpportunityType').value,
            work_format: el('employerOpportunityWorkFormat').value,
            location: (el('employerOpportunityLocation').value || '').trim(),
            salary_range: normalizeText(el('employerOpportunitySalary').value),
            expires_at: el('employerOpportunityExpiresAt').value ? new Date(el('employerOpportunityExpiresAt').value).toISOString() : null,
            event_date: el('employerOpportunityEventDate').value ? new Date(el('employerOpportunityEventDate').value).toISOString() : null,
            is_active: el('employerOpportunityActive').checked,
            tag_ids: selectedTagIdsFromContainer('employerOpportunityTagOptions'),
        };
    }

    async function saveEmployerOpportunity({ id = null, payload, successMessage }) {
        const path = id ? `/opportunities/${id}` : '/opportunities/';
        const method = id ? 'PUT' : 'POST';
        const response = await apiFetch(path, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось сохранить карточку.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось сохранить карточку.');
            return false;
        }

        const savedOpportunity = await response.json().catch(() => null);
        if (savedOpportunity?.id) {
            state.selectedOpportunityId = savedOpportunity.id;
        }

        await Promise.all([
            loadEmployerOpportunities(),
            loadOpportunities(),
            loadEmployerResponses(),
        ]);
        if (successMessage) {
            showNotice('success', successMessage);
        }
        return true;
    }

    async function deleteEmployerOpportunity(opportunityId) {
        const confirmed = window.confirm('Удалить карточку возможности? Это действие нельзя отменить.');
        if (!confirmed) return;

        const response = await apiFetch(`/opportunities/${opportunityId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось удалить карточку.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось удалить карточку.');
            return;
        }

        await Promise.all([
            loadEmployerOpportunities(),
            loadOpportunities(),
            loadEmployerResponses(),
        ]);
        showNotice('success', 'Карточка удалена.');
    }

    function applyEmployerOpportunityFilters() {
        state.employerOpportunityFilters.status = el('employerOpportunityStatusFilter').value;
        state.employerOpportunityFilters.type = el('employerOpportunityTypeFilter').value;
        state.employerOpportunityFilters.search = el('employerOpportunitySearch').value.trim();
        void loadEmployerOpportunities();
    }

    function resetEmployerOpportunityFilters() {
        el('employerOpportunityStatusFilter').value = '';
        el('employerOpportunityTypeFilter').value = '';
        el('employerOpportunitySearch').value = '';
        applyEmployerOpportunityFilters();
    }

    async function handleEmployerOpportunitySubmit(event) {
        event.preventDefault();
        const payload = buildEmployerOpportunityPayload();
        const isEdit = Boolean(state.pendingEmployerOpportunityId);
        const saved = await saveEmployerOpportunity({
            id: state.pendingEmployerOpportunityId,
            payload,
            successMessage: isEdit ? 'Карточка обновлена.' : 'Карточка создана.',
        });

        if (!saved) {
            return;
        }

        getEmployerOpportunityModal().hide();
        event.target.reset();
        resetEmployerOpportunityForm();
    }

    return {
        renderEmployerResponses,
        renderEmployerOpportunities,
        applyEmployerResponseFilters,
        resetEmployerResponseFilters,
        applyEmployerOpportunityFilters,
        resetEmployerOpportunityFilters,
        openEmployerOpportunityModal,
        syncEmployerOpportunityFieldHints,
        handleEmployerOpportunitySubmit,
    };
}
