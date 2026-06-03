import {
    createEl,
    el,
    formatDate,
    opportunityTypeLabel,
    workFormatLabel,
} from './utils.js';

export const SITE_URL = 'https://tramplin.site';

const BASE_DESCRIPTION = 'Карьерная платформа для студентов, выпускников и начинающих специалистов.';

const PUBLIC_ROUTES = {
    '/': {
        key: 'home',
        canonicalPath: '/',
        filterType: '',
        title: 'Трамплин (Tramplin) | Карьерная платформа для студентов, работа и стажировки',
        description: 'Трамплин (Tramplin site) помогает студентам и молодым специалистам находить стажировки, работу, вакансии, карьерные события и менторские возможности.',
        eyebrow: 'Публичная витрина',
        heroTitle: 'Трамплин для старта в IT',
        heroDescription: 'Найди первую стажировку, вакансию или карьерное событие и сохрани интересные варианты еще до регистрации.',
        contentTitle: 'Карьерная платформа для студентов и молодых специалистов',
        paragraphs: [
            'Трамплин собирает стажировки для студентов, вакансии для начинающих специалистов, карьерные события и менторские возможности в одной публичной витрине.',
            'Здесь удобно сравнивать предложения по формату, локации, технологиям и уровню подготовки: от первой практики до junior-позиции.',
        ],
    },
    '/opportunities': {
        key: 'opportunities',
        canonicalPath: '/opportunities',
        filterType: '',
        title: 'Стажировки, вакансии и события — Трамплин (Tramplin)',
        description: 'Актуальные возможности для студентов и выпускников: стажировки, junior-вакансии, карьерные события, менторство и удаленные форматы.',
        eyebrow: 'Каталог возможностей',
        heroTitle: 'Стажировки, вакансии и события',
        heroDescription: 'Смотри все опубликованные возможности для студентов, выпускников и начинающих специалистов.',
        contentTitle: 'Все карьерные возможности',
        paragraphs: [
            'В каталоге собраны предложения для поиска стажировки, первой работы, практики, менторства и профессиональных мероприятий.',
            'Фильтры помогают быстрее найти подходящий формат: офис, гибрид, удаленная работа, события в городе или онлайн.',
        ],
    },
    '/internships': {
        key: 'internships',
        canonicalPath: '/internships',
        filterType: 'internship',
        title: 'Стажировки для студентов и начинающих специалистов — Трамплин (Tramplin)',
        description: 'Подборка стажировок для студентов, выпускников и junior-специалистов с фильтрами по формату, городу и технологиям.',
        eyebrow: 'Стажировки',
        heroTitle: 'Стажировки для студентов',
        heroDescription: 'Ищи стажировки для студентов, выпускников и начинающих специалистов по формату, локации и тегам.',
        contentTitle: 'Стажировки для студентов и выпускников',
        paragraphs: [
            'Страница помогает найти стажировки для студентов, практику в компаниях и первые задачи для развития профессионального опыта.',
            'Подборка подходит тем, кто ищет старт в профессии, проектную занятость, удаленный формат или стажировку junior-уровня.',
        ],
    },
    '/jobs': {
        key: 'jobs',
        canonicalPath: '/jobs',
        filterType: 'job',
        title: 'Работа и вакансии для начинающих специалистов — Трамплин (Tramplin)',
        description: 'Вакансии для начинающих специалистов, студентов и выпускников: junior-позиции, удаленная работа, офисные и гибридные форматы.',
        eyebrow: 'Вакансии',
        heroTitle: 'Вакансии для начинающих специалистов',
        heroDescription: 'Сравнивай junior-вакансии, первые рабочие предложения и позиции для выпускников.',
        contentTitle: 'Вакансии для студентов, выпускников и junior',
        paragraphs: [
            'На этой странице собраны вакансии для начинающих специалистов, студентов старших курсов и выпускников, которые ищут первую работу.',
            'Карточки помогают быстро оценить описание, компанию, формат занятости, город и требования по навыкам.',
        ],
    },
    '/events': {
        key: 'events',
        canonicalPath: '/events',
        filterType: 'event',
        title: 'Карьерные мероприятия для студентов и выпускников — Трамплин (Tramplin)',
        description: 'Карьерные события, встречи, ярмарки вакансий и мероприятия для студентов, выпускников и начинающих специалистов.',
        eyebrow: 'Мероприятия',
        heroTitle: 'Карьерные события и мероприятия',
        heroDescription: 'Находи события для студентов и выпускников: встречи с работодателями, карьерные дни и профессиональные мероприятия.',
        contentTitle: 'Мероприятия для студентов и выпускников',
        paragraphs: [
            'Карьерные мероприятия помогают познакомиться с работодателями, узнать о стажировках и понять, какие навыки сейчас востребованы.',
            'В каталоге можно искать офлайн-события по городу, онлайн-встречи и гибридные форматы для развития карьеры.',
        ],
    },
    '/about': {
        key: 'about',
        canonicalPath: '/about',
        filterType: '',
        title: 'О проекте Трамплин (Tramplin site) | Карьерная платформа',
        description: 'Трамплин (Tramplin site) помогает студентам, выпускникам, работодателям и карьерным центрам находить друг друга через стажировки, работу и события.',
        eyebrow: 'О проекте',
        heroTitle: 'О платформе Трамплин',
        heroDescription: 'Трамплин — это интерактивная карьерная платформа, объединяющая студентов, выпускников и работодателей.',
        contentTitle: 'Трамплин: карьерная платформа для поиска работы',
        paragraphs: [
            'Трамплин (Tramplin site) создан для удобного поиска стажировок, junior-вакансий, карьерных событий и менторских программ.',
            'Наш сервис предоставляет бесплатный поиск работы для студентов и начинающих специалистов. Работодатели могут публиковать предложения и управлять откликами.',
            'Вы можете искать возможности на интерактивной карте, добавлять их в избранное, а также развивать свой нетворк и находить профессиональные контакты для успешного старта.'
        ],
    },
};

