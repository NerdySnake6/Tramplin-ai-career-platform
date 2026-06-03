import './style.css';
import {
    clearToken,
    getToken,
    isFavoriteCompany,
    isFavoriteOpportunity,
    loadFavoritesState,
    setToken,
    state,
    toggleFavoriteCompany,
    toggleFavoriteOpportunity,
} from './state.js';
import {
    contactStatusLabel,
    createEl,
    currentRoleLabel,
    curatorRoleLabel,
    debounce,
    el,
    formatDate,
    includesText,
    normalizeText,
    normalizeUrl,
    opportunityTypeLabel,
    renderAlert,
    selectedTagIdsFromContainer,
    showNotice,
    statusLabel,
    tagCategoryLabel,
    toDateTimeLocalValue,
    workFormatLabel,
    showToast,
} from './utils.js';
import { apiFetch } from './api.js';
import { createMapController, hasCoords } from './map.js';
import { refreshFieldCounters, setupFieldLimits } from './limits.js';
import { createHomeController } from './home.js';
import { createProfileController } from './profile.js';
import { createApplicantController } from './applicant.js';
import { createEmployerController } from './employer.js';
import { createCuratorController } from './curator.js';
import {
    isAboutRoute,
    renderPublicSeoSection,
    resolvePublicRoute,
    routeViewMeta,
    updateDocumentSeo,
} from './seo.js';

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled Rejection:', event.reason);
    showToast('danger', 'Ошибка', 'Что-то пошло не так. Попробуйте еще раз.');
});

window.addEventListener('error', (event) => {
    console.error('Global Error:', event.error);
    showToast('danger', 'Системная ошибка', 'Не удалось выполнить действие.');
});

const YANDEX_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY;
const MAP_UI_STATE = {
    idle: 'idle',
    loading: 'loading',
    ready: 'ready',
    error: 'error',
};

let currentPublicRoute = resolvePublicRoute(window.location.pathname);
let mapUiState = MAP_UI_STATE.idle;
let mapLoadPromise = null;
let mapAutoloadBound = false;
let mapAutoloadObserver = null;
let mapResizeObserver = null;
let mapHeightObserver = null;
let userHasInteracted = false;
let pendingVerificationEmail = '';

let loginModal;
let registerModal;
let opportunityDetailsModal;
let applyModal;
let recommendModal;
let applicantProfileModal;
let curatorUserModal;
let curatorCreateModal;
let curatorOpportunityModal;
let employerOpportunityModal;
let renderProfileSection;
let buildProfilePayload;
let renderResponses;
let renderContactsSection;
let openRecommendModal;
let handleRecommendationSubmit;
let openApplicantProfileModal;
let openApplyModal;
let handleApplySubmit;
let handleCoverLetterAiGenerate;
let renderEmployerResponses;
let renderEmployerOpportunities;
let applyEmployerResponseFilters;
let resetEmployerResponseFilters;
let applyEmployerOpportunityFilters;
let resetEmployerOpportunityFilters;
let openEmployerOpportunityModal;
let syncEmployerOpportunityFieldHints;
let handleEmployerOpportunitySubmit;
let handleEmployerOpportunityAiAssist;
let renderCuratorSection;
let openCuratorUserModal;
let openCuratorOpportunityModal;
let handleCuratorUserSubmit;
let handleCuratorCreateSubmit;
let handleCuratorOpportunitySubmit;
let handleCuratorOpportunityAiReview;

const mapController = createMapController({
    apiKey: YANDEX_API_KEY,
    state,
    isFavoriteOpportunity,
    isFavoriteCompany,
    createEl,
    opportunityTypeLabel,
    workFormatLabel,
    onSelectOpportunity(opportunityId) {
        state.selectedOpportunityId = opportunityId;
        renderOpportunitiesSection();
        requestAnimationFrame(() => {
            const target = document.querySelector(`[data-opportunity-id="${opportunityId}"]`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        });
    },
});
const initMap = mapController.initMap;
const renderMap = mapController.renderMap;
const centerOnOpportunity = mapController.centerOnOpportunity;
const resizeMap = mapController.resizeMap;

const homeController = createHomeController({
    state,
    renderMap,
    centerOnOpportunity,
    renderWorkspaceHero,
    renderContactsSection: (...args) => renderContactsSection(...args),
    openApplyModal: (...args) => openApplyModal(...args),
    openOpportunityDetailsModal: (...args) => openOpportunityDetailsModal(...args),
    openEmployerOpportunityModal: (...args) => openEmployerOpportunityModal(...args),
    deleteTagFromLibrary: (...args) => deleteTagFromLibrary(...args),
    navigateToOpportunity: (...args) => navigateToOpportunity(...args),
    loadOpportunities: () => loadOpportunities(),
});
const getFilteredOpportunities = homeController.getFilteredOpportunities;
const renderHomeDeck = homeController.renderHomeDeck;
const renderHomeOpportunitiesSection = homeController.renderOpportunitiesSection;
const applyOpportunityFilters = homeController.applyOpportunityFilters;
const resetOpportunityFilters = homeController.resetOpportunityFilters;
const renderFavoritesSummary = homeController.renderFavoritesSummary;
const renderTagChoices = homeController.renderTagChoices;
const renderTagLibrary = homeController.renderTagLibrary;

function syncMapStageHeight() {
    const mapStage = el('mapStage');
    const homeExplorerCard = el('homeExplorerCard');
    if (!mapStage || !homeExplorerCard) return;

    const isDesktopViewport = window.matchMedia('(min-width: 769px)').matches;
    const isVisible = mapStage.offsetParent !== null && homeExplorerCard.offsetParent !== null;
    if (!isDesktopViewport || !isVisible) {
        mapStage.style.removeProperty('height');
        return;
    }

    const targetHeight = Math.max(Math.ceil(homeExplorerCard.getBoundingClientRect().height), 760);
    mapStage.style.height = `${targetHeight}px`;
}

function setupMapHeightSync() {
    if (mapHeightObserver || !('ResizeObserver' in window)) return;

    const homeExplorerCard = el('homeExplorerCard');
    if (!homeExplorerCard) return;

    mapHeightObserver = new ResizeObserver(() => {
        syncMapStageHeight();
        if (mapUiState === MAP_UI_STATE.ready) {
            resizeMap();
        }
    });

    mapHeightObserver.observe(homeExplorerCard);
    window.addEventListener('resize', () => {
        syncMapStageHeight();
        if (mapUiState === MAP_UI_STATE.ready) {
            resizeMap();
        }
    }, { passive: true });
    syncMapStageHeight();
}

function setupMapResizeSync() {
    if (mapResizeObserver || !('ResizeObserver' in window)) return;

    const mapStage = el('mapStage');
    if (!mapStage) return;

    mapResizeObserver = new ResizeObserver(() => {
        if (mapUiState !== MAP_UI_STATE.ready) return;
        resizeMap();
    });

    mapResizeObserver.observe(mapStage);
}

function mapPreviewStatusText() {
    if (mapUiState === MAP_UI_STATE.error) {
        return YANDEX_API_KEY
            ? 'Не удалось загрузить карту. Попробуй еще раз.'
            : 'Не указан API-ключ Яндекс Карт. Проверь конфигурацию frontend.';
    }
    return '';
}

function renderMapShellState() {
    const mapStage = el('mapStage');
    const mapLoader = el('mapLoader');
    const mapButton = el('loadMapBtn');
    const mapStatusText = el('mapStatusText');
    const mapCanvas = el('map');

    if (!mapStage || !mapLoader || !mapButton || !mapStatusText || !mapCanvas) return;

    const isReady = mapUiState === MAP_UI_STATE.ready;
    const isLoading = mapUiState === MAP_UI_STATE.loading;
    const isError = mapUiState === MAP_UI_STATE.error;
    mapStage.classList.toggle('is-ready', isReady);
    mapCanvas.setAttribute('aria-hidden', String(!isReady));
    mapLoader.classList.toggle('d-none', !isLoading);
    mapStatusText.textContent = mapPreviewStatusText();
    mapStatusText.classList.toggle('d-none', !isError);

    mapButton.disabled = mapUiState === MAP_UI_STATE.loading;
    mapButton.classList.toggle('d-none', !isError);
    mapButton.textContent = mapUiState === MAP_UI_STATE.loading
        ? 'Загружаем...'
        : 'Повторить загрузку карты';
}

function canAutoloadMap() {
    const mapColumn = el('homeMapColumn');
    const mapStage = el('mapStage');
    if (!mapColumn || !mapStage) return false;

    return !mapColumn.classList.contains('d-none') && mapStage.offsetParent !== null;
}

function setupMapAutoload() {
    if (mapAutoloadBound) return;
    mapAutoloadBound = true;
    const mapStage = el('mapStage');
    if (!mapStage) return;

    const autoloadMap = () => {
        userHasInteracted = true;
        if (!canAutoloadMap() || mapUiState !== MAP_UI_STATE.idle || mapLoadPromise) {
            return;
        }
        void ensureMapReady();
    };

    const eagerAutoloadIfVisible = () => {
        userHasInteracted = true;
        if (!canAutoloadMap() || mapUiState !== MAP_UI_STATE.idle || mapLoadPromise) {
            return;
        }

        const rect = mapStage.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < viewportHeight + 120 && rect.bottom > -40) {
            void ensureMapReady();
        }
    };

    mapStage.addEventListener('pointerenter', autoloadMap, { once: true, passive: true });
    mapStage.addEventListener('pointerdown', autoloadMap, { once: true, passive: true });
    mapStage.addEventListener('touchstart', autoloadMap, { once: true, passive: true });
    mapStage.addEventListener('focusin', autoloadMap, { once: true });

    const interactionEvents = ['pointerdown', 'touchstart', 'wheel', 'keydown'];
    interactionEvents.forEach((eventName) => {
        window.addEventListener(eventName, eagerAutoloadIfVisible, { once: true, passive: true });
    });

    if ('IntersectionObserver' in window) {
        mapAutoloadObserver = new IntersectionObserver((entries) => {
            const shouldLoad = entries.some((entry) => entry.isIntersecting);
            if (!shouldLoad || !userHasInteracted) return;

            mapAutoloadObserver?.disconnect();
            mapAutoloadObserver = null;
            if (mapUiState === MAP_UI_STATE.idle && !mapLoadPromise && canAutoloadMap()) {
                void ensureMapReady();
            }
        }, {
            rootMargin: '120px 0px',
            threshold: 0.12,
        });

        mapAutoloadObserver.observe(mapStage);
    }
}

