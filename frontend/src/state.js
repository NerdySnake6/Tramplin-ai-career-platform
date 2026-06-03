const TOKEN_KEY = 'tramplin_access_token';
const FAVORITE_OPPORTUNITIES_KEY = 'tramplin_favorite_opportunities';
const FAVORITE_COMPANIES_KEY = 'tramplin_favorite_companies';
const FAVORITE_COMPANY_NAMES_KEY = 'tramplin_favorite_company_names';

export const state = {
    opportunities: [],
    employerOpportunities: [],
    currentUser: null,
    activeView: 'home',
    selectedOpportunityId: null,
    pendingApplyId: null,
    pendingRecommendationPeerId: null,
    pendingCuratorUserId: null,
    pendingCuratorUserRole: null,
    pendingCuratorOpportunityId: null,
    pendingEmployerOpportunityId: null,
    responses: [],
    contacts: [],
    contactSuggestions: [],
    recommendations: [],
    tags: [],
    employerResponses: [],
    curatorUsers: [],
    curatorOpportunities: [],
    profile: null,
    favoriteOpportunityIds: [],
    favoriteCompanyIds: [],
    favoriteCompanyNames: {},
    opportunityFilters: {
        type: '',
        workFormat: '',
        location: '',
        search: '',
        favorites: '',
        salary: '',
        tagIds: [],
    },
    opportunityPagination: {
        page: 1,
        pageSize: 24,
        hasNext: false,
        isLoading: false,
    },
    employerResponseFilters: {
        status: '',
        search: '',
    },
    contactSearch: '',
    employerOpportunityFilters: {
        status: '',
        type: '',
        search: '',
    },
    curatorFilters: {
        role: '',
        userSearch: '',
        verification: '',
        opportunitySearch: '',
        opportunityStatus: '',
    },
};

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function loadFavoriteIds(key) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((value) => Number.isInteger(value)) : [];
    } catch {
        return [];
    }
}

function saveFavoriteIds(key, ids) {
    localStorage.setItem(key, JSON.stringify(ids));
}

function loadFavoriteCompanyNames() {
    try {
        const raw = localStorage.getItem(FAVORITE_COMPANY_NAMES_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([key, value]) => Number.isInteger(Number(key)) && typeof value === 'string' && value.trim())
                .map(([key, value]) => [key, value.trim()])
        );
    } catch {
        return {};
    }
}

function saveFavoriteCompanyNames() {
    localStorage.setItem(FAVORITE_COMPANY_NAMES_KEY, JSON.stringify(state.favoriteCompanyNames));
}

export function loadFavoritesState() {
    state.favoriteOpportunityIds = loadFavoriteIds(FAVORITE_OPPORTUNITIES_KEY);
    state.favoriteCompanyIds = loadFavoriteIds(FAVORITE_COMPANIES_KEY);
    state.favoriteCompanyNames = loadFavoriteCompanyNames();
}

export function isFavoriteOpportunity(opportunityId) {
    return state.favoriteOpportunityIds.includes(opportunityId);
}

export function isFavoriteCompany(employerId) {
    return state.favoriteCompanyIds.includes(employerId);
}

export function toggleFavoriteOpportunity(opportunityId) {
    if (isFavoriteOpportunity(opportunityId)) {
        state.favoriteOpportunityIds = state.favoriteOpportunityIds.filter((id) => id !== opportunityId);
    } else {
        state.favoriteOpportunityIds = [...state.favoriteOpportunityIds, opportunityId];
    }
    saveFavoriteIds(FAVORITE_OPPORTUNITIES_KEY, state.favoriteOpportunityIds);
}

export function toggleFavoriteCompany(employerId, employerName = null) {
    if (isFavoriteCompany(employerId)) {
        state.favoriteCompanyIds = state.favoriteCompanyIds.filter((id) => id !== employerId);
        delete state.favoriteCompanyNames[String(employerId)];
    } else {
        state.favoriteCompanyIds = [...state.favoriteCompanyIds, employerId];
        if (employerName) {
            state.favoriteCompanyNames[String(employerId)] = employerName;
        }
    }
    saveFavoriteIds(FAVORITE_COMPANIES_KEY, state.favoriteCompanyIds);
    saveFavoriteCompanyNames();
}