const ROUTE_LINKS = [
    ['Все возможности', '/opportunities'],
    ['Стажировки', '/internships'],
    ['Вакансии', '/jobs'],
    ['Мероприятия', '/events'],
    ['О проекте', '/about'],
];

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 155) {
    const text = cleanText(value);
    if (text.length <= maxLength) return text;

    const cut = text.slice(0, maxLength - 3);
    const lastSpace = cut.lastIndexOf(' ');
    return `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length)}...`;
}

function fullUrl(path) {
    return `${SITE_URL}${path === '/' ? '/' : path}`;
}

function compactObject(value) {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
    );
}

function updateMeta(selector, attrName, attrValue, content) {
    let meta = document.head.querySelector(selector);
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attrName, attrValue);
        document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
}

function updateCanonical(url) {
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
    }
    link.setAttribute('href', url);
}

function baseSchemaGraph() {
    return [
        {
            '@type': 'Organization',
            '@id': `${SITE_URL}/#organization`,
            name: 'Трамплин',
            url: `${SITE_URL}/`,
            description: BASE_DESCRIPTION,
        },
        {
            '@type': 'WebSite',
            '@id': `${SITE_URL}/#website`,
            url: `${SITE_URL}/`,
            name: 'Трамплин',
            inLanguage: 'ru-RU',
            publisher: {
                '@id': `${SITE_URL}/#organization`,
            },
        },
    ];
}

function isoDateTime(value) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
}

function jobPostingSchema(opportunity, url) {
    const remote = opportunity.work_format === 'remote';
    return compactObject({
        '@type': 'JobPosting',
        '@id': `${url}#job`,
        title: opportunity.title,
        description: cleanText(opportunity.description),
        datePosted: isoDateTime(opportunity.published_at),
        validThrough: isoDateTime(opportunity.expires_at),
        employmentType: opportunity.type === 'internship' ? 'INTERN' : 'FULL_TIME',
        hiringOrganization: {
            '@type': 'Organization',
            name: opportunity.employer_name || 'Работодатель',
        },
        jobLocationType: remote ? 'TELECOMMUTE' : undefined,
        applicantLocationRequirements: remote
            ? {
                '@type': 'Country',
                name: 'Россия',
            }
            : undefined,
        jobLocation: remote
            ? undefined
            : {
                '@type': 'Place',
                address: {
                    '@type': 'PostalAddress',
                    streetAddress: opportunity.location,
                    addressCountry: 'RU',
                },
            },
    });
}

function eventSchema(opportunity, url) {
    const remote = opportunity.work_format === 'remote';
    const hybrid = opportunity.work_format === 'hybrid';
    let attendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
    if (remote) {
        attendanceMode = 'https://schema.org/OnlineEventAttendanceMode';
    }
    if (hybrid) {
        attendanceMode = 'https://schema.org/MixedEventAttendanceMode';
    }

    return compactObject({
        '@type': 'Event',
        '@id': `${url}#event`,
        name: opportunity.title,
        description: cleanText(opportunity.description),
        startDate: isoDateTime(opportunity.event_date || opportunity.published_at),
        endDate: isoDateTime(opportunity.expires_at),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: attendanceMode,
        location: remote
            ? {
                '@type': 'VirtualLocation',
                url,
            }
            : {
                '@type': 'Place',
                name: opportunity.location,
                address: opportunity.location,
            },
        organizer: {
            '@type': 'Organization',
            name: opportunity.employer_name || 'Организатор',
        },
    });
}