async function ensureMapReady(options = {}) {
    const { scroll = false } = options;

    if (scroll) {
        el('homeMapColumn')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (mapUiState === MAP_UI_STATE.ready) {
        renderMap(getFilteredOpportunities());
        const opportunity = selectedOpportunity();
        if (opportunity) {
            centerOnOpportunity(opportunity);
        }
        return true;
    }

    if (mapLoadPromise) {
        return mapLoadPromise;
    }

    mapUiState = MAP_UI_STATE.loading;
    renderMapShellState();

    mapLoadPromise = (async () => {
        try {
            await initMap();
            mapUiState = MAP_UI_STATE.ready;
            renderMapShellState();
            resizeMap();
            renderMap(getFilteredOpportunities());
            const opportunity = selectedOpportunity();
            if (opportunity) {
                centerOnOpportunity(opportunity);
            }
            return true;
        } catch (error) {
            console.error(error);
            mapUiState = MAP_UI_STATE.error;
            renderMapShellState();
            return false;
        } finally {
            mapLoadPromise = null;
        }
    })();

    return mapLoadPromise;
}

function renderOpportunitiesSection() {
    renderHomeOpportunitiesSection();
    renderMapShellState();
}

const profileController = createProfileController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
});
renderProfileSection = profileController.renderProfileSection;
buildProfilePayload = profileController.buildProfilePayload;

const applicantController = createApplicantController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
    selectedOpportunity,
    getRecommendModal: () => recommendModal,
    getApplicantProfileModal: () => applicantProfileModal,
    getApplyModal: () => applyModal,
    loadContacts: () => loadContacts(),
    loadRecommendations: () => loadRecommendations(),
    loadResponses: () => loadResponses(),
    renderOpportunitiesSection: () => renderOpportunitiesSection(),
});
renderResponses = applicantController.renderResponses;
renderContactsSection = applicantController.renderContactsSection;
openRecommendModal = applicantController.openRecommendModal;
handleRecommendationSubmit = applicantController.handleRecommendationSubmit;
openApplicantProfileModal = applicantController.openApplicantProfileModal;
openApplyModal = applicantController.openApplyModal;
handleApplySubmit = applicantController.handleApplySubmit;
handleCoverLetterAiGenerate = applicantController.handleCoverLetterAiGenerate;

const employerController = createEmployerController({
    state,
    renderWorkspaceHero,
    renderOpportunitiesSection: () => renderOpportunitiesSection(),
    refreshFieldCounters,
    renderTagChoices,
    loadEmployerResponses: () => loadEmployerResponses(),
    loadEmployerOpportunities: () => loadEmployerOpportunities(),
    loadOpportunities: () => loadOpportunities(),
    getEmployerOpportunityModal: () => employerOpportunityModal,
});
renderEmployerResponses = employerController.renderEmployerResponses;
renderEmployerOpportunities = employerController.renderEmployerOpportunities;
applyEmployerResponseFilters = employerController.applyEmployerResponseFilters;
resetEmployerResponseFilters = employerController.resetEmployerResponseFilters;
applyEmployerOpportunityFilters = employerController.applyEmployerOpportunityFilters;
resetEmployerOpportunityFilters = employerController.resetEmployerOpportunityFilters;
openEmployerOpportunityModal = employerController.openEmployerOpportunityModal;
syncEmployerOpportunityFieldHints = employerController.syncEmployerOpportunityFieldHints;
handleEmployerOpportunitySubmit = employerController.handleEmployerOpportunitySubmit;
handleEmployerOpportunityAiAssist = employerController.handleEmployerOpportunityAiAssist;

const curatorController = createCuratorController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
    loadCuratorData: () => loadCuratorData(),
    loadOpportunities: () => loadOpportunities(),
    getCuratorUserModal: () => curatorUserModal,
    getCuratorCreateModal: () => curatorCreateModal,
    getCuratorOpportunityModal: () => curatorOpportunityModal,
});
renderCuratorSection = curatorController.renderCuratorSection;
openCuratorUserModal = curatorController.openCuratorUserModal;
openCuratorOpportunityModal = curatorController.openCuratorOpportunityModal;
handleCuratorUserSubmit = curatorController.handleCuratorUserSubmit;
handleCuratorCreateSubmit = curatorController.handleCuratorCreateSubmit;
handleCuratorOpportunitySubmit = curatorController.handleCuratorOpportunitySubmit;
handleCuratorOpportunityAiReview = curatorController.handleCuratorOpportunityAiReview;

function visibleViews() {
    const views = ['home'];
    if (!state.currentUser) return views;

    views.push('profile');
    if (state.currentUser.role === 'applicant') {
        views.push('applicant');
    }
    if (state.currentUser.role === 'employer') {
        views.push('employer');
    }
    if (['curator', 'admin'].includes(state.currentUser.role)) {
        views.push('curator');
    }
    return views;
}

function setActiveView(view) {
    const allowedViews = visibleViews();
    state.activeView = allowedViews.includes(view) ? view : 'home';
    currentPublicRoute = resolvePublicRoute('/');
    if (state.activeView === 'home') {
        syncPublicRouteFilters();
    }
    syncBrowserPath('/');
    renderWorkspaceNav();
    renderWorkspaceView();
    renderOpportunitiesSection();
}

