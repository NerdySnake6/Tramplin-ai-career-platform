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

const TAG_CATEGORY_ORDER = ['specialization', 'level', 'tech', 'employment_type', 'format'];

const levelTechMapping = {
    'intern': ['html/css', 'git', 'javascript', 'python', 'figma', 'sql', 'sqlite'],
    'junior': ['html/css', 'git', 'javascript', 'python', 'figma', 'sql', 'react', 'vue', 'postgresql', 'django', 'fastapi', 'rest api', 'node.js', 'tailwind css', 'sqlite', 'mysql'],
    'junior+': ['html/css', 'git', 'javascript', 'typescript', 'python', 'figma', 'sql', 'react', 'vue', 'postgresql', 'django', 'fastapi', 'rest api', 'node.js', 'tailwind css', 'docker', 'next.js', 'nestjs', 'mysql', 'mongodb', 'sqlite'],
    'middle': ['python', 'java', 'javascript', 'typescript', 'sql', 'react', 'vue', 'node.js', 'django', 'fastapi', 'postgresql', 'docker', 'git', 'linux', 'rest api', 'ci/cd', 'tailwind css', 'next.js', 'nestjs', 'spring boot', 'go', 'mysql', 'mongodb', 'redis', 'nginx'],
    'middle+': ['python', 'java', 'javascript', 'typescript', 'sql', 'react', 'vue', 'node.js', 'django', 'fastapi', 'postgresql', 'docker', 'git', 'linux', 'rest api', 'ci/cd', 'next.js', 'nestjs', 'spring boot', 'go', 'rust', 'c#', 'c++', 'php', 'mysql', 'mongodb', 'redis', 'nginx', 'graphql', 'grpc', 'rabbitmq', 'ansible', 'aws'],
    'senior': ['python', 'java', 'typescript', 'sql', 'react', 'angular', 'node.js', 'postgresql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'pandas', 'bi', 'ml/ai', 'data science', 'go', 'rust', 'c#', 'c++', 'redis', 'elasticsearch', 'clickhouse', 'kafka', 'graphql', 'grpc', 'terraform', 'ansible', 'aws'],
    'senior+': ['python', 'java', 'typescript', 'sql', 'react', 'angular', 'node.js', 'postgresql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'pandas', 'bi', 'ml/ai', 'data science', 'go', 'rust', 'c#', 'c++', 'redis', 'elasticsearch', 'clickhouse', 'kafka', 'graphql', 'grpc', 'terraform', 'ansible', 'aws'],
    'team lead': ['python', 'java', 'sql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'bi', 'aws', 'terraform'],
    'tech lead': ['python', 'java', 'sql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'go', 'rust', 'clickhouse', 'kafka', 'graphql', 'grpc', 'terraform', 'aws'],
    'architect': ['python', 'java', 'sql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'go', 'rust', 'clickhouse', 'kafka', 'graphql', 'grpc', 'terraform', 'aws'],
    'lead': ['python', 'java', 'sql', 'docker', 'kubernetes', 'ci/cd', 'linux', 'bi', 'ml/ai', 'data science', 'aws', 'terraform']
};

const specTechMapping = {
    'frontend': ['html/css', 'javascript', 'typescript', 'react', 'vue', 'angular', 'figma', 'git', 'next.js', 'nuxt.js', 'svelte', 'tailwind css'],
    'backend': ['python', 'java', 'sql', 'node.js', 'django', 'fastapi', 'postgresql', 'docker', 'git', 'linux', 'rest api', 'go', 'rust', 'c#', 'c++', 'php', 'ruby', 'spring boot', 'nestjs', 'laravel', 'asp.net core', 'mysql', 'redis', 'elasticsearch', 'clickhouse', 'graphql', 'grpc', 'rabbitmq', 'kafka', 'nginx'],
    'fullstack': ['html/css', 'javascript', 'typescript', 'react', 'vue', 'node.js', 'python', 'sql', 'postgresql', 'docker', 'git', 'rest api', 'next.js', 'nestjs', 'tailwind css', 'mysql', 'redis', 'nginx'],
    'devops': ['docker', 'kubernetes', 'ci/cd', 'linux', 'git', 'terraform', 'ansible', 'aws', 'grafana', 'prometheus', 'nginx'],
    'data analyst': ['sql', 'python', 'pandas', 'bi', 'postgresql', 'git', 'sqlite', 'clickhouse'],
    'data science': ['python', 'sql', 'pandas', 'ml/ai', 'postgresql', 'git', 'numpy', 'pytorch', 'tensorflow'],
    'ml/ai': ['python', 'ml/ai', 'pandas', 'docker', 'linux', 'git', 'numpy', 'pytorch', 'tensorflow'],
    'qa': ['python', 'javascript', 'sql', 'rest api', 'git', 'postgresql', 'sqlite', 'selenium'],
    'mobile': ['javascript', 'typescript', 'react', 'rest api', 'git', 'swift', 'kotlin', 'dart', 'flutter', 'react native'],
    'ux/ui designer': ['figma', 'html/css']
};

const techSearchQueries = {
    filterTagOptions: '',
    employerOpportunityTagOptions: '',
    curatorOpportunityTags: ''
};

const allTechShownStates = {
    filterTagOptions: false,
    employerOpportunityTagOptions: false,
    curatorOpportunityTags: false
};

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
            const emptyState = createEl('div', 'empty-state-panel border-0 bg-transparent py-4 my-2');
            const icon = hasActiveOpportunityFilters() ? '0' : '—';
            emptyState.appendChild(createEl('div', 'empty-state-icon mb-2', icon));
            emptyState.appendChild(createEl('div', 'fw-semibold', hasActiveOpportunityFilters() ? 'По текущим фильтрам ничего не найдено' : 'Пока нет опубликованных возможностей'));
            emptyState.appendChild(createEl('div', 'text-muted small', 'Вы можете сбросить фильтры ниже, чтобы увидеть все доступные предложения.'));
            container.appendChild(emptyState);
            return;
        }

        opportunities.forEach((opportunity) => {
            const card = createEl('div', `card shadow-sm border-0 employer-home-opportunity-card${state.selectedOpportunityId === opportunity.id ? ' active' : ''}`);
            card.dataset.opportunityId = String(opportunity.id);
            const body = createEl('div', 'card-body py-3');

            const top = createEl('div', 'd-flex flex-column gap-2 mb-2');
            const titleWrap = createEl('div', 'opportunity-title-wrap');
            const title = createEl('h3', 'card-title h5 mb-1');
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

            const badges = createEl('div', 'd-flex flex-wrap gap-1');
            badges.appendChild(createEl('small', 'opportunity-status-chip opportunity-type-chip', opportunityTypeLabel(opportunity.type)));
            if (opportunity.employer_is_verified) {
                badges.appendChild(createEl('small', 'opportunity-status-chip bg-success', '✓ Проверен куратором'));
            }
            badges.appendChild(createEl('small', 'opportunity-status-chip bg-indigo', '🤖 AI-проверка'));
            top.appendChild(badges);
            body.appendChild(top);

            body.appendChild(createEl('p', 'detail-meta mb-2', `${workFormatLabel(opportunity.work_format)} | ${opportunity.location}`));
            body.appendChild(createEl('p', 'mb-3', opportunity.description.length > 170 ? `${opportunity.description.slice(0, 170)}...` : opportunity.description));

            const metaList = createEl('div', 'card-facts-container mb-3');
            
            const factPub = createEl('div', 'card-fact-item');
            factPub.innerHTML = `📅 <span>Публикация: ${formatDate(opportunity.published_at)}</span>`;
            metaList.appendChild(factPub);

            const factExp = createEl('div', 'card-fact-item');
            factExp.innerHTML = `⏳ <span>Срок до: ${formatDate(opportunity.expires_at)}</span>`;
            metaList.appendChild(factExp);

            if (opportunity.salary_range) {
                const factSal = createEl('div', 'card-fact-item');
                factSal.innerHTML = `💰 <span>${opportunity.salary_range}</span>`;
                metaList.appendChild(factSal);
            }
            body.appendChild(metaList);

            if (Array.isArray(opportunity.tags) && opportunity.tags.length) {
                const tagsRow = createEl('div', 'd-flex flex-wrap gap-2 mb-3');
                opportunity.tags.forEach((tag) => {
                    tagsRow.appendChild(createEl('span', 'card-tag-badge', `#${tag.name}`));
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
            const icon = hasActiveOpportunityFilters() ? '0' : '—';
            panel.appendChild(createEl('div', 'empty-state-icon', icon));
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
                const resetBtn = createEl('button', 'btn btn-sm btn-outline-primary mt-2', 'Сбросить фильтры');
                resetBtn.type = 'button';
                resetBtn.addEventListener('click', resetOpportunityFilters);
                panel.appendChild(resetBtn);
            } else {
                panel.appendChild(createEl('div', 'small text-muted mt-2', 'Начать можно с регистрации или изучения карты.'));
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
            const title = createEl('h3', 'h6 mb-1');
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
                if (filters.salary === 'paid') {
                    if (!opportunity.is_paid) return false;
                } else {
                    const minRequired = Number(filters.salary);
                    const salaryValue = opportunity.salary_max ?? opportunity.salary_min ?? 0;
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
        
        Object.keys(techSearchQueries).forEach(key => {
            techSearchQueries[key] = '';
        });
        Object.keys(allTechShownStates).forEach(key => {
            allTechShownStates[key] = false;
        });

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
            const emptyState = createEl('div', 'empty-state-panel p-3 border-0 bg-transparent');
            emptyState.appendChild(createEl('div', 'empty-state-icon mb-2', '0'));
            emptyState.appendChild(createEl('div', 'fw-semibold small', 'Избранное пусто'));
            emptyState.appendChild(createEl('div', 'text-muted small', 'Добавляй интересные вакансии и компании, чтобы быстро возвращаться к ним.'));
            container.appendChild(emptyState);
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

        const selectedIdSet = new Set(selectedIds.map(Number));

        if (['filterTagOptions', 'employerOpportunityTagOptions', 'curatorOpportunityTags'].includes(containerId)) {
            const grid = createEl('div', 'filter-tags-grid');
            
            const specializations = state.tags.filter(tag => tag.category === 'specialization');
            const levels = state.tags.filter(tag => tag.category === 'level');
            const techs = state.tags.filter(tag => tag.category === 'tech');
            const employments = state.tags.filter(tag => tag.category === 'employment_type');

            // Helper to create tag choice button
            const createTagButton = (tag) => {
                const isActive = selectedIdSet.has(tag.id);
                const button = createEl('button', `tag-choice${isActive ? ' active' : ''}`, tag.name);
                button.type = 'button';
                button.dataset.tagId = String(tag.id);
                button.title = tagCategoryLabel(tag.category);
                if (toggleable) {
                    button.addEventListener('click', () => {
                        button.classList.toggle('active');
                        const selectedIds = selectedTagIdsFromContainer(containerId);
                        renderTagChoices(containerId, selectedIds);
                        
                        if (containerId === 'filterTagOptions') {
                            state.opportunityFilters.tagIds = selectedIds;
                            resetOpportunityPage();
                            void loadOpportunities();
                        }
                    });
                }
                return button;
            };

            // 1. Specialization Section
            if (specializations.length) {
                const specSection = createEl('div', 'filter-section');
                const specTitle = createEl('div', 'filter-section-title');
                specTitle.innerHTML = '<span>Направление</span><span class="filter-section-subtitle">Выберите сферу</span>';
                specSection.appendChild(specTitle);
                
                const specRow = createEl('div', 'filter-pills-row');
                specializations.forEach(tag => specRow.appendChild(createTagButton(tag)));
                specSection.appendChild(specRow);
                grid.appendChild(specSection);
            }

            // 2. Level Section
            if (levels.length) {
                const levelSection = createEl('div', 'filter-section level-selector-section');
                const levelTitle = createEl('div', 'filter-section-title');
                levelTitle.innerHTML = '<span>Грейд / Уровень</span><span class="filter-section-subtitle">Будет предложен соответствующий стек</span>';
                levelSection.appendChild(levelTitle);
                
                const levelRow = createEl('div', 'filter-pills-row');
                levels.forEach(tag => levelRow.appendChild(createTagButton(tag)));
                levelSection.appendChild(levelRow);
                grid.appendChild(levelSection);
            }

            // 3. Tech Stack Section
            if (techs.length) {
                const selectedLevels = levels.filter(tag => selectedIdSet.has(tag.id)).map(tag => tag.name.toLowerCase());
                const selectedSpecs = specializations.filter(tag => selectedIdSet.has(tag.id)).map(tag => tag.name.toLowerCase());
                
                // Define standard lists of technologies for selected options
                const recommendedTechNames = new Set();
                selectedLevels.forEach(lvl => {
                    const list = levelTechMapping[lvl] || [];
                    list.forEach(t => recommendedTechNames.add(t));
                });
                selectedSpecs.forEach(spec => {
                    const list = specTechMapping[spec] || [];
                    list.forEach(t => recommendedTechNames.add(t));
                });

                const hasLevelOrSpecSelected = selectedLevels.length > 0 || selectedSpecs.length > 0;
                
                const recommendedTechs = [];
                const otherTechs = [];
                
                techs.forEach(tag => {
                    const normName = tag.name.toLowerCase();
                    const isSelected = selectedIdSet.has(tag.id);
                    
                    let isRecommended = false;
                    if (isSelected) {
                        isRecommended = true;
                    } else if (hasLevelOrSpecSelected) {
                        isRecommended = recommendedTechNames.has(normName);
                    } else {
                        const popularTechs = ['python', 'javascript', 'typescript', 'sql', 'react', 'docker', 'git', 'html/css', 'postgresql', 'node.js'];
                        isRecommended = popularTechs.includes(normName);
                    }
                    
                    if (isRecommended) {
                        recommendedTechs.push(tag);
                    } else {
                        otherTechs.push(tag);
                    }
                });

                const techSection = createEl('div', 'filter-section');
                const techTitle = createEl('div', 'filter-section-title');
                techTitle.innerHTML = '<span>Стек технологий</span><span class="filter-section-subtitle">Выбери технологии</span>';
                techSection.appendChild(techTitle);
                
                // Render search wrapper
                const searchWrapper = createEl('div', 'tech-search-wrapper');
                const searchInput = createEl('input', 'tech-search-input');
                searchInput.type = 'text';
                searchInput.placeholder = '🔍 Начните вводить технологию...';
                searchInput.value = techSearchQueries[containerId] || '';
                
                const clearBtn = createEl('button', 'tech-search-clear', '×');
                clearBtn.type = 'button';
                clearBtn.style.display = techSearchQueries[containerId] ? 'block' : 'none';
                
                searchWrapper.appendChild(searchInput);
                searchWrapper.appendChild(clearBtn);
                techSection.appendChild(searchWrapper);
                
                // Containers for tags
                const recommendedHeading = createEl('div', 'tech-subheading', hasLevelOrSpecSelected ? 'Рекомендуемые технологии' : 'Популярные технологии');
                const recommendedRow = createEl('div', 'filter-pills-row tech-tags-container');
                
                const otherHeading = createEl('div', 'tech-subheading', 'Другие технологии');
                const otherRow = createEl('div', 'filter-pills-row tech-tags-container');
                
                otherHeading.style.display = allTechShownStates[containerId] || techSearchQueries[containerId] ? 'block' : 'none';
                otherRow.style.display = allTechShownStates[containerId] || techSearchQueries[containerId] ? 'flex' : 'none';
                
                const toggleBtn = createEl('button', 'toggle-all-tech-btn');
                toggleBtn.type = 'button';
                toggleBtn.innerHTML = allTechShownStates[containerId] ? '✕ Скрыть другие' : '⚙ Показать все технологии';
                toggleBtn.style.display = (otherTechs.length > 0 && !techSearchQueries[containerId]) ? 'inline-flex' : 'none';

                const createTechButton = (tag) => {
                    const isActive = selectedIdSet.has(tag.id);
                    const button = createEl('button', `tag-choice${isActive ? ' active' : ''}`, tag.name);
                    button.type = 'button';
                    button.dataset.tagId = String(tag.id);
                    button.dataset.tagName = tag.name.toLowerCase();
                    button.title = tagCategoryLabel(tag.category);
                    if (toggleable) {
                        button.addEventListener('click', () => {
                            button.classList.toggle('active');
                            const selectedIds = selectedTagIdsFromContainer(containerId);
                            renderTagChoices(containerId, selectedIds);
                            
                            if (containerId === 'filterTagOptions') {
                                state.opportunityFilters.tagIds = selectedIds;
                                resetOpportunityPage();
                                void loadOpportunities();
                            }
                        });
                    }
                    return button;
                };
                
                recommendedTechs.forEach(tag => recommendedRow.appendChild(createTechButton(tag)));
                otherTechs.forEach(tag => otherRow.appendChild(createTechButton(tag)));

                techSection.appendChild(recommendedHeading);
                techSection.appendChild(recommendedRow);
                
                if (otherTechs.length > 0) {
                    techSection.appendChild(otherHeading);
                    techSection.appendChild(otherRow);
                    techSection.appendChild(toggleBtn);
                }

                // Apply initial search filter if a query exists
                const initialQuery = techSearchQueries[containerId] || '';
                if (initialQuery) {
                    const allTechButtons = techSection.querySelectorAll('.tech-tags-container .tag-choice');
                    let hasVisibleOthers = false;
                    allTechButtons.forEach(btn => {
                        const name = btn.dataset.tagName || '';
                        const matches = name.includes(initialQuery);
                        btn.style.display = matches ? 'inline-block' : 'none';
                        if (otherRow.contains(btn) && matches) {
                            hasVisibleOthers = true;
                        }
                    });
                    otherHeading.style.display = hasVisibleOthers ? 'block' : 'none';
                    otherRow.style.display = hasVisibleOthers ? 'flex' : 'none';
                    toggleBtn.style.display = 'none';
                    recommendedHeading.style.display = 'none';
                }

                // Add search & clear listeners
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.trim().toLowerCase();
                    techSearchQueries[containerId] = query;
                    clearBtn.style.display = query ? 'block' : 'none';
                    
                    const allTechButtons = techSection.querySelectorAll('.tech-tags-container .tag-choice');
                    let hasVisibleOthers = false;
                    
                    allTechButtons.forEach(btn => {
                        const name = btn.dataset.tagName || '';
                        const matches = name.includes(query);
                        btn.style.display = matches ? 'inline-block' : 'none';
                        
                        if (otherRow.contains(btn) && matches) {
                            hasVisibleOthers = true;
                        }
                    });
                    
                    if (query) {
                        otherHeading.style.display = hasVisibleOthers ? 'block' : 'none';
                        otherRow.style.display = hasVisibleOthers ? 'flex' : 'none';
                        toggleBtn.style.display = 'none';
                        recommendedHeading.style.display = 'none';
                    } else {
                        recommendedHeading.style.display = 'block';
                        otherHeading.style.display = allTechShownStates[containerId] ? 'block' : 'none';
                        otherRow.style.display = allTechShownStates[containerId] ? 'flex' : 'none';
                        toggleBtn.style.display = 'inline-flex';
                    }
                });
                
                clearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    techSearchQueries[containerId] = '';
                    clearBtn.style.display = 'none';
                    
                    const allTechButtons = techSection.querySelectorAll('.tech-tags-container .tag-choice');
                    allTechButtons.forEach(btn => {
                        btn.style.display = 'inline-block';
                    });
                    
                    recommendedHeading.style.display = 'block';
                    otherHeading.style.display = allTechShownStates[containerId] ? 'block' : 'none';
                    otherRow.style.display = allTechShownStates[containerId] ? 'flex' : 'none';
                    toggleBtn.style.display = otherTechs.length > 0 ? 'inline-flex' : 'none';
                    searchInput.focus();
                });
                
                toggleBtn.addEventListener('click', () => {
                    allTechShownStates[containerId] = !allTechShownStates[containerId];
                    const isShown = allTechShownStates[containerId];
                    toggleBtn.innerHTML = isShown ? '✕ Скрыть другие' : '⚙ Показать все технологии';
                    otherHeading.style.display = isShown ? 'block' : 'none';
                    otherRow.style.display = isShown ? 'flex' : 'none';
                });

                grid.appendChild(techSection);
            }

            // 4. Employment Section
            if (employments.length) {
                const empSection = createEl('div', 'filter-section');
                const empTitle = createEl('div', 'filter-section-title');
                empTitle.innerHTML = '<span>Занятость</span><span class="filter-section-subtitle">Тип занятости</span>';
                empSection.appendChild(empTitle);
                
                const empRow = createEl('div', 'filter-pills-row');
                employments.forEach(tag => empRow.appendChild(createTagButton(tag)));
                empSection.appendChild(empRow);
                grid.appendChild(empSection);
            }

            container.appendChild(grid);
            return;
        }

        const categories = [...new Set(state.tags.map((tag) => tag.category))].sort((left, right) => {
            const leftIndex = TAG_CATEGORY_ORDER.indexOf(left);
            const rightIndex = TAG_CATEGORY_ORDER.indexOf(right);
            const normalizedLeftIndex = leftIndex === -1 ? TAG_CATEGORY_ORDER.length : leftIndex;
            const normalizedRightIndex = rightIndex === -1 ? TAG_CATEGORY_ORDER.length : rightIndex;
            if (normalizedLeftIndex !== normalizedRightIndex) {
                return normalizedLeftIndex - normalizedRightIndex;
            }
            return tagCategoryLabel(left).localeCompare(tagCategoryLabel(right), 'ru');
        });

        categories.forEach((category) => {
            const categoryTags = state.tags.filter((tag) => tag.category === category);
            const selectedCount = categoryTags.filter((tag) => selectedIdSet.has(tag.id)).length;
            const group = createEl('details', 'tag-category-group');
            group.open = category === 'specialization' || category === 'level' || selectedCount > 0;

            const summary = createEl('summary', 'tag-category-summary');
            summary.appendChild(createEl('span', 'tag-category-title', tagCategoryLabel(category)));
            summary.appendChild(createEl('span', 'tag-category-count', selectedCount ? `${selectedCount}/${categoryTags.length}` : String(categoryTags.length)));
            group.appendChild(summary);

            const options = createEl('div', 'tag-category-options');
            categoryTags.forEach((tag) => {
                const button = createEl('button', `tag-choice${selectedIdSet.has(tag.id) ? ' active' : ''}`, tag.name);
                button.type = 'button';
                button.dataset.tagId = String(tag.id);
                button.title = tagCategoryLabel(tag.category);
                if (toggleable) {
                    button.addEventListener('click', () => {
                        button.classList.toggle('active');
                        if (containerId === 'filterTagOptions') {
                            state.opportunityFilters.tagIds = selectedTagIdsFromContainer('filterTagOptions');
                            renderTagChoices('filterTagOptions', state.opportunityFilters.tagIds);
                            resetOpportunityPage();
                            void loadOpportunities();
                        }
                    });
                }
                options.appendChild(button);
            });

            group.appendChild(options);
            container.appendChild(group);
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