function pageSchema(route, seo) {
    return {
        '@type': route.key === 'about' ? 'AboutPage' : 'CollectionPage',
        '@id': `${seo.url}#page`,
        url: seo.url,
        name: seo.title,
        description: seo.description,
        inLanguage: 'ru-RU',
        isPartOf: {
            '@id': `${SITE_URL}/#website`,
        },
    };
}

function opportunitySeo(route, opportunity) {
    if (!opportunity) {
        return {
            title: 'Карточка возможности — Трамплин',
            description: 'Карточка возможности на карьерной платформе Трамплин.',
            url: fullUrl(route.canonicalPath),
        };
    }

    const typeLabel = opportunityTypeLabel(opportunity.type).toLowerCase();
    return {
        title: `${opportunity.title} — ${opportunity.employer_name || 'работодатель'} | Трамплин (Tramplin)`,
        description: truncateText(`${opportunityTypeLabel(opportunity.type)}: ${opportunity.description}`),
        url: fullUrl(route.canonicalPath),
        typeLabel,
    };
}

export function normalizePathname(pathname) {
    const path = pathname || '/';
    if (path === '/') return path;
    return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function resolvePublicRoute(pathname) {
    const path = normalizePathname(pathname);
    const opportunityMatch = path.match(/^\/opportunities\/(\d+)$/);
    if (opportunityMatch) {
        return {
            key: 'opportunity',
            canonicalPath: path,
            filterType: '',
            opportunityId: Number(opportunityMatch[1]),
        };
    }

    return PUBLIC_ROUTES[path] || PUBLIC_ROUTES['/'];
}

export function isAboutRoute(route) {
    return route?.key === 'about';
}

export function routeViewMeta(route, opportunity, counts) {
    if (route?.key === 'opportunity') {
        return {
            eyebrow: 'Карточка возможности',
            title: opportunity?.title || 'Карточка возможности',
            description: opportunity
                ? `${opportunity.employer_name || 'Работодатель'}: ${truncateText(opportunity.description, 180)}`
                : 'Возможность загружается или уже недоступна.',
            pills: opportunity
                ? [
                    opportunityTypeLabel(opportunity.type),
                    workFormatLabel(opportunity.work_format),
                    opportunity.location,
                ]
                : [],
        };
    }

    if (route?.key && route.key !== 'home') {
        return {
            eyebrow: route.eyebrow,
            title: route.heroTitle,
            description: route.heroDescription,
            pills: [
                `${counts.filteredCount} возможностей`,
                route.key === 'about' ? 'Для студентов и работодателей' : `${counts.tagCount} активных тегов`,
                route.key === 'about' ? 'Русскоязычный карьерный поиск' : `${counts.favoriteCount} в избранном`,
            ],
        };
    }

    return null;
}

export function updateDocumentSeo(route, opportunity) {
    const seo = route?.key === 'opportunity'
        ? opportunitySeo(route, opportunity)
        : {
            title: route.title,
            description: route.description,
            url: fullUrl(route.canonicalPath),
        };

    document.title = seo.title;
    updateMeta('meta[name="description"]', 'name', 'description', seo.description);
    updateMeta('meta[property="og:title"]', 'property', 'og:title', seo.title);
    updateMeta('meta[property="og:description"]', 'property', 'og:description', seo.description);
    updateMeta('meta[property="og:url"]', 'property', 'og:url', seo.url);
    updateMeta('meta[name="twitter:title"]', 'name', 'twitter:title', seo.title);
    updateMeta('meta[name="twitter:description"]', 'name', 'twitter:description', seo.description);
    updateCanonical(seo.url);

    const graph = baseSchemaGraph();
    if (route?.key === 'opportunity' && opportunity) {
        graph.push(opportunity.type === 'event'
            ? eventSchema(opportunity, seo.url)
            : jobPostingSchema(opportunity, seo.url));
    } else if (route) {
        graph.push(pageSchema(route, seo));
    }

    const script = el('structuredData');
    if (script) {
        script.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': graph,
        });
    }
}

function appendParagraphs(container, paragraphs) {
    paragraphs.forEach((paragraph) => {
        container.appendChild(createEl('p', 'mb-2', paragraph));
    });
}