function selectedOpportunity() {
    return state.opportunities.find((item) => item.id === state.selectedOpportunityId) || null;
}

function routedOpportunity() {
    if (currentPublicRoute.key !== 'opportunity') return null;
    return state.opportunities.find((item) => item.id === currentPublicRoute.opportunityId) || null;
}

function syncPublicRouteFilters() {
    state.opportunityFilters.type = currentPublicRoute.filterType || '';
    state.opportunityFilters.workFormat = '';
    state.opportunityFilters.location = '';
    state.opportunityFilters.search = '';
    state.opportunityFilters.favorites = '';
    state.opportunityFilters.salary = '';
    state.opportunityFilters.tagIds = [];
    state.opportunityPagination.page = 1;
    state.opportunityPagination.hasNext = false;

    if (currentPublicRoute.key === 'opportunity') {
        state.selectedOpportunityId = currentPublicRoute.opportunityId;
    } else if (!currentPublicRoute.filterType) {
        state.selectedOpportunityId = null;
    }

    const fields = {
        filterType: state.opportunityFilters.type,
        filterWorkFormat: state.opportunityFilters.workFormat,
        filterLocation: state.opportunityFilters.location,
        filterSearch: state.opportunityFilters.search,
        filterFavorites: state.opportunityFilters.favorites,
        filterSalary: state.opportunityFilters.salary,
    };

    Object.entries(fields).forEach(([id, value]) => {
        const field = el(id);
        if (field) {
            field.value = value;
        }
    });

    renderTagChoices('filterTagOptions', []);
}

function syncBrowserPath(path, replace = false) {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentPath === path) return;

    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({}, '', path);
}

function navigateToPublicPath(path, { replace = false } = {}) {
    currentPublicRoute = resolvePublicRoute(path);
    state.activeView = 'home';
    syncPublicRouteFilters();
    syncBrowserPath(currentPublicRoute.canonicalPath, replace);
    renderWorkspaceNav();
    renderWorkspaceView();
    renderOpportunitiesSection();
}

function navigateToOpportunity(opportunityId) {
    navigateToPublicPath(`/opportunities/${opportunityId}`);
}

function buildOpportunityDetailsModal(opportunity) {
    const container = el('opportunityDetailsContent');
    const title = el('opportunityDetailsModalLabel');
    const meta = el('opportunityDetailsMeta');
    const actions = el('opportunityDetailsActions');
    if (!container || !title || !meta || !actions) return;

    title.textContent = opportunity.title;
    meta.textContent = `${opportunity.employer_name || 'Работодатель'} | ${opportunityTypeLabel(opportunity.type)} | ${workFormatLabel(opportunity.work_format)}`;

    container.innerHTML = '';
    actions.innerHTML = '';

    const summary = createEl('div', 'opportunity-details-summary');
    
    // Premium location pin styling
    const locationDiv = createEl('div', 'detail-meta-location mb-3');
    locationDiv.innerHTML = `📍 <span>${opportunity.location}</span>`;
    summary.appendChild(locationDiv);

    // Description text
    const descP = createEl('p', 'mb-4 opportunity-detail-desc', opportunity.description);
    summary.appendChild(descP);

    // Fact items grid
    const facts = createEl('div', 'opportunity-details-facts mb-4');
    
    const factPub = createEl('div', 'detail-fact-item');
    factPub.innerHTML = `<span class="detail-fact-icon">📅</span> <span>Публикация: ${formatDate(opportunity.published_at)}</span>`;
    facts.appendChild(factPub);

    const factExp = createEl('div', 'detail-fact-item');
    factExp.innerHTML = `<span class="detail-fact-icon">⏳</span> <span>Срок до: ${formatDate(opportunity.expires_at)}</span>`;
    facts.appendChild(factExp);

    if (opportunity.salary_range) {
        const factSal = createEl('div', 'detail-fact-item');
        factSal.innerHTML = `<span class="detail-fact-icon">💰</span> <span>Вознаграждение: ${opportunity.salary_range}</span>`;
        facts.appendChild(factSal);
    }
    summary.appendChild(facts);

    // Tags
    if (Array.isArray(opportunity.tags) && opportunity.tags.length) {
        const tagsRow = createEl('div', 'd-flex flex-wrap gap-2 mb-3');
        opportunity.tags.forEach((tag) => {
            tagsRow.appendChild(createEl('span', 'detail-tag-badge', `#${tag.name}`));
        });
        summary.appendChild(tagsRow);
    }

    // Call-to-action banner for non-registered users
    if (!state.currentUser) {
        const banner = createEl('div', 'guest-apply-banner mt-4');
        banner.innerHTML = `
            <span class="guest-apply-banner-icon">🔑</span>
            <div class="guest-apply-banner-content">
                <strong>Хотите откликнуться?</strong>
                <p class="mb-0">Войдите как соискатель, чтобы отправлять отклики на вакансии и использовать все функции платформы.</p>
            </div>
        `;
        summary.appendChild(banner);
    }

    container.appendChild(summary);

    const closeBtn = createEl('button', 'btn btn-outline-secondary', 'Закрыть');
    closeBtn.type = 'button';
    closeBtn.setAttribute('data-bs-dismiss', 'modal');
    actions.appendChild(closeBtn);

    const canUseFavorites = !state.currentUser || state.currentUser.role === 'applicant';
    if (canUseFavorites) {
        const favoriteOpportunityBtn = createEl(
            'button',
            isFavoriteOpportunity(opportunity.id) ? 'btn btn-danger' : 'btn btn-outline-danger',
            isFavoriteOpportunity(opportunity.id) ? 'В избранном: вакансия' : 'В избранное: вакансия'
        );
        favoriteOpportunityBtn.type = 'button';
        favoriteOpportunityBtn.addEventListener('click', () => {
            toggleFavoriteOpportunity(opportunity.id);
            renderOpportunitiesSection();
            buildOpportunityDetailsModal(opportunity);
        });
        actions.appendChild(favoriteOpportunityBtn);

        const favoriteCompanyBtn = createEl(
            'button',
            isFavoriteCompany(opportunity.employer_id) ? 'btn btn-warning' : 'btn btn-outline-warning',
            isFavoriteCompany(opportunity.employer_id) ? 'В избранном: компания' : 'В избранное: компания'
        );
        favoriteCompanyBtn.type = 'button';
        favoriteCompanyBtn.addEventListener('click', () => {
            toggleFavoriteCompany(opportunity.employer_id, opportunity.employer_name);
            renderOpportunitiesSection();
            buildOpportunityDetailsModal(opportunity);
        });
        actions.appendChild(favoriteCompanyBtn);
    }

    if (state.currentUser?.role === 'applicant') {
        const alreadyApplied = state.responses.some((response) => response.opportunity_id === opportunity.id);
        const applyBtn = createEl(
            'button',
            alreadyApplied ? 'btn btn-outline-secondary' : 'btn btn-primary',
            alreadyApplied ? 'Отклик отправлен' : 'Откликнуться'
        );
        applyBtn.type = 'button';
        applyBtn.disabled = alreadyApplied;
        applyBtn.addEventListener('click', () => {
            opportunityDetailsModal.hide();
            openApplyModal(opportunity.id);
        });
        actions.appendChild(applyBtn);
    }
}

function openOpportunityDetailsModal(opportunityId) {
    const opportunity = state.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || !opportunityDetailsModal) return;
    buildOpportunityDetailsModal(opportunity);
    opportunityDetailsModal.show();
    
    if (currentPublicRoute.key !== 'opportunity' || currentPublicRoute.opportunityId !== opportunityId) {
        syncBrowserPath(`/opportunities/${opportunityId}`);
        currentPublicRoute = resolvePublicRoute(`/opportunities/${opportunityId}`);
        updateDocumentSeo(currentPublicRoute, opportunity);
    }
}

