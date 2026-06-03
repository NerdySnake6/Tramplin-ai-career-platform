import {
    contactStatusLabel,
    createEl,
    el,
    formatDate,
    opportunityTypeLabel,
    showNotice,
    statusLabel,
    workFormatLabel,
} from './utils.js';
import { apiFetch } from './api.js';

export function createApplicantController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
    selectedOpportunity,
    getRecommendModal,
    getApplicantProfileModal,
    getApplyModal,
    loadContacts,
    loadRecommendations,
    loadResponses,
    renderOpportunitiesSection,
}) {
    function hasApplied(opportunityId) {
        return state.responses.some((response) => response.opportunity_id === opportunityId);
    }

    function renderResponses() {
        const container = el('responses-list');
        const refreshBtn = el('refreshResponsesBtn');
        container.innerHTML = '';

        if (!state.currentUser || state.currentUser.role !== 'applicant') {
            refreshBtn.classList.add('d-none');
            container.appendChild(createEl('p', 'text-muted mb-0', 'Войди как соискатель, чтобы видеть свои отклики.'));
            return;
        }

        refreshBtn.classList.remove('d-none');

        if (!state.responses.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'Откликов пока нет.'));
            return;
        }

        state.responses.forEach((response) => {
            const item = createEl('div', 'response-item py-2');
            const title = state.opportunities.find((opportunity) => opportunity.id === response.opportunity_id)?.title
                || `Вакансия #${response.opportunity_id}`;

            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', title));
            top.appendChild(createEl('span', `status-pill ${response.status}`, statusLabel(response.status)));

            item.appendChild(top);
            item.appendChild(createEl('div', 'small text-muted mt-1', `Отправлен: ${formatDate(response.created_at)}`));

            if (response.cover_letter) {
                item.appendChild(createEl('div', 'small mt-2', response.cover_letter));
            }

            container.appendChild(item);
        });
        renderWorkspaceHero();
    }

    async function sendContactRequest(addresseeId) {
        const response = await apiFetch('/contacts/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ addressee_id: addresseeId }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось отправить заявку в контакты.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось отправить заявку в контакты.');
            return;
        }

        await loadContacts();
        showNotice('success', 'Заявка в контакты отправлена.');
    }

    async function updateContactStatus(contactId, status) {
        const response = await apiFetch(`/contacts/${contactId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось обновить статус контакта.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось обновить статус контакта.');
            return;
        }

        await loadContacts();
        showNotice('success', status === 'accepted' ? 'Контакт подтвержден.' : 'Заявка отклонена.');
    }

    function openRecommendModal(peerId) {
        const contact = state.contacts.find((item) => item.peer.id === peerId && item.status === 'accepted');
        const opportunity = selectedOpportunity();
        if (!contact) {
            showNotice('danger', 'Сначала нужен подтвержденный контакт.');
            return;
        }
        if (!opportunity) {
            showNotice('danger', 'Сначала выбери вакансию или мероприятие на главной.');
            return;
        }

        state.pendingRecommendationPeerId = peerId;
        el('recommendPeerMeta').textContent = `Кому: ${contact.peer.applicant_profile?.full_name || contact.peer.display_name}`;
        el('recommendOpportunityMeta').textContent = `Что рекомендуешь: ${opportunity.title} | ${opportunity.employer_name}`;
        el('recommendMessage').value = '';
        refreshFieldCounters();
        getRecommendModal().show();
    }

    async function handleRecommendationSubmit(event) {
        event.preventDefault();
        const opportunity = selectedOpportunity();
        if (!state.pendingRecommendationPeerId || !opportunity) {
            showNotice('danger', 'Не удалось определить контакт или выбранную возможность.');
            return;
        }

        const response = await apiFetch('/recommendations/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recommended_user_id: state.pendingRecommendationPeerId,
                opportunity_id: opportunity.id,
                message: (el('recommendMessage').value || '').trim() || null,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось отправить рекомендацию.' }));
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось отправить рекомендацию.');
            return;
        }

        getRecommendModal().hide();
        event.target.reset();
        state.pendingRecommendationPeerId = null;
        await loadRecommendations();
        showNotice('success', 'Рекомендация отправлена контакту.');
    }

    async function openApplicantProfileModal(userId) {
        const container = el('applicantProfileDetails');
        container.innerHTML = '<p class="text-muted mb-0">Загрузка профиля...</p>';
        getApplicantProfileModal().show();

        const response = await apiFetch(`/profiles/applicants/${userId}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось загрузить профиль.' }));
            container.innerHTML = '';
            container.appendChild(createEl('div', 'alert alert-warning mb-0', typeof error.detail === 'string' ? error.detail : 'Не удалось загрузить профиль.'));
            return;
        }

        const data = await response.json();
        const profile = data.applicant_profile;
        container.innerHTML = '';
        container.appendChild(createEl('h3', 'h5 mb-1', profile.full_name || data.display_name));
        container.appendChild(createEl('div', 'small text-muted mb-3', data.is_contact ? 'Контакт в твоей сети' : 'Открытый профиль'));

        const meta = [
            profile.university,
            profile.course_or_year,
        ].filter(Boolean);
        if (meta.length) {
            container.appendChild(createEl('div', 'small text-muted mb-2', meta.join(' | ')));
        }
        if (profile.skills) {
            container.appendChild(createEl('div', 'mb-2', `Навыки: ${profile.skills}`));
        }
        if (profile.experience) {
            container.appendChild(createEl('div', 'mb-2', `Опыт: ${profile.experience}`));
        }
        if (profile.bio) {
            container.appendChild(createEl('div', 'mb-3', profile.bio));
        }

        if (!data.visible_responses.length) {
            container.appendChild(createEl('div', 'small text-muted', 'Отклики скрыты настройками приватности или пока отсутствуют.'));
            return;
        }

        container.appendChild(createEl('h4', 'small text-uppercase text-muted mt-3 mb-2', 'Видимые отклики'));
        data.visible_responses.forEach((responseItem) => {
            const item = createEl('div', 'contact-item py-2');
            item.appendChild(createEl('div', 'fw-semibold', `Отклик на возможность #${responseItem.opportunity_id}`));
            item.appendChild(createEl('div', 'small text-muted mt-1', `Статус: ${statusLabel(responseItem.status)}`));
            if (responseItem.cover_letter) {
                item.appendChild(createEl('div', 'small mt-2', responseItem.cover_letter));
            }
            container.appendChild(item);
        });
    }

    function renderContactsSection() {
        const suggestionsContainer = el('contact-suggestions-list');
        const contactsContainer = el('contacts-list');
        const recommendationsContainer = el('recommendations-list');
        const refreshBtn = el('refreshContactsBtn');
        suggestionsContainer.innerHTML = '';
        contactsContainer.innerHTML = '';
        recommendationsContainer.innerHTML = '';

        if (!state.currentUser || state.currentUser.role !== 'applicant') {
            refreshBtn.classList.add('d-none');
            suggestionsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Войди как соискатель, чтобы расширять сеть контактов.'));
            contactsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Контакты и заявки в сеть появятся после входа.'));
            recommendationsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Рекомендации появятся после входа.'));
            renderWorkspaceHero();
            return;
        }

        refreshBtn.classList.remove('d-none');

        if (!state.contactSuggestions.length) {
            suggestionsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Подходящих открытых профилей пока нет или все уже у тебя в сети.'));
        } else {
            state.contactSuggestions.forEach((person) => {
                const item = createEl('div', 'contact-item py-2');
                const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
                top.appendChild(createEl('div', 'fw-semibold', person.applicant_profile?.full_name || person.display_name));
                top.appendChild(createEl('span', 'status-pill pending', 'Открытый профиль'));
                item.appendChild(top);

                const metaParts = [
                    person.display_name,
                    person.applicant_profile?.university,
                    person.applicant_profile?.course_or_year,
                ].filter(Boolean);
                if (metaParts.length) {
                    item.appendChild(createEl('div', 'small text-muted mt-1', metaParts.join(' | ')));
                }
                if (person.applicant_profile?.skills) {
                    item.appendChild(createEl('div', 'small mt-1', `Навыки: ${person.applicant_profile.skills}`));
                }
                if (person.applicant_profile?.bio) {
                    item.appendChild(createEl('div', 'small text-muted mt-1', person.applicant_profile.bio));
                }

                const action = createEl('div', 'contact-actions');
                const profileBtn = createEl('button', 'btn btn-sm btn-outline-secondary', 'Открыть профиль');
                profileBtn.type = 'button';
                profileBtn.addEventListener('click', () => {
                    void openApplicantProfileModal(person.id);
                });
                action.appendChild(profileBtn);

                const requestBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Добавить в контакты');
                requestBtn.type = 'button';
                requestBtn.addEventListener('click', () => {
                    void sendContactRequest(person.id);
                });
                action.appendChild(requestBtn);
                item.appendChild(action);
                suggestionsContainer.appendChild(item);
            });
        }

        if (!state.contacts.length) {
            contactsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Пока нет ни входящих, ни подтвержденных контактов.'));
            renderWorkspaceHero();
            return;
        }

        state.contacts.forEach((contact) => {
            const item = createEl('div', 'contact-item py-2');
            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', contact.peer.applicant_profile?.full_name || contact.peer.display_name));
            const pillClass = contact.status === 'accepted' ? 'accepted' : contact.status === 'declined' ? 'rejected' : 'pending';
            top.appendChild(createEl('span', `status-pill ${pillClass}`, contactStatusLabel(contact.status)));
            item.appendChild(top);

            const directionText = contact.direction === 'incoming' ? 'Входящая заявка' : 'Исходящая заявка';
            const metaParts = [
                directionText,
                contact.peer.applicant_profile?.university,
                contact.peer.applicant_profile?.course_or_year,
            ].filter(Boolean);
            item.appendChild(createEl('div', 'small text-muted mt-1', metaParts.join(' | ')));

            if (contact.peer.applicant_profile?.skills) {
                item.appendChild(createEl('div', 'small mt-1', `Навыки: ${contact.peer.applicant_profile.skills}`));
            }
            if (contact.peer.applicant_profile?.bio) {
                item.appendChild(createEl('div', 'small text-muted mt-1', contact.peer.applicant_profile.bio));
            }

            if (contact.direction === 'incoming' && contact.status === 'pending') {
                const actions = createEl('div', 'contact-actions');
                const profileBtn = createEl('button', 'btn btn-sm btn-outline-secondary', 'Открыть профиль');
                profileBtn.type = 'button';
                profileBtn.addEventListener('click', () => {
                    void openApplicantProfileModal(contact.peer.id);
                });
                actions.appendChild(profileBtn);

                const acceptBtn = createEl('button', 'btn btn-sm btn-outline-success', 'Принять');
                acceptBtn.type = 'button';
                acceptBtn.addEventListener('click', () => {
                    void updateContactStatus(contact.id, 'accepted');
                });
                actions.appendChild(acceptBtn);

                const declineBtn = createEl('button', 'btn btn-sm btn-outline-danger', 'Отклонить');
                declineBtn.type = 'button';
                declineBtn.addEventListener('click', () => {
                    void updateContactStatus(contact.id, 'declined');
                });
                actions.appendChild(declineBtn);
                item.appendChild(actions);
            } else if (contact.status === 'accepted') {
                const actions = createEl('div', 'contact-actions');
                const profileBtn = createEl('button', 'btn btn-sm btn-outline-secondary', 'Открыть профиль');
                profileBtn.type = 'button';
                profileBtn.addEventListener('click', () => {
                    void openApplicantProfileModal(contact.peer.id);
                });
                actions.appendChild(profileBtn);

                const recommendBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Рекомендовать выбранную карточку');
                recommendBtn.type = 'button';
                recommendBtn.disabled = !selectedOpportunity();
                recommendBtn.addEventListener('click', () => {
                    openRecommendModal(contact.peer.id);
                });
                actions.appendChild(recommendBtn);
                item.appendChild(actions);
            }

            contactsContainer.appendChild(item);
        });

        if (!state.recommendations.length) {
            recommendationsContainer.appendChild(createEl('p', 'text-muted mb-0', 'Ты еще не отправлял и не получал рекомендации.'));
            renderWorkspaceHero();
            return;
        }

        state.recommendations.forEach((recommendation) => {
            const item = createEl('div', 'contact-item py-2');
            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2');
            top.appendChild(createEl('div', 'fw-semibold', recommendation.opportunity.title));
            top.appendChild(
                createEl(
                    'span',
                    `status-pill ${recommendation.direction === 'incoming' ? 'accepted' : 'pending'}`,
                    recommendation.direction === 'incoming' ? 'Рекомендовано тебе' : 'Ты рекомендовал'
                )
            );
            item.appendChild(top);
            item.appendChild(
                createEl(
                    'div',
                    'small text-muted mt-1',
                    `${recommendation.peer.display_name} | ${opportunityTypeLabel(recommendation.opportunity.type)} | ${recommendation.opportunity.employer_name}`
                )
            );
            item.appendChild(
                createEl(
                    'div',
                    'small text-muted',
                    `${workFormatLabel(recommendation.opportunity.work_format)} | ${recommendation.opportunity.location}`
                )
            );
            if (recommendation.message) {
                item.appendChild(createEl('div', 'small mt-2', recommendation.message));
            }
            const actions = createEl('div', 'contact-actions');
            const profileBtn = createEl('button', 'btn btn-sm btn-outline-secondary', 'Открыть профиль');
            profileBtn.type = 'button';
            profileBtn.addEventListener('click', () => {
                void openApplicantProfileModal(recommendation.peer.id);
            });
            actions.appendChild(profileBtn);
            item.appendChild(actions);
            recommendationsContainer.appendChild(item);
        });
        renderWorkspaceHero();
    }

    function openApplyModal(opportunityId) {
        const opportunity = state.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity) return;
        if (hasApplied(opportunityId)) {
            showNotice('warning', 'Ты уже откликался на эту возможность.');
            return;
        }

        state.pendingApplyId = opportunityId;
        el('applyOpportunityMeta').textContent = `${opportunity.title} | ${opportunity.location}`;
        el('coverLetter').value = '';
        el('copyCoverLetterBtn')?.classList.add('d-none');
        renderCoverLetterAiResult(null);
        refreshFieldCounters();
        getApplyModal().show();
    }

    function renderCoverLetterAiResult(result) {
        const container = el('coverLetterAiResult');
        if (!container) return;
        container.innerHTML = '';
        container.classList.toggle('d-none', !result);
        if (!result) return;

        const panel = createEl('div', 'ai-helper-result');
        if (Array.isArray(result.fit_reasons) && result.fit_reasons.length) {
            panel.appendChild(createEl('div', 'fw-semibold mb-1', 'Почему подходит:'));
            const reasons = createEl('ul', '');
            result.fit_reasons.forEach((reason) => {
                reasons.appendChild(createEl('li', '', reason));
            });
            panel.appendChild(reasons);
        }
        if (Array.isArray(result.gaps) && result.gaps.length) {
            panel.appendChild(createEl('div', 'text-muted mt-2', `Что стоит уточнить: ${result.gaps.join('; ')}`));
        }
        container.appendChild(panel);
    }

    async function handleCoverLetterAiGenerate() {
        if (!state.pendingApplyId) return;

        const button = el('generateCoverLetterAiBtn');
        button.disabled = true;
        button.textContent = 'AI пишет...';

        const resultContainer = el('coverLetterAiResult');
        if (resultContainer) {
            resultContainer.innerHTML = '';
            resultContainer.classList.remove('d-none');
            const skeleton = createEl('div', 'p-3 border rounded');
            skeleton.appendChild(createEl('div', 'skeleton-line skeleton-title'));
            skeleton.appendChild(createEl('div', 'skeleton-line skeleton-text'));
            skeleton.appendChild(createEl('div', 'skeleton-line skeleton-text short'));
            resultContainer.appendChild(skeleton);
        }

        const coverField = el('coverLetter');
        const originalText = coverField ? coverField.value : "";
        if (coverField) {
            coverField.placeholder = "AI пишет сопроводительное письмо...";
            coverField.value = "";
        }

        try {
            const response = await apiFetch('/ai/cover-letter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ opportunity_id: state.pendingApplyId }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: 'AI-помощник временно недоступен.' }));
                showNotice('danger', typeof error.detail === 'string' ? error.detail : 'AI-помощник временно недоступен.');
                renderCoverLetterAiResult(null);
                if (coverField) {
                    coverField.placeholder = "";
                    coverField.value = originalText;
                }
                return;
            }

            const result = await response.json();
            el('coverLetter').value = result.cover_letter || '';
            el('copyCoverLetterBtn')?.classList.remove('d-none');
            renderCoverLetterAiResult(result);
            refreshFieldCounters();
            showNotice('success', 'AI подготовил черновик письма. Проверь текст перед отправкой.');
        } catch (_error) {
            showNotice('danger', 'AI-помощник временно недоступен.');
            renderCoverLetterAiResult(null);
            if (coverField) {
                coverField.placeholder = "";
                coverField.value = originalText;
            }
        } finally {
            button.disabled = false;
            button.textContent = 'Сгенерировать с AI';
        }
    }

    async function handleApplySubmit(event) {
        event.preventDefault();

        if (!state.pendingApplyId) return;

        const response = await apiFetch('/responses/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                opportunity_id: state.pendingApplyId,
                cover_letter: el('coverLetter').value.trim() || null,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Не удалось отправить отклик.' }));
            if (response.status === 409) {
                getApplyModal().hide();
                state.pendingApplyId = null;
                await loadResponses();
                renderOpportunitiesSection();
                showNotice('warning', 'Ты уже откликался на эту возможность.');
                return;
            }
            showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось отправить отклик.');
            return;
        }

        getApplyModal().hide();
        state.pendingApplyId = null;
        event.target.reset();
        await loadResponses();
        renderOpportunitiesSection();
        showNotice('success', 'Отклик отправлен.');
    }

    return {
        renderResponses,
        renderContactsSection,
        openRecommendModal,
        handleRecommendationSubmit,
        openApplicantProfileModal,
        openApplyModal,
        handleApplySubmit,
        handleCoverLetterAiGenerate,
    };
}
