export function hasCoords(opportunity) {
    return Number.isFinite(opportunity.lat) && Number.isFinite(opportunity.lng);
}

const YANDEX_MAPS_LABEL = 'Яндекс Карты';
const YANDEX_MAPS_API_LABEL = 'API Яндекс Карт';
const YANDEX_MAPS_TERMS_LABEL = 'Условия использования Яндекс Карт';
const YANDEX_MAPS_URL = 'https://yandex.ru/maps/';

export function createMapController({
    apiKey,
    state,
    isFavoriteOpportunity,
    isFavoriteCompany,
    createEl,
    opportunityTypeLabel,
    workFormatLabel,
    onSelectOpportunity,
}) {
    let map;
    let ymapsReadyPromise;
    let mapLinkObserver;
    let placemarks = [];
    let resizeFrameId = null;
    let mapLinkLabelFrameId = null;

    function hasUnsafeHref(link) {
        const href = link.getAttribute('href')?.trim();
        return !href || href === '#' || href.startsWith('javascript:');
    }

    function trimLinkHref(link) {
        const href = link.getAttribute('href');
        if (href && href.trim() !== href) {
            link.setAttribute('href', href.trim());
        }
    }

    function setYandexMapLinkHref(link) {
        if (link.getAttribute('href') !== YANDEX_MAPS_URL) {
            link.setAttribute('href', YANDEX_MAPS_URL);
        }
        if (link.getAttribute('target') !== '_blank') {
            link.setAttribute('target', '_blank');
        }
        if (link.getAttribute('rel') !== 'nofollow noopener noreferrer') {
            link.setAttribute('rel', 'nofollow noopener noreferrer');
        }
        link.setAttribute('role', 'link');
    }

    function labelYandexMapLinks() {
        const mapContainer = document.getElementById('map');
        if (!mapContainer) return;

        mapContainer.querySelectorAll('a[class*="copyright__logo"]').forEach((link) => {
            setYandexMapLinkHref(link);
        });

        mapContainer.querySelectorAll('a').forEach((link) => {
            trimLinkHref(link);
            const text = link.textContent.trim();
            const hasAccessibleName = text || link.getAttribute('aria-label') || link.getAttribute('title');

            if (String(link.className).includes('copyright__link') && text === 'Условия использования') {
                link.textContent = YANDEX_MAPS_TERMS_LABEL;
                link.setAttribute('aria-label', YANDEX_MAPS_TERMS_LABEL);
                link.setAttribute('title', YANDEX_MAPS_TERMS_LABEL);
            }

            if (String(link.className).includes('gototech') && text === 'API') {
                link.textContent = YANDEX_MAPS_API_LABEL;
                link.setAttribute('aria-label', YANDEX_MAPS_API_LABEL);
                link.setAttribute('title', YANDEX_MAPS_API_LABEL);
            }

            if (String(link.className).includes('ymaps')) {
                if (link.getAttribute('target') !== '_blank') {
                    link.setAttribute('target', '_blank');
                }
                if (link.getAttribute('rel') !== 'nofollow noopener noreferrer') {
                    link.setAttribute('rel', 'nofollow noopener noreferrer');
                }
                link.setAttribute('role', 'link');
            }

            if (!hasAccessibleName) {
                link.setAttribute('aria-label', YANDEX_MAPS_LABEL);
                link.setAttribute('title', YANDEX_MAPS_LABEL);
                if (!link.querySelector('.visually-hidden')) {
                    link.appendChild(createEl('span', 'visually-hidden', YANDEX_MAPS_LABEL));
                }
            }

            if (hasUnsafeHref(link)) {
                setYandexMapLinkHref(link);
            }
        });
    }

    function requestYandexMapLabeling() {
        if (mapLinkLabelFrameId !== null) return;

        mapLinkLabelFrameId = window.requestAnimationFrame(() => {
            mapLinkLabelFrameId = null;
            labelYandexMapLinks();
        });
    }

    function observeYandexMapLinks() {
        const mapContainer = document.getElementById('map');
        if (!mapContainer || mapLinkObserver) return;

        mapLinkObserver = new MutationObserver(requestYandexMapLabeling);
        mapLinkObserver.observe(mapContainer, {
            attributes: true,
            attributeFilter: ['aria-label', 'href', 'rel', 'target', 'title'],
            childList: true,
            characterData: true,
            subtree: true,
        });
    }

    function scheduleYandexMapLabeling() {
        [0, 250, 1000].forEach((delay) => {
            window.setTimeout(requestYandexMapLabeling, delay);
        });
    }

    function buildOpportunityPopup(opportunity) {
        const popup = createEl('div', 'opportunity-popup');
        popup.appendChild(createEl('h6', '', opportunity.title));
        popup.appendChild(createEl('div', 'company', opportunity.employer_name || 'Работодатель'));
        popup.appendChild(createEl('div', 'small text-muted', opportunityTypeLabel(opportunity.type)));

        if (opportunity.salary_range) {
            popup.appendChild(createEl('div', 'salary', `💰 ${opportunity.salary_range}`));
        }

        const tags = Array.isArray(opportunity.tags) ? opportunity.tags.map((tag) => `#${tag.name}`).join(' ') : '';
        if (tags) {
            popup.appendChild(createEl('div', 'tags', tags));
        }
        popup.appendChild(createEl('small', '', `${opportunity.location} | ${workFormatLabel(opportunity.work_format)}`));
        return popup;
    }

    function loadYandexMaps() {
        if (!apiKey) {
            return Promise.reject(new Error('Не указан API-ключ Яндекс Карт'));
        }
        if (window.ymaps) {
            return Promise.resolve(window.ymaps);
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
            script.async = true;
            script.onerror = () => reject(new Error('Не удалось загрузить Яндекс Карты'));
            script.onload = () => {
                window.ymaps.ready(() => resolve(window.ymaps));
            };
            document.head.appendChild(script);
        });
    }

    async function initMap() {
        if (!ymapsReadyPromise) {
            ymapsReadyPromise = loadYandexMaps();
        }
        const ymaps = await ymapsReadyPromise;
        map = new ymaps.Map('map', {
            center: [55.7558, 37.6176],
            zoom: 10,
            controls: ['zoomControl'],
        });
        map.behaviors.disable('scrollZoom');
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            map.behaviors.disable('drag');
        }
        observeYandexMapLinks();
        labelYandexMapLinks();
        scheduleYandexMapLabeling();
    }

    function renderMap(opportunities) {
        if (!map || !window.ymaps) return;
        const ymaps = window.ymaps;

        placemarks.forEach((placemark) => map.geoObjects.remove(placemark));
        placemarks = [];

        opportunities.forEach((opportunity) => {
            if (!hasCoords(opportunity)) return;

            const popup = buildOpportunityPopup(opportunity);
            const placemark = new ymaps.Placemark(
                [opportunity.lat, opportunity.lng],
                {
                    balloonContentHeader: opportunity.title,
                    balloonContentBody: popup.outerHTML,
                },
                {
                    preset: state.selectedOpportunityId === opportunity.id
                        ? 'islands#darkBlueCircleDotIcon'
                        : isFavoriteOpportunity(opportunity.id)
                            ? 'islands#redCircleDotIcon'
                            : isFavoriteCompany(opportunity.employer_id)
                                ? 'islands#orangeCircleDotIcon'
                                : 'islands#blueCircleDotIcon',
                }
            );

            placemark.events.add('click', () => {
                onSelectOpportunity(opportunity.id);
            });

            placemark.events.add('mouseenter', (e) => {
                e.get('target').balloon.open();
            });

            placemark.events.add('mouseleave', (e) => {
                e.get('target').balloon.close();
            });

            map.geoObjects.add(placemark);
            placemarks.push(placemark);
        });
        scheduleYandexMapLabeling();
    }

    function centerOnOpportunity(opportunity) {
        if (map && hasCoords(opportunity)) {
            map.setCenter([opportunity.lat, opportunity.lng], 14, { duration: 250 });
        }
    }

    function resizeMap() {
        if (!map?.container?.fitToViewport) return;

        if (resizeFrameId !== null) {
            window.cancelAnimationFrame(resizeFrameId);
        }

        resizeFrameId = window.requestAnimationFrame(() => {
            resizeFrameId = window.requestAnimationFrame(() => {
                map.container.fitToViewport();
                resizeFrameId = null;
            });
        });
    }

    return {
        initMap,
        renderMap,
        centerOnOpportunity,
        resizeMap,
    };
}