function workspaceMetaForView() {
    const filteredOpportunities = getFilteredOpportunities();
    const favoriteCount = state.favoriteOpportunityIds.length + state.favoriteCompanyIds.length;

    if (state.activeView === 'home') {
        const publicMeta = routeViewMeta(currentPublicRoute, routedOpportunity(), {
            favoriteCount,
            filteredCount: filteredOpportunities.length,
            tagCount: state.opportunityFilters.tagIds.length,
        });
        if (publicMeta) {
            return publicMeta;
        }

        const homeTitle = state.currentUser
            ? 'Главная'
            : 'Трамплин для старта в IT';
        const homeDescription = state.currentUser
            ? 'Ищи вакансии, стажировки, менторские программы и карьерные события на карте и в ленте.'
            : 'Найди первую стажировку, вакансию или карьерное событие и сохрани интересные варианты еще до регистрации.';
        return {
            eyebrow: state.currentUser ? `Режим: ${currentRoleLabel(state.currentUser.role)}` : 'Публичная витрина',
            title: homeTitle,
            description: homeDescription,
            pills: [
                `${filteredOpportunities.length} возможностей`,
                `${state.opportunityFilters.tagIds.length} активных тегов`,
                `${favoriteCount} в избранном`,
            ],
        };
    }

    if (state.activeView === 'profile') {
        const roleLabel = state.currentUser ? currentRoleLabel(state.currentUser.role) : 'Гость';
        const profileIdentity = state.profile?.employer_profile?.company_name || state.currentUser?.display_name || 'Без названия';
        return {
            eyebrow: 'Личный кабинет',
            title: 'Профиль',
            description: 'Поддерживай профиль в актуальном состоянии: он влияет на то, как тебя видят работодатели, контакты и кураторы.',
            pills: [
                roleLabel,
                state.profile?.applicant_profile?.is_profile_public ? 'Профиль открыт' : 'Профиль скрыт',
                profileIdentity !== roleLabel ? profileIdentity : null,
            ],
        };
    }

    if (state.activeView === 'applicant') {
        const acceptedContacts = state.contacts.filter((item) => item.status === 'accepted').length;
        return {
            eyebrow: 'Кабинет соискателя',
            title: 'Соискатель',
            description: 'Следи за откликами, развивай профессиональные контакты и делись возможностями с людьми из своей сети.',
            pills: [
                `${state.responses.length} откликов`,
                `${acceptedContacts} контактов`,
                `${state.recommendations.length} рекомендаций`,
            ],
        };
    }

    if (state.activeView === 'employer') {
        const activeOpportunities = state.employerOpportunities.filter((item) => item.is_active).length;
        const verificationLabel = state.currentUser?.is_verified
            ? 'Компания верифицирована'
            : 'Нужна верификация';
        return {
            eyebrow: 'Кабинет работодателя',
            title: 'Работодатель',
            description: state.currentUser?.is_verified
                ? 'Управляй карточками возможностей, поддерживай витрину компании в актуальном состоянии и обрабатывай отклики.'
                : 'Чтобы публиковать стажировки, вакансии и события, сначала пройди верификацию у администратора или куратора платформы.',
            pills: [
                verificationLabel,
                `${state.employerOpportunities.length} карточек`,
                `${activeOpportunities} активных`,
                `${state.employerResponses.length} откликов`,
            ],
        };
    }

    if (state.activeView === 'curator') {
        const pendingEmployers = state.curatorUsers.filter((user) => user.role === 'employer' && !user.is_verified).length;
        return {
            eyebrow: state.currentUser?.role === 'admin' ? 'Панель администратора' : 'Панель модерации',
            title: 'Куратор',
            description: 'Проверяй работодателей, модерируй карточки возможностей и держи платформу в целостном и безопасном состоянии.',
            pills: [
                `${state.curatorUsers.length} пользователей`,
                `${pendingEmployers} ждут верификации`,
                `${state.curatorOpportunities.length} карточек`,
            ],
        };
    }

    return {
        eyebrow: 'Платформа',
        title: 'Трамплин',
        description: 'Карьерная платформа для студентов, выпускников, работодателей и карьерных центров.',
        pills: [],
    };
}