function createRouteLink(label, path, onNavigate) {
    const link = createEl('a', 'public-route-link', label);
    link.href = path;
    link.addEventListener('click', (event) => {
        event.preventDefault();
        onNavigate(path);
    });
    return link;
}

function appendRouteLinks(container, onNavigate) {
    const links = createEl('div', 'public-route-links');
    ROUTE_LINKS.forEach(([label, path]) => {
        links.appendChild(createRouteLink(label, path, onNavigate));
    });
    container.appendChild(links);
}

function renderAboutSection(panel, onNavigate) {
    const grid = createEl('div', 'public-seo-grid mt-3');
    [
        ['Студентам', 'Поиск стажировки, junior-вакансии, карьерного события или ментора становится прозрачнее: все карточки можно сравнивать по формату и локации.'],
        ['Работодателям', 'Компании получают витрину для публикации возможностей и могут показывать предложения начинающим специалистам без лишнего шума.'],
        ['Карьерным центрам', 'Платформа помогает видеть активность работодателей, поддерживать студентов и развивать профессиональные контакты.'],
    ].forEach(([title, text]) => {
        const item = createEl('section', 'public-seo-grid-item');
        item.appendChild(createEl('h3', '', title));
        item.appendChild(createEl('p', 'mb-0', text));
        grid.appendChild(item);
    });
    panel.appendChild(grid);
    appendRouteLinks(panel, onNavigate);
}

function renderOpportunitySection(panel, route, opportunity, onNavigate) {
    if (!opportunity) {
        panel.appendChild(createEl('p', 'mb-3', 'Эта возможность не найдена в публичном каталоге или больше не опубликована.'));
        panel.appendChild(createRouteLink('Вернуться к каталогу', '/opportunities', onNavigate));
        return;
    }

    panel.appendChild(createEl('p', 'public-seo-lead', opportunity.description));

    const facts = createEl('dl', 'public-opportunity-facts');
    [
        ['Компания', opportunity.employer_name || 'Работодатель'],
        ['Тип', opportunityTypeLabel(opportunity.type)],
        ['Формат', workFormatLabel(opportunity.work_format)],
        ['Локация', opportunity.location],
        ['Публикация', formatDate(opportunity.published_at)],
        ['Срок', formatDate(opportunity.expires_at)],
    ].forEach(([name, value]) => {
        facts.appendChild(createEl('dt', '', name));
        facts.appendChild(createEl('dd', '', value));
    });
    panel.appendChild(facts);

    if (Array.isArray(opportunity.tags) && opportunity.tags.length) {
        const tags = createEl('div', 'public-seo-tags');
        opportunity.tags.forEach((tag) => {
            tags.appendChild(createEl('span', 'card-tag-badge', `#${tag.name}`));
        });
        panel.appendChild(tags);
    }

    const links = createEl('div', 'public-route-links');
    links.appendChild(createRouteLink('Все возможности', '/opportunities', onNavigate));
    if (['job', 'event', 'internship'].includes(opportunity.type)) {
        let typePath = '/internships';
        if (opportunity.type === 'job') {
            typePath = '/jobs';
        }
        if (opportunity.type === 'event') {
            typePath = '/events';
        }
        links.appendChild(createRouteLink(opportunityTypeLabel(opportunity.type), typePath, onNavigate));
    }
    panel.appendChild(links);
    panel.dataset.opportunityId = String(route.opportunityId);
}

export function renderPublicSeoSection(route, state, onNavigate) {
    const container = el('publicSeoSection');
    if (!container) return;

    const shouldShow = state.activeView === 'home';
    container.classList.toggle('d-none', !shouldShow);
    if (!shouldShow) return;

    if (route.key === 'home' && container.dataset.routeKey === 'home' && container.children.length) {
        return;
    }

    container.innerHTML = '';
    container.dataset.routeKey = route.key;

    const opportunity = route?.key === 'opportunity'
        ? state.opportunities.find((item) => item.id === route.opportunityId)
        : null;
    const panel = createEl('article', `public-seo-panel public-seo-${route.key}`);
    panel.dataset.routeKey = route.key;
    const title = route.key === 'opportunity'
        ? opportunity?.title || 'Карточка возможности'
        : route.contentTitle;

    panel.appendChild(createEl('h2', '', title));

    if (route.key === 'opportunity') {
        renderOpportunitySection(panel, route, opportunity, onNavigate);
    } else {
        appendParagraphs(panel, route.paragraphs);
        if (route.key === 'about') {
            renderAboutSection(panel, onNavigate);
        } else {
            appendRouteLinks(panel, onNavigate);
        }
    }

    container.appendChild(panel);
}
