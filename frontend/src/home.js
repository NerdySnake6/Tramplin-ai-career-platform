import {
    isFavoriteCompany,
    isFavoriteOpportunity,
    toggleFavoriteCompany,
    toggleFavoriteOpportunity,
} from './state.js';
import {
    createEl,
    el,
    formatDate,
    includesText,
    opportunityTypeLabel,
    selectedTagIdsFromContainer,
    tagCategoryLabel,
    workFormatLabel,
} from './utils.js';
import { hasCoords } from './map.js';

export function createHomeController({
    state,
    renderMap,
    centerOnOpportunity,
    renderWorkspaceHero,
    renderContactsSection,
    openApplyModal,
    openOpportunityDetailsModal,
    openEmployerOpportunityModal,
    deleteTagFromLibrary,
    navigateToOpportunity,
    loadOpportunities,
}) {
    function hasApplied(opportunityId) {
        return state.responses.some((response) => response.opportunity_id === opportunityId);
    }

    function hasActiveOpportunityFilters() {
        return Boolean(
            state.opportunityFilters.type
            || state.opportunityFilters.workFormat
            || state.opportunityFilters.location
            || state.opportunityFilters.search
            || state.opportunityFilters.favorites
            || state.opportunityFilters.salary
            || state.opportunityFilters.tagIds.length
        );
    }

    function renderHomeDeck(opportunities) {
        const row = el('employerHomeDeckRow');
        const container = el('employerHomeDeck');
        const canUseFavorites = !state.currentUser || state.currentUser.role === 'applicant';
        if (!row || !container) return;

        const shouldShow = state.activeView === 'home';
        row.classList.toggle('d-none', !shouldShow);
        container.innerHTML = '';

        if (!shouldShow) {
            return;
        }

        if (!opportunities.length) {
            const emptyState = createEl('div', 'card shadow-sm border-0 employer-home-empty');
            const body = createEl('div', 'card-body py-3');
            body.appendChild(createEl('div', 'home-section-title mb-2', 'Карточки возможностей'));
            body.appendChild(createEl('p', 'text-muted mb-0', hasActiveOpportunityFilters() ? 'По текущим фильтрам карточки не найдены.' : 'Когда появятся новые возможности, они будут показаны здесь в верхней сетке.'));
            emptyState.appendChild(body);
            container.appendChild(emptyState);
            return;
        }

        opportunities.forEach((opportunity) => {
            const card = createEl('div', `card shadow-sm border-0 employer-home-opportunity-card${state.selectedOpportunityId === opportunity.id ? ' active' : ''}`);
            card.dataset.opportunityId = String(opportunity.id);
            const body = createEl('div', 'card-body py-3');

            const top = createEl('div', 'd-flex justify-content-between align-items-start gap-2 mb-2');
            const titleWrap = createEl('div', 'opportunity-title-wrap');
            const title = createEl('h5', 'card-title mb-1');
            const titleLink = createEl('a', 'opportunity-title-link', opportunity.title);
            titleLink.href = `/opportunities/${opportunity.id}`;
            titleLink.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                navigateToOpportunity(opportunity.id);
            });
            title.appendChild(titleLink);
            titleWrap.appendChild(title);
            titleWrap.appendChild(createEl('div', 'detail-meta', opportunity.employer_name || 'Работодатель'));
            top.appendChild(titleWrap);

            const badges = createEl('div', 'd-flex flex-wrap justify-content-end gap-1');
            badges.appendChild(createEl('small', 'opportunity-status-chip opportunity-type-chip', opportunityTypeLabel(opportunity.type)));
            if (opportunity.employer_is_verified) {
                badges.appendChild(createEl('small', 'opportunity-status-chip bg-success', '✓ Проверен куратором'));
            }
            badges.appendChild(createEl('small', 'opportunity-status-chip bg-indigo', '🤖 AI-проверка'));
            top.appendChild(badges);
            body.appendChild(top);

            body.appendChild(createEl('p', 'detail-meta mb-2', `${opportunityTypeLabel(opportunity.type)} | ${workFormatLabel(opportunity.work_format)} | ${opportunity.location}`));
            body.appendChild(createEl('p', 'mb-3', opportunity.description.length > 170 ? `${opportunity.description.slice(0, 170)}...` : opportunity.description));

            const metaList = createEl('div', 'small text-muted mb-3');
            metaList.appendChild(createEl('div', '', `Публикация: ${formatDate(opportunity.published_at)}`));
            metaList.appendChild(createEl('div', '', `Дата закрытия: ${formatDate(opportunity.expires_at)}`));
            if (opportunity.salary_range) {
                metaList.appendChild(createEl('div', '', `Вознаграждение: ${opportunity.salary_range}`));
            }
            body.appendChild(metaList);

            if (Array.isArray(opportunity.tags) && opportunity.tags.length) {
                const tagsRow = createEl('div', 'd-flex flex-wrap gap-2 mb-3');
                opportunity.tags.forEach((tag) => {
                    tagsRow.appendChild(createEl('span', 'badge text-bg-light', `#${tag.name}`));
                });
                body.appendChild(tagsRow);
            }

            const actions = createEl('div', 'd-flex flex-wrap gap-2');

            if (canUseFavorites) {
                const favoriteOpportunityBtn = createEl(
                    'button',
                    isFavoriteOpportunity(opportunity.id) ? 'btn btn-danger' : 'btn btn-outline-danger',
                    isFavoriteOpportunity(opportunity.id) ? 'В избранном: вакансия' : 'В избранное: вакансия'
                );
                favoriteOpportunityBtn.type = 'button';
                favoriteOpportunityBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleFavoriteOpportunity(opportunity.id);
                    renderOpportunitiesSection();
                });
                actions.appendChild(favoriteOpportunityBtn);

                const favoriteCompanyBtn = createEl(
                    'button',
                    isFavoriteCompany(opportunity.employer_id) ? 'btn btn-warning' : 'btn btn-outline-warning',
                    isFavoriteCompany(opportunity.employer_id) ? 'В избранном: компания' : 'В избранное: компания'
                );
                favoriteCompanyBtn.type = 'button';
                favoriteCompanyBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleFavoriteCompany(opportunity.employer_id, opportunity.employer_name);
                    renderOpportunitiesSection();
                });
                actions.appendChild(favoriteCompanyBtn);
            }

            if (state.currentUser?.role === 'applicant') {
                const alreadyApplied = hasApplied(opportunity.id);
                const applyBtn = createEl(
                    'button',
                    alreadyApplied ? 'btn btn-outline-secondary' : 'btn btn-primary',
                    alreadyApplied ? 'Отклик отправлен' : 'Откликнуться'
                );
                applyBtn.type = 'button';
                applyBtn.disabled = alreadyApplied;
                applyBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openApplyModal(opportunity.id);
                });
                actions.appendChild(applyBtn);
            }

            if (state.currentUser?.role === 'employer' && state.currentUser.id === opportunity.employer_id) {
                const editBtn = createEl('button', 'btn btn-outline-primary', 'Редактировать');
                editBtn.type = 'button';
                editBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openEmployerOpportunityModal(opportunity.id);
                });
                actions.appendChild(editBtn);
            }

            body.appendChild(actions);
            card.appendChild(body);

            card.addEventListener('click', () => {
                state.selectedOpportunityId = opportunity.id;
                centerOnOpportunity(opportunity);
                renderOpportunitiesSection();
                openOpportunityDetailsModal(opportunity.id);
            });

            container.appendChild(card);
        });
    }

    function renderList(opportunities) {
        const list = el('opportunities-list');
        const count = el('homeOpportunityCount');
        const canUseFavorites = !state.currentUser || state.currentUser.role === 'applicant';
        const pagination = state.opportunityPagination;
        list.innerHTML = '';
        if (count) {
            const resultLabel = opportunities.length === 1
                ? 'результат'
                : opportunities.length < 5
                    ? 'результата'
                    : 'результатов';
            count.textContent = pagination.page > 1 || pagination.hasNext
                ? `Страница ${pagination.page}: ${opportunities.length} ${resultLabel}`
                : `${opportunities.length} ${resultLabel}`;
        }

        if (!opportunities.length) {
            const panel = createEl('div', 'empty-state-panel');
            panel.appendChild(createEl('div', 'empty-state-icon', '✦'));
            panel.appendChild(createEl('div', 'fw-semibold', hasActiveOpportunityFilters() ? 'По текущим фильтрам ничего не найдено' : 'Пока нет опубликованных возможностей'));
            panel.appendChild(
                createEl(
                    'div',
                    'text-muted small',
                    hasActiveOpportunityFilters()
                        ? 'Попробуй убрать часть фильтров или выбрать другие теги, чтобы расширить поиск.'
                        : 'Когда работодатели и организаторы добавят карточки, они появятся здесь и на карте.'
                )
            );
            if (hasActiveOpportunityFilters()) {
                const resetBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Сбросить фильтры');
                resetBtn.type = 'button';
                resetBtn.addEventListener('click', resetOpportunityFilters);
                panel.appendChild(resetBtn);
            } else {
                panel.appendChild(createEl('div', 'small text-muted', 'Начать можно с регистрации или изучения карты.'));
            }
            list.appendChild(panel);
            return;
        }

        opportunities.forEach((opportunity) => {
            const favoriteOpportunity = canUseFavorites && isFavoriteOpportunity(opportunity.id);
            const favoriteCompany = canUseFavorites && isFavoriteCompany(opportunity.employer_id);
            const isSelected = state.selectedOpportunityId === opportunity.id;
            const item = createEl(
                'div',
                `list-group-item opportunity-item${isSelected ? ' active selected' : ''}${favoriteOpportunity ? ' favorite-opportunity' : ''}${!favoriteOpportunity && favoriteCompany ? ' favorite-company' : ''}`
            );
            item.dataset.opportunityId = String(opportunity.id);

            const shortDesc = opportunity.description.length > 120
                ? `${opportunity.description.slice(0, 120)}...`
                : opportunity.description;

            const header = createEl('div', 'd-flex w-100 justify-content-between gap-2');
            const titleWrap = createEl('div', 'opportunity-title-wrap');
            const title = createEl('h6', 'mb-1');
            const titleLink = createEl('a', 'opportunity-title-link', opportunity.title);
            titleLink.href = `/opportunities/${opportunity.id}`;
            titleLink.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                navigateToOpportunity(opportunity.id);
            });
            title.appendChild(titleLink);
            titleWrap.appendChild(title);
            titleWrap.appendChild(createEl('div', 'small text-muted', opportunity.employer_name || 'Работодатель'));
            header.appendChild(titleWrap);

            const badges = createEl('div', 'd-flex flex-wrap gap-1 justify-content-end align-items-start');
            badges.appendChild(createEl('small', 'opportunity-status-chip opportunity-type-chip', opportunityTypeLabel(opportunity.type)));
            if (opportunity.employer_is_verified) {
                badges.appendChild(createEl('small', 'opportunity-status-chip bg-success', '✓ Проверено'));
            }
            badges.appendChild(createEl('small', 'opportunity-status-chip bg-indigo', '🤖 AI'));
            if (favoriteOpportunity) {
                badges.appendChild(createEl('small', 'badge text-bg-danger', 'Избр. вакансия'));
            } else if (favoriteCompany) {
                badges.appendChild(createEl('small', 'badge text-bg-warning', 'Избр. компания'));
            }
            header.appendChild(badges);

            const desc = createEl('p', 'mb-1', shortDesc);
            const meta = createEl('small');
            const icon = createEl('span', 'location-dot', '•');
            icon.setAttribute('aria-hidden', 'true');
            meta.appendChild(icon);
            meta.append(` ${opportunity.location} | ${workFormatLabel(opportunity.work_format)}`);
            if (opportunity.salary_range) {
                meta.append(` | ${opportunity.salary_range}`);
            }

            item.appendChild(header);
            item.appendChild(desc);
            item.appendChild(meta);

            item.addEventListener('click', () => {
                state.selectedOpportunityId = opportunity.id;
                renderOpportunitiesSection();
                centerOnOpportunity(opportunity);
                openOpportunityDetailsModal(opportunity.id);
            });

            list.appendChild(item);
        });
    }

    function renderPaginationControls() {
        const container = el('homePagination');
        if (!container) return;

        const pagination = state.opportunityPagination;
        const hasPagination = pagination.page > 1 || pagination.hasNext || pagination.isLoading;
        container.innerHTML = '';
        container.classList.toggle('d-none', !hasPagination);
        if (!hasPagination) return;

        const prevBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Назад');
        prevBtn.type = 'button';
        prevBtn.disabled = pagination.page <= 1 || pagination.isLoading;
        prevBtn.addEventListener('click', () => {
            if (state.opportunityPagination.page <= 1) return;
            state.opportunityPagination.page -= 1;
            void loadOpportunities();
        });

        const label = createEl('span', 'home-pagination-label', `Страница ${pagination.page}`);

        const nextBtn = createEl('button', 'btn btn-sm btn-outline-primary', 'Вперед');
        nextBtn.type = 'button';
        nextBtn.disabled = !pagination.hasNext || pagination.isLoading;
        nextBtn.addEventListener('click', () => {
            if (!state.opportunityPagination.hasNext) return;
            state.opportunityPagination.page += 1;
            void loadOpportunities();
        });

        container.appendChild(prevBtn);
        container.appendChild(label);
        container.appendChild(nextBtn);
    }

    function getFilteredOpportunities() {
        const filters = state.opportunityFilters;
        return state.opportunities.filter((opportunity) => {
            if (filters.type && opportunity.type !== filters.type) return false;
            if (filters.workFormat && opportunity.work_format !== filters.workFormat) return false;
            if (filters.location && !includesText(opportunity.location, filters.location)) return false;
            if (filters.favorites === 'vacancies' && !isFavoriteOpportunity(opportunity.id)) return false;
            if (filters.favorites === 'companies' && !isFavoriteCompany(opportunity.employer_id)) return false;
            if (filters.favorites === 'all' && !isFavoriteOpportunity(opportunity.id) && !isFavoriteCompany(opportunity.employer_id)) return false;
            if (filters.tagIds.length) {
                const opportunityTagIds = Array.isArray(opportunity.tags) ? opportunity.tags.map((tag) => tag.id) : [];
                if (!filters.tagIds.every((tagId) => opportunityTagIds.includes(tagId))) return false;
            }
            if (filters.salary) {
                const salaryStr = opportunity.salary_range;
                if (!salaryStr) return false;

                const parseSalary = (str) => {
                    const clean = str.replace(/\s+/g, '');
                    const numbers = clean.match(/\d+/g);
                    if (!numbers || !numbers.length) return 0;
                    return Math.max(...numbers.map(Number));
                };

                const salaryValue = parseSalary(salaryStr);
                if (filters.salary === 'paid') {
                    const unpaidKeywords = ['неоплач', 'без оплаты', 'не оплач', 'unpaid'];
                    const isExplicitlyUnpaid = unpaidKeywords.some((keyword) =>
                        salaryStr.toLowerCase().includes(keyword)
                    );
                    if (isExplicitlyUnpaid || salaryValue <= 0) return false;
                } else {
                    const minRequired = Number(filters.salary);
                    if (salaryValue < minRequired) return false;
                }
            }
            if (filters.search) {
                const tags = Array.isArray(opportunity.tags) ? opportunity.tags.map((tag) => tag.name).join(' ') : '';
                const text = [
                    opportunity.title,
                    opportunity.employer_name,
                    opportunity.description,
                    opportunity.location,
                    opportunity.type,
                    opportunity.work_format,
                    opportunity.salary_range || '',
                    tags,
                ].join(' ');
                if (!includesText(text, filters.search)) return false;
            }
            return true;
        });
    }

    function syncSelectedOpportunity(filteredOpportunities) {
        if (!filteredOpportunities.length) {
            state.selectedOpportunityId = null;
            return;
        }
        const selectedStillVisible = filteredOpportunities.some((item) => item.id === state.selectedOpportunityId);
        if (!selectedStillVisible && state.activeView !== 'home') {
            state.selectedOpportunityId = filteredOpportunities[0].id;
        } else if (!selectedStillVisible) {
            state.selectedOpportunityId = null;
        }
    }

    function renderOpportunitiesSection() {
        const filtered = getFilteredOpportunities();
        syncSelectedOpportunity(filtered);
        renderHomeDeck(filtered);
        renderList(filtered);
        renderPaginationControls();
        renderMap(filtered);
        renderFavoritesSummary();
        renderWorkspaceHero();
    }

    function resetOpportunityPage() {
        state.opportunityPagination.page = 1;
        state.opportunityPagination.hasNext = false;
    }

    function applyOpportunityFilters() {
        state.opportunityFilters.type = el('filterType').value;
        state.opportunityFilters.workFormat = el('filterWorkFormat').value;
        state.opportunityFilters.location = el('filterLocation').value.trim();
        state.opportunityFilters.search = el('filterSearch').value.trim();
        state.opportunityFilters.favorites = el('filterFavorites').value;
        state.opportunityFilters.salary = el('filterSalary')?.value || '';
        state.opportunityFilters.tagIds = selectedTagIdsFromContainer('filterTagOptions');
        resetOpportunityPage();
        void loadOpportunities();
    }

    function resetOpportunityFilters() {
        el('filterType').value = '';
        el('filterWorkFormat').value = '';
        el('filterLocation').value = '';
        el('filterSearch').value = '';
        el('filterFavorites').value = '';
        if (el('filterSalary')) el('filterSalary').value = '';
        state.opportunityFilters.tagIds = [];
        renderTagChoices('filterTagOptions', []);
        applyOpportunityFilters();
    }

    function renderFavoritesSummary() {
        const container = el('favorites-summary');
        const badge = el('favoriteSummaryBadge');
        const canUseFavorites = !state.currentUser || state.currentUser.role === 'applicant';
        container.innerHTML = '';

        if (!canUseFavorites) {
            badge.textContent = '0';
            return;
        }

        const favoriteOpportunities = state.opportunities.filter((item) => isFavoriteOpportunity(item.id));
        const favoriteCompanies = state.favoriteCompanyIds
            .map((companyId) => {
                const currentOpportunity = state.opportunities.find((item) => item.employer_id === companyId) || null;
                return {
                    companyId,
                    companyName: currentOpportunity?.employer_name || state.favoriteCompanyNames[String(companyId)] || 'Компания',
                    currentOpportunity,
                };
            });

        badge.textContent = String(favoriteOpportunities.length + favoriteCompanies.length);

        if (!favoriteOpportunities.length && !favoriteCompanies.length) {
            container.appendChild(createEl('p', 'text-muted mb-0', 'Пока ничего не добавлено в избранное.'));
            return;
        }

        favoriteCompanies.forEach((company) => {
            const chip = createEl('button', 'favorite-chip company', company.companyName);
            chip.type = 'button';
            chip.addEventListener('click', () => {
                el('filterFavorites').value = 'companies';
                state.opportunityFilters.favorites = 'companies';
                resetOpportunityPage();
                if (company.currentOpportunity) {
                    state.selectedOpportunityId = company.currentOpportunity.id;
                }
                renderOpportunitiesSection();
                if (company.currentOpportunity) {
                    centerOnOpportunity(company.currentOpportunity);
                }
            });
            container.appendChild(chip);
        });

        favoriteOpportunities.forEach((opportunity) => {
            const chip = createEl('button', 'favorite-chip opportunity', opportunity.title);
            chip.type = 'button';
            chip.addEventListener('click', () => {
                state.selectedOpportunityId = opportunity.id;
                renderOpportunitiesSection();
                centerOnOpportunity(opportunity);
            });
            container.appendChild(chip);
        });
    }

    function renderTagChoices(containerId, selectedIds = [], { toggleable = true } = {}) {
        const container = el(containerId);
        if (!container) return;
        container.innerHTML = '';

        if (!state.tags.length) {
            container.appendChild(createEl('span', 'text-muted small', 'Теги пока не загружены.'));
            return;
        }

        state.tags.forEach((tag) => {
            const button = createEl('button', `tag-choice${selectedIds.includes(tag.id) ? ' active' : ''}`, tag.name);
            button.type = 'button';
            button.dataset.tagId = String(tag.id);
            button.title = tagCategoryLabel(tag.category);
            if (toggleable) {
                button.addEventListener('click', () => {
                    button.classList.toggle('active');
                    if (containerId === 'filterTagOptions') {
                        state.opportunityFilters.tagIds = selectedTagIdsFromContainer('filterTagOptions');
                        resetOpportunityPage();
                        void loadOpportunities();
                    }
                });
            }
            container.appendChild(button);
        });
    }

    function renderTagLibrary() {
        ['tag-library', 'curator-tag-library'].forEach((containerId) => {
            const container = el(containerId);
            if (!container) return;
            container.innerHTML = '';
            if (!state.tags.length) {
                container.appendChild(createEl('p', 'text-muted mb-0', 'Теги пока не загружены.'));
                return;
            }

            state.tags.forEach((tag) => {
                const item = createEl('span', 'tag-library-item');
                const title = createEl('span', 'tag-library-label', tag.name);
                item.appendChild(title);
                item.appendChild(createEl('small', 'ms-2', tagCategoryLabel(tag.category)));

                const canDeleteTag = containerId === 'curator-tag-library'
                    && ['curator', 'admin'].includes(state.currentUser?.role || '');

                if (canDeleteTag) {
                    const deleteBtn = createEl('button', 'tag-library-delete', '×');
                    deleteBtn.type = 'button';
                    deleteBtn.title = `Удалить тег "${tag.name}"`;
                    deleteBtn.setAttribute('aria-label', `Удалить тег ${tag.name}`);
                    deleteBtn.addEventListener('click', () => {
                        void deleteTagFromLibrary(tag);
                    });
                    item.appendChild(deleteBtn);
                }

                container.appendChild(item);
            });
        });
    }

    return {
        getFilteredOpportunities,
        renderHomeDeck,
        renderOpportunitiesSection,
        applyOpportunityFilters,
        resetOpportunityFilters,
        renderFavoritesSummary,
        renderTagChoices,
        renderTagLibrary,
    };
}