function renderWorkspaceHero() {
    const meta = workspaceMetaForView();
    el('workspaceEyebrow').textContent = meta.eyebrow;
    el('workspaceTitle').textContent = meta.title;
    el('workspaceDescription').textContent = meta.description;

    const metaContainer = el('workspaceMeta');
    metaContainer.innerHTML = '';
    meta.pills.filter(Boolean).forEach((pill) => {
        metaContainer.appendChild(createEl('span', 'workspace-pill', pill));
    });

    const responseHighlights = el('workspaceResponseHighlights');
    if (responseHighlights) {
        responseHighlights.innerHTML = '';
        const applicantUpdates = state.currentUser?.role === 'applicant'
            ? state.responses.filter((response) => response.status !== 'pending')
            : [];
        responseHighlights.classList.toggle('d-none', !applicantUpdates.length || state.activeView !== 'home');

        if (applicantUpdates.length && state.activeView === 'home') {
            const title = createEl('div', 'workspace-response-highlights-title', `Обновления по откликам: ${applicantUpdates.length}`);
            responseHighlights.appendChild(title);

            const list = createEl('div', 'workspace-response-highlights-list');
            responseHighlights.appendChild(list);

            applicantUpdates
                .slice()
                .sort((left, right) => new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at))
                .forEach((response) => {
                    const opportunity = state.opportunities.find((item) => item.id === response.opportunity_id);
                    const titleText = opportunity?.title || `Вакансия #${response.opportunity_id}`;
                    const statusText = statusLabel(response.status);
                    const item = createEl(
                        'button',
                        `workspace-response-highlight response-${response.status}`,
                        `${titleText} — ${statusText}`
                    );
                    item.type = 'button';
                    item.addEventListener('click', () => {
                        setActiveView('applicant');
                        el('responsesCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                    list.appendChild(item);
                });
        }
    }

    const heroActions = el('workspaceHeroActions');
    const exploreBtn = el('heroExploreBtn');
    const registerBtn = el('heroRegisterBtn');
    const loginBtn = el('heroLoginBtn');

    if (!heroActions || !exploreBtn || !registerBtn || !loginBtn) return;

    const isHome = state.activeView === 'home';
    const isGuest = !state.currentUser;
    heroActions.classList.toggle('d-none', !isHome);
    registerBtn.classList.toggle('d-none', !isGuest);
    loginBtn.classList.toggle('d-none', !isGuest);

    if (isGuest) {
        exploreBtn.textContent = 'Смотреть возможности';
        exploreBtn.className = 'btn btn-primary btn-sm';
        registerBtn.className = 'btn btn-outline-primary btn-sm';
    } else if (state.currentUser.role === 'applicant') {
        exploreBtn.textContent = 'Перейти к карте';
        exploreBtn.className = 'btn btn-primary btn-sm';
    } else if (state.currentUser.role === 'employer') {
        exploreBtn.textContent = 'Открыть витрину';
        exploreBtn.className = 'btn btn-primary btn-sm';
    } else {
        exploreBtn.textContent = 'Посмотреть платформу';
        exploreBtn.className = 'btn btn-primary btn-sm';
    }

    renderPublicSeoSection(currentPublicRoute, state, navigateToPublicPath);
    updateDocumentSeo(currentPublicRoute, routedOpportunity());
}

async function submitTagForm(nameInputId, categoryInputId, formElement) {
    const response = await apiFetch('/tags/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: (el(nameInputId).value || '').trim(),
            category: el(categoryInputId).value,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось добавить тег.' }));
        showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось добавить тег.');
        return;
    }

    formElement.reset();
    await loadTags();
    showNotice('success', 'Тег добавлен в справочник.');
}

async function deleteTagFromLibrary(tag) {
    if (!tag) return;

    const confirmed = window.confirm(`Удалить тег "${tag.name}" из справочника?`);
    if (!confirmed) return;

    const response = await apiFetch(`/tags/${tag.id}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось удалить тег.' }));
        showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось удалить тег.');
        return;
    }

    await loadTags();
    showNotice('success', `Тег "${tag.name}" удален из справочника.`);
}

async function handleTagSubmit(event) {
    event.preventDefault();
    await submitTagForm('tagNameInput', 'tagCategoryInput', event.target);
}

async function handleCuratorTagSubmit(event) {
    event.preventDefault();
    await submitTagForm('curatorTagNameInput', 'curatorTagCategoryInput', event.target);
}

function renderAuthUI() {
    const loginBtn = el('loginBtn');
    const registerBtn = el('registerBtn');
    const logoutNavItem = el('logoutNavItem');
    const currentUserNavItem = el('currentUserNavItem');
    const currentUserLabel = el('currentUserLabel');
    const authStatusBadge = el('authStatusBadge');
    const guestGuideCard = el('guestGuideCard');
    const guestGuideActions = el('guestGuideActions');
    const curatorTab = el('tabCurator');
    const canUseFavorites = !state.currentUser || state.currentUser.role === 'applicant';
    const favoritesFilterField = el('filterFavorites')?.closest('.col-md-6');
    const favoritesCardColumn = el('homeFavoritesCard')?.closest('.col-lg-4');
    const opportunitiesBoardColumn = el('homeOpportunityBlock')?.closest('.col-lg-8');

    if (state.currentUser) {
        loginBtn.parentElement.classList.add('d-none');
        registerBtn.parentElement.classList.add('d-none');
        logoutNavItem.classList.remove('d-none');
        currentUserNavItem.classList.remove('d-none');
        const roleLabel = currentRoleLabel(state.currentUser.role);
        currentUserLabel.textContent = state.currentUser.display_name === roleLabel
            ? state.currentUser.display_name
            : `${state.currentUser.display_name} (${roleLabel})`;
        authStatusBadge.textContent = currentRoleLabel(state.currentUser.role);
        authStatusBadge.className = 'badge text-bg-success';
        guestGuideCard?.classList.remove('d-none');
        guestGuideCard?.classList.add('signed-in-guide');
        guestGuideActions?.classList.add('d-none');
        guestGuideActions?.classList.remove('invisible', 'pointer-events-none');
    } else {
        loginBtn.parentElement.classList.remove('d-none');
        registerBtn.parentElement.classList.remove('d-none');
        logoutNavItem.classList.add('d-none');
        currentUserNavItem.classList.add('d-none');
        currentUserLabel.textContent = '';
        authStatusBadge.textContent = 'Гостевой режим';
        authStatusBadge.className = 'badge text-bg-warning text-dark';
        guestGuideCard?.classList.remove('d-none');
        guestGuideCard?.classList.remove('signed-in-guide');
        guestGuideActions?.classList.remove('d-none', 'invisible', 'pointer-events-none');
    }

    if (!canUseFavorites) {
        state.opportunityFilters.favorites = '';
        if (el('filterFavorites')) {
            el('filterFavorites').value = '';
        }
    }
    favoritesFilterField?.classList.toggle('d-none', !canUseFavorites);
    favoritesCardColumn?.classList.toggle('d-none', !canUseFavorites);
    opportunitiesBoardColumn?.classList.toggle('col-lg-8', canUseFavorites);
    opportunitiesBoardColumn?.classList.toggle('col-12', !canUseFavorites);

    if (curatorTab) {
        curatorTab.textContent = state.currentUser?.role === 'admin' ? 'Админ' : 'Куратор';
    }

    if (!visibleViews().includes(state.activeView)) {
        state.activeView = 'home';
    }
    renderWorkspaceNav();
    renderWorkspaceView();
    renderWorkspaceHero();
}

function renderWorkspaceNav() {
    const tabs = {
        home: el('tabHome'),
        profile: el('tabProfile'),
        applicant: el('tabApplicant'),
        employer: el('tabEmployer'),
        curator: el('tabCurator'),
    };
    const allowedViews = visibleViews();

    Object.entries(tabs).forEach(([view, button]) => {
        if (!button) return;
        const isActive = state.activeView === view;
        button.classList.toggle('d-none', !allowedViews.includes(view));
        button.classList.toggle('btn-primary', isActive);
        button.classList.toggle('btn-outline-primary', !isActive);
        button.setAttribute('aria-pressed', String(isActive));
        if (isActive) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });
    renderWorkspaceHero();
}

function renderWorkspaceView() {
    const homeMapColumn = el('homeMapColumn');
    const workspaceContentColumn = el('workspaceContentColumn');
    const employerHomeDeckRow = el('employerHomeDeckRow');
    const homeBlocks = [
        'homeExplorerCard',
        'homeBoardRow',
        'homeListHeader',
        'guestGuideCard',
        'homeFiltersCard',
        'homeOpportunityBlock',
        'homeFavoritesCard',
        'opportunities-list',
    ];
    const roleBlocks = {
        profile: ['profileCard'],
        applicant: ['applicantResponsesCard', 'applicantContactsCard'],
        employer: ['employerResponsesCard', 'employerOpportunitiesCard'],
        curator: ['curatorCard'],
    };

    const isHome = state.activeView === 'home';
    const isAboutPublicPage = isHome && isAboutRoute(currentPublicRoute);
    const isCuratorWorkspace = state.activeView === 'curator';
    const isEmployerWorkspace = state.activeView === 'employer';
    const showTopDeck = (isHome && !isAboutPublicPage) || (isEmployerWorkspace && state.currentUser?.role === 'employer');
    const showMapColumn = (isHome && !isAboutPublicPage) || isCuratorWorkspace || isEmployerWorkspace;
    const useSplitLayout = (isHome && !isAboutPublicPage) || isCuratorWorkspace || isEmployerWorkspace;
    const showHomeBlocks = isHome && !isAboutPublicPage;

    homeMapColumn.classList.toggle('d-none', !showMapColumn);
    workspaceContentColumn.classList.toggle('col-md-5', useSplitLayout);
    workspaceContentColumn.classList.toggle('col-12', !useSplitLayout);
    workspaceContentColumn.classList.toggle('workspace-wide', !useSplitLayout);

    homeBlocks.forEach((id) => {
        el(id).classList.toggle('d-none', !showHomeBlocks);
    });
    employerHomeDeckRow?.classList.toggle('d-none', !showTopDeck);

    Object.values(roleBlocks).flat().forEach((id) => {
        el(id).classList.add('d-none');
    });

    if (!isHome) {
        (roleBlocks[state.activeView] || []).forEach((id) => {
            el(id).classList.remove('d-none');
        });
    }

    renderWorkspaceHero();
    syncMapStageHeight();
}

async function loadProfile() {
    if (!state.currentUser) {
        state.profile = null;
        renderProfileSection();
        return;
    }
    const response = await apiFetch('/profiles/me');
    if (!response.ok) {
        state.profile = null;
        renderProfileSection();
        return;
    }
    state.profile = await response.json();
    renderProfileSection();
}

async function loadCurrentUser() {
    const token = getToken();
    if (!token) {
        state.currentUser = null;
        state.responses = [];
        state.contacts = [];
        state.contactSuggestions = [];
        state.recommendations = [];
        state.employerResponses = [];
        state.employerOpportunities = [];
        state.profile = null;
        renderAuthUI();
        renderResponses();
        renderContactsSection();
        renderEmployerResponses();
        renderEmployerOpportunities();
        renderProfileSection();
        renderCuratorSection();
        renderOpportunitiesSection();
        return;
    }

    const response = await apiFetch('/auth/me');
    if (!response.ok) {
        clearToken();
        state.currentUser = null;
        state.responses = [];
        state.contacts = [];
        state.contactSuggestions = [];
        state.recommendations = [];
        state.employerResponses = [];
        state.employerOpportunities = [];
        state.profile = null;
        renderAuthUI();
        renderResponses();
        renderContactsSection();
        renderEmployerResponses();
        renderEmployerOpportunities();
        renderProfileSection();
        renderCuratorSection();
        renderOpportunitiesSection();
        renderTagLibrary();
        return;
    }

    state.currentUser = await response.json();
    renderAuthUI();
    renderTagLibrary();
    await loadProfile();
    await loadResponses();
    await loadContacts();
    await loadRecommendations();
    await loadEmployerResponses();
    await loadEmployerOpportunities();
    await loadCuratorData();
    renderOpportunitiesSection();
}

function buildOpportunityQueryParams() {
    const params = new URLSearchParams();
    const filters = state.opportunityFilters;
    const pagination = state.opportunityPagination;

    params.set('skip', String((pagination.page - 1) * pagination.pageSize));
    params.set('limit', String(pagination.pageSize + 1));

    if (filters.type) params.set('type', filters.type);
    if (filters.workFormat) params.set('work_format', filters.workFormat);
    if (filters.location) params.set('location', filters.location);
    if (filters.search) params.set('query', filters.search);
    filters.tagIds.forEach((tagId) => {
        params.append('tag_ids', String(tagId));
    });

    return params.toString();
}

async function loadOpportunities() {
    state.opportunityPagination.isLoading = true;
    try {
        const params = buildOpportunityQueryParams();
        const response = await apiFetch(`/opportunities/?${params}`);
        if (!response.ok) {
            throw new Error('Не удалось загрузить возможности');
        }

        const loadedOpportunities = await response.json();
        state.opportunityPagination.hasNext = loadedOpportunities.length > state.opportunityPagination.pageSize;
        state.opportunities = loadedOpportunities.slice(0, state.opportunityPagination.pageSize);
        if (
            currentPublicRoute.key === 'opportunity'
            && !state.opportunities.some((item) => item.id === currentPublicRoute.opportunityId)
        ) {
            const detailResponse = await apiFetch(`/opportunities/${currentPublicRoute.opportunityId}`);
            if (detailResponse.ok) {
                state.opportunities = [await detailResponse.json(), ...state.opportunities];
            }
        }

        if (currentPublicRoute.key === 'opportunity') {
            state.selectedOpportunityId = currentPublicRoute.opportunityId;
        } else if (!state.selectedOpportunityId && state.opportunities.length) {
            state.selectedOpportunityId = state.opportunities[0].id;
        }
    } finally {
        state.opportunityPagination.isLoading = false;
        renderOpportunitiesSection();
    }
}

async function loadTags() {
    const response = await apiFetch('/tags/');
    if (!response.ok) {
        state.tags = [];
        state.opportunityFilters.tagIds = [];
        renderTagChoices('filterTagOptions', []);
        renderTagChoices('employerOpportunityTagOptions', []);
        renderTagLibrary();
        return;
    }

    state.tags = await response.json();
    const availableTagIds = new Set(state.tags.map((tag) => tag.id));
    state.opportunityFilters.tagIds = state.opportunityFilters.tagIds.filter((tagId) => availableTagIds.has(tagId));
    renderTagChoices('filterTagOptions', state.opportunityFilters.tagIds);
    renderTagChoices('employerOpportunityTagOptions', selectedTagIdsFromContainer('employerOpportunityTagOptions'));
    renderTagLibrary();
}

async function loadResponses() {
    if (!state.currentUser || state.currentUser.role !== 'applicant') {
        state.responses = [];
        renderResponses();
        return;
    }

    const response = await apiFetch('/responses/my');
    if (!response.ok) {
        state.responses = [];
        renderResponses();
        return;
    }

    state.responses = await response.json();
    renderResponses();
}

async function loadContacts() {
    if (!state.currentUser || state.currentUser.role !== 'applicant') {
        state.contacts = [];
        state.contactSuggestions = [];
        renderContactsSection();
        return;
    }

    const params = new URLSearchParams();
    if (state.contactSearch) {
        params.set('query', state.contactSearch);
    }

    const [contactsResponse, suggestionsResponse] = await Promise.all([
        apiFetch('/contacts/'),
        apiFetch(`/contacts/suggestions${params.toString() ? `?${params.toString()}` : ''}`),
    ]);

    state.contacts = contactsResponse.ok ? await contactsResponse.json() : [];
    state.contactSuggestions = suggestionsResponse.ok ? await suggestionsResponse.json() : [];
    renderContactsSection();
}

async function loadRecommendations() {
    if (!state.currentUser || state.currentUser.role !== 'applicant') {
        state.recommendations = [];
        renderContactsSection();
        return;
    }

    const response = await apiFetch('/recommendations/');
    if (!response.ok) {
        state.recommendations = [];
        renderContactsSection();
        return;
    }

    state.recommendations = await response.json();
    renderContactsSection();
}

async function loadEmployerResponses() {
    if (!state.currentUser || state.currentUser.role !== 'employer') {
        state.employerResponses = [];
        renderEmployerResponses();
        return;
    }

    const response = await apiFetch('/responses/employer');
    if (!response.ok) {
        state.employerResponses = [];
        renderEmployerResponses();
        return;
    }

    state.employerResponses = await response.json();
    renderEmployerResponses();
}

async function loadEmployerOpportunities() {
    if (!state.currentUser || state.currentUser.role !== 'employer') {
        state.employerOpportunities = [];
        renderEmployerOpportunities();
        return;
    }

    const params = new URLSearchParams();
    if (state.employerOpportunityFilters.search) {
        params.set('query', state.employerOpportunityFilters.search);
    }
    if (state.employerOpportunityFilters.type) {
        params.set('type', state.employerOpportunityFilters.type);
    }
    if (state.employerOpportunityFilters.status) {
        params.set('is_active', String(state.employerOpportunityFilters.status === 'active'));
    }

    const response = await apiFetch(`/opportunities/my${params.toString() ? `?${params.toString()}` : ''}`);
    if (!response.ok) {
        state.employerOpportunities = [];
        renderEmployerOpportunities();
        return;
    }

    state.employerOpportunities = await response.json();
    renderEmployerOpportunities();
}

async function loadCuratorData(options = {}) {
    const { notify = false } = options;

    if (!state.currentUser || !['curator', 'admin'].includes(state.currentUser.role)) {
        state.curatorUsers = [];
        state.curatorOpportunities = [];
        renderCuratorSection();
        return;
    }

    const userParams = new URLSearchParams();
    const opportunitiesParams = new URLSearchParams();

    if (state.curatorFilters.role) {
        userParams.set('role', state.curatorFilters.role);
    }
    if (state.curatorFilters.userSearch) {
        userParams.set('query', state.curatorFilters.userSearch);
    }
    if (state.curatorFilters.opportunitySearch) {
        opportunitiesParams.set('query', state.curatorFilters.opportunitySearch);
    }
    if (state.curatorFilters.opportunityStatus) {
        opportunitiesParams.set('is_active', String(state.curatorFilters.opportunityStatus === 'active'));
    }

    const userPath = `/curator/users${userParams.toString() ? `?${userParams.toString()}` : ''}`;
    const opportunitiesPath = `/curator/opportunities${opportunitiesParams.toString() ? `?${opportunitiesParams.toString()}` : ''}`;

    const refreshBtn = el('refreshCuratorBtn');
    const previousLabel = refreshBtn ? refreshBtn.textContent : '';

    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Обновляется...';
    }

    try {
        const [usersResponse, opportunitiesResponse] = await Promise.all([
            apiFetch(userPath),
            apiFetch(opportunitiesPath),
        ]);

        state.curatorUsers = usersResponse.ok ? await usersResponse.json() : [];
        state.curatorOpportunities = opportunitiesResponse.ok ? await opportunitiesResponse.json() : [];
        renderCuratorSection();

        if (notify) {
            showNotice('success', 'Данные кабинета куратора обновлены.');
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = previousLabel || 'Обновить';
        }
    }
}

async function performLogin(email, password) {
    const formData = new URLSearchParams();
    formData.set('username', email);
    formData.set('password', password);

    const response = await apiFetch('/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось войти.' }));
        return {
            ok: false,
            status: response.status,
            detail: typeof error.detail === 'string' ? error.detail : 'Не удалось войти.',
        };
    }

    const data = await response.json();
    setToken(data.access_token);
    await loadCurrentUser();
    return { ok: true };
}

async function resendVerificationEmail(email) {
    const targetEmail = (email || pendingVerificationEmail || el('loginEmail')?.value || '').trim();
    if (!targetEmail) {
        showNotice('warning', 'Укажи email, чтобы отправить письмо подтверждения повторно.');
        return;
    }

    const response = await apiFetch('/auth/resend-verification', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: targetEmail }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось отправить письмо повторно.' }));
        showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось отправить письмо повторно.');
        return;
    }

    pendingVerificationEmail = targetEmail;
    showNotice('success', `Если ${targetEmail} ожидает подтверждения, мы отправили письмо повторно.`, {
        autoClose: false,
    });
}

function showEmailVerificationNotice(kind, text, email) {
    if (email) {
        pendingVerificationEmail = email;
    }

    showNotice(kind, text, {
        actionLabel: 'Отправить письмо еще раз',
        onAction: () => {
            void resendVerificationEmail(email);
        },
        autoClose: false,
    });
}

async function handleLoginSubmit(event) {
    event.preventDefault();

    const email = el('loginEmail').value.trim();
    const password = el('loginPassword').value;
    const result = await performLogin(email, password);

    if (!result.ok) {
        if (result.status === 403) {
            showEmailVerificationNotice(
                'warning',
                `Сначала подтверди email. Мы отправили ссылку на ${email}.`,
                email
            );
            return;
        }

        showNotice('danger', result.detail || 'Не удалось войти. Проверь email и пароль.');
        return;
    }

    loginModal.hide();
    event.target.reset();
}

async function handleRegisterSubmit(event) {
    event.preventDefault();

    const password = el('registerPassword');
    const passwordConfirm = el('registerPasswordConfirm');


    // Если пользователь увидит ошибку, исправит текст, но не уберет фокус с поля — старое сообщение может «залипнуть».
    // Чтобы этого избежать, нужен сброс кастомной валидации при вводе:
    password.addEventListener('input', () => {
        password.setCustomValidity(''); // Сбрасываем ошибку при наборе текста
    });

    passwordConfirm.addEventListener('input', () => {
        passwordConfirm.setCustomValidity('');
    });


    // 1. Проверка длины пароля
    if (password.value.length < 6) {
        password.setCustomValidity('Пароль должен содержать минимум 6 символов.');
        password.reportValidity(); 
        return;
    }

    // 2. Проверка совпадения паролей
    if (password.value !== passwordConfirm.value) {
        passwordConfirm.setCustomValidity('Пароли не совпадают. Проверьте поле подтверждения.');
        passwordConfirm.reportValidity(); 
        return;
    }


    // Формируем данные для отправки
    const payload = {
        display_name: el('registerName').value.trim(),
        email: el('registerEmail').value.trim(),
        password: el('registerPassword').value,
        role: el('registerRole').value,
    };

    const response = await apiFetch('/auth/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось зарегистрироваться.' }));
        showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось зарегистрироваться.');
        return;
    }

    registerModal.hide();
    event.target.reset();
    el('loginEmail').value = payload.email;
    showEmailVerificationNotice(
        'success',
        `Аккаунт создан. Мы отправили письмо на ${payload.email}. Подтверди почту, затем войди в систему.`,
        payload.email
    );
}

function handleEmailVerificationQuery() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('verified') !== '1') return;

    const loginModalEl = el('loginModal');
    loginModalEl.addEventListener('shown.bs.modal', () => {
        showNotice('success', 'Email подтвержден. Теперь можно войти.', {
            autoClose: false,
            placement: 'modal',
        });
        el('loginEmail')?.focus();
    }, { once: true });
    loginModal.show();

    url.searchParams.delete('verified');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

async function handleProfileSubmit(event) {
    event.preventDefault();
    if (!state.currentUser) return;

    const payload = buildProfilePayload();
    const response = await apiFetch('/profiles/me', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Не удалось сохранить профиль.' }));
        showNotice('danger', typeof error.detail === 'string' ? error.detail : 'Не удалось сохранить профиль.');
        return;
    }

    state.profile = await response.json();
    if (payload.display_name) {
        state.currentUser.display_name = payload.display_name;
    }
    renderAuthUI();
    renderProfileSection();
    showNotice('success', 'Профиль сохранен.');
}

function handleLogout(event) {
    event.preventDefault();
    clearToken();
    state.currentUser = null;
    state.responses = [];
    state.contacts = [];
    state.contactSuggestions = [];
    state.recommendations = [];
    state.employerResponses = [];
    state.employerOpportunities = [];
    state.curatorUsers = [];
    state.curatorOpportunities = [];
    state.pendingCuratorUserId = null;
    state.pendingCuratorUserRole = null;
    state.pendingCuratorOpportunityId = null;
    state.pendingEmployerOpportunityId = null;
    state.profile = null;
    renderAuthUI();
    renderResponses();
    renderContactsSection();
    renderEmployerResponses();
    renderEmployerOpportunities();
    renderCuratorSection();
    renderProfileSection();
    renderOpportunitiesSection();
}

function initModals() {
    loginModal = new window.bootstrap.Modal(el('loginModal'));
    registerModal = new window.bootstrap.Modal(el('registerModal'));
    opportunityDetailsModal = new window.bootstrap.Modal(el('opportunityDetailsModal'));
    applyModal = new window.bootstrap.Modal(el('applyModal'));
    recommendModal = new window.bootstrap.Modal(el('recommendModal'));
    applicantProfileModal = new window.bootstrap.Modal(el('applicantProfileModal'));
    curatorUserModal = new window.bootstrap.Modal(el('curatorUserModal'));
    curatorCreateModal = new window.bootstrap.Modal(el('curatorCreateModal'));
    curatorOpportunityModal = new window.bootstrap.Modal(el('curatorOpportunityModal'));
    employerOpportunityModal = new window.bootstrap.Modal(el('employerOpportunityModal'));

    el('opportunityDetailsModal').addEventListener('hidden.bs.modal', () => {
        if (currentPublicRoute.key === 'opportunity') {
            syncBrowserPath('/');
            currentPublicRoute = resolvePublicRoute('/');
            updateDocumentSeo(currentPublicRoute, null);
        }
    });
}

function bindEvents() {
    const debouncedApplyOpportunityFilters = debounce(applyOpportunityFilters);
    const debouncedLoadContactsBySearch = debounce(() => {
        state.contactSearch = el('contactSearchInput').value.trim();
        void loadContacts();
    });
    const debouncedLoadCuratorUsersBySearch = debounce(() => {
        state.curatorFilters.userSearch = el('curatorSearch').value.trim();
        void loadCuratorData();
    });
    const debouncedLoadCuratorOpportunitiesBySearch = debounce(() => {
        state.curatorFilters.opportunitySearch = el('curatorOpportunitySearch').value.trim();
        void loadCuratorData();
    });

    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => {
            setActiveView(button.dataset.view);
        });
    });

    const aboutNavBtn = el('aboutNavBtn');
    if (aboutNavBtn) {
        aboutNavBtn.addEventListener('click', (event) => {
            event.preventDefault();
            navigateToPublicPath('/about');
        });
    }

    const brandHomeLink = el('brandHomeLink');
    if (brandHomeLink) {
        brandHomeLink.addEventListener('click', (event) => {
            event.preventDefault();
            navigateToPublicPath('/');
        });
    }

    const skipToMainContent = el('skipToMainContent');
    if (skipToMainContent) {
        skipToMainContent.addEventListener('click', () => {
            const mainContent = el('mainContent');
            mainContent?.focus();
            mainContent?.scrollIntoView({ block: 'start' });
        });
    }

    el('loginBtn').addEventListener('click', () => {
        loginModal.show();
    });

    el('registerBtn').addEventListener('click', () => {
        registerModal.show();
    });

    el('heroExploreBtn').addEventListener('click', () => {
        if (state.activeView !== 'home' || currentPublicRoute.key !== 'home') {
            navigateToPublicPath('/');
        }
        if (state.currentUser?.role === 'applicant') {
            void ensureMapReady({ scroll: true });
            return;
        }
        requestAnimationFrame(() => {
            el('homeExplorerCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
    el('heroRegisterBtn').addEventListener('click', (event) => {
        event.preventDefault();
        registerModal.show();
    });
    el('heroLoginBtn').addEventListener('click', (event) => {
        event.preventDefault();
        loginModal.show();
    });
    el('guestGuideExploreBtn').addEventListener('click', () => {
        void ensureMapReady({ scroll: true });
    });
    el('guestGuideRegisterBtn').addEventListener('click', (event) => {
        event.preventDefault();
        registerModal.show();
    });
    el('loadMapBtn').addEventListener('click', () => {
        void ensureMapReady();
    });

    el('logoutBtn').addEventListener('click', handleLogout);
    el('loginForm').addEventListener('submit', handleLoginSubmit);
    el('registerForm').addEventListener('submit', handleRegisterSubmit);
    el('profileForm').addEventListener('submit', handleProfileSubmit);
    el('applyForm').addEventListener('submit', handleApplySubmit);
    el('generateCoverLetterAiBtn').addEventListener('click', () => {
        void handleCoverLetterAiGenerate();
    });
    el('recommendForm').addEventListener('submit', handleRecommendationSubmit);
    el('tagForm').addEventListener('submit', handleTagSubmit);
    el('curatorTagForm').addEventListener('submit', handleCuratorTagSubmit);
    el('employerOpportunityForm').addEventListener('submit', handleEmployerOpportunitySubmit);
    el('employerOpportunityAiAssistBtn').addEventListener('click', () => {
        void handleEmployerOpportunityAiAssist();
    });
    el('curatorUserForm').addEventListener('submit', handleCuratorUserSubmit);
    el('curatorCreateForm').addEventListener('submit', handleCuratorCreateSubmit);
    el('curatorOpportunityForm').addEventListener('submit', handleCuratorOpportunitySubmit);
    el('curatorOpportunityAiReviewBtn').addEventListener('click', () => {
        void handleCuratorOpportunityAiReview();
    });
    el('openCuratorCreateBtn').addEventListener('click', () => {
        el('curatorCreateForm').reset();
        curatorCreateModal.show();
    });
    el('refreshResponsesBtn').addEventListener('click', () => {
        void loadResponses();
    });
    el('refreshContactsBtn').addEventListener('click', () => {
        void loadContacts();
    });
    el('refreshEmployerResponsesBtn').addEventListener('click', () => {
        void loadEmployerResponses();
    });
    el('refreshEmployerOpportunitiesBtn').addEventListener('click', () => {
        void loadEmployerOpportunities();
    });
    el('openEmployerOpportunityCreateBtn').addEventListener('click', () => {
        openEmployerOpportunityModal();
    });
    el('refreshCuratorBtn').addEventListener('click', () => {
        void loadCuratorData({ notify: true });
    });
    el('filterType').addEventListener('change', applyOpportunityFilters);
    el('filterWorkFormat').addEventListener('change', applyOpportunityFilters);
    el('filterLocation').addEventListener('input', debouncedApplyOpportunityFilters);
    el('filterSearch').addEventListener('input', debouncedApplyOpportunityFilters);
    el('filterFavorites').addEventListener('change', applyOpportunityFilters);
    el('filterSalary').addEventListener('change', applyOpportunityFilters);
    el('filterResetBtn').addEventListener('click', resetOpportunityFilters);
    el('employerResponseStatusFilter').addEventListener('change', applyEmployerResponseFilters);
    el('employerResponseSearch').addEventListener('input', applyEmployerResponseFilters);
    el('employerResponseClearBtn').addEventListener('click', resetEmployerResponseFilters);
    el('contactSearchInput').addEventListener('input', debouncedLoadContactsBySearch);
    el('contactSearchResetBtn').addEventListener('click', () => {
        el('contactSearchInput').value = '';
        state.contactSearch = '';
        void loadContacts();
    });
    el('employerOpportunityStatusFilter').addEventListener('change', applyEmployerOpportunityFilters);
    el('employerOpportunityTypeFilter').addEventListener('change', applyEmployerOpportunityFilters);
    el('employerOpportunitySearch').addEventListener('input', applyEmployerOpportunityFilters);
    el('employerOpportunityClearBtn').addEventListener('click', resetEmployerOpportunityFilters);
    el('employerOpportunityType').addEventListener('change', syncEmployerOpportunityFieldHints);
    el('employerOpportunityWorkFormat').addEventListener('change', syncEmployerOpportunityFieldHints);
    el('curatorUserRoleFilter').addEventListener('change', () => {
        state.curatorFilters.role = el('curatorUserRoleFilter').value;
        void loadCuratorData();
    });
    el('curatorSearch').addEventListener('input', debouncedLoadCuratorUsersBySearch);
    el('curatorVerificationFilter').addEventListener('change', () => {
        state.curatorFilters.verification = el('curatorVerificationFilter').value;
        renderCuratorSection();
    });
    el('curatorOpportunityStatusFilter').addEventListener('change', () => {
        state.curatorFilters.opportunityStatus = el('curatorOpportunityStatusFilter').value;
        void loadCuratorData();
    });
    el('curatorOpportunitySearch').addEventListener('input', debouncedLoadCuratorOpportunitiesBySearch);

    setupClipboardCopy('copyCoverLetterBtn', 'coverLetter');
    setupClipboardCopy('copyEmployerDescriptionBtn', 'employerOpportunityDescription');

    window.addEventListener('popstate', () => {
        navigateToPublicPath(window.location.pathname, { replace: true });
    });
}

function setupClipboardCopy(buttonId, textareaId) {
    const button = el(buttonId);
    const textarea = el(textareaId);
    if (!button || !textarea) return;
    button.addEventListener('click', () => {
        const text = textarea.value;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = '✓ Скопировано!';
            button.classList.add('text-success');
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('text-success');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            showNotice('danger', 'Не удалось скопировать текст в буфер обмена.');
        });
    });
}

async function bootstrap() {
    initModals();
    setupFieldLimits();
    bindEvents();
    loadFavoritesState();
    syncPublicRouteFilters();
    renderAuthUI();
    renderResponses();
    renderContactsSection();
    renderEmployerResponses();
    renderEmployerOpportunities();
    renderCuratorSection();
    renderProfileSection();
    renderFavoritesSummary();
    renderMapShellState();
    handleEmailVerificationQuery();
    setupMapAutoload();
    setupMapHeightSync();
    setupMapResizeSync();
    renderTagLibrary();
    syncEmployerOpportunityFieldHints();
    refreshFieldCounters();

    try {
        await loadTags();
        await loadOpportunities();
        await loadCurrentUser();

        if (currentPublicRoute.key === 'opportunity') {
            openOpportunityDetailsModal(currentPublicRoute.opportunityId);
        }
    } catch (error) {
        console.error(error);
        renderAlert(el('opportunities-list'), 'danger', 'Не удалось загрузить проект. Проверь API.');
    }
}

void bootstrap();
