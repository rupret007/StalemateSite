(() => {
    'use strict';
    const script = document.currentScript;
    const id = script.dataset.session;
    const profile = script.dataset.profile;
    if (!/^[a-f0-9]{48}$/.test(id) || location.hostname !== '127.0.0.1') throw new Error('Local preview identity is unavailable.');
    // Tabs share an origin but represent separate people. Isolate product browser
    // storage by launcher identity; never copy messages or PM text into storage.
    for (const name of ['localStorage', 'sessionStorage']) {
        const backing = window[name];
        const prefix = `stalemate-preview:${id}:`;
        const keys = () => Array.from({ length: backing.length }, (_, index) => backing.key(index)).filter((key) => key.startsWith(prefix));
        const scoped = {
            getItem: (key) => backing.getItem(prefix + key),
            setItem: (key, value) => backing.setItem(prefix + key, value),
            removeItem: (key) => backing.removeItem(prefix + key),
            clear: () => keys().forEach((key) => backing.removeItem(key)),
            key: (index) => keys()[index]?.slice(prefix.length) ?? null,
            get length() { return keys().length; }
        };
        Object.defineProperty(window, name, { value: scoped, configurable: true });
    }
    const params = new URLSearchParams(location.search);
    params.set('preview', 'local-preview-key-0001');
    params.set('relay', `${location.origin.replace(/^http/, 'ws')}/__preview/relay/${id}`);
    if (profile !== 'guest') params.set('owner', '1'); else params.delete('owner');
    history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
    document.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('aside');
        banner.className = 'preview-banner'; banner.setAttribute('aria-label', 'Local preview identity');
        const strong = document.createElement('strong'); strong.textContent = `LOCAL PREVIEW · ${script.dataset.label}`;
        const copy = document.createElement('span'); copy.textContent = ' Email/staff identity is simulated. AI off.';
        const back = document.createElement('a'); back.href = '/__preview/'; back.target = '_blank'; back.rel = 'noopener'; back.textContent = 'Open another identity';
        banner.append(strong, copy, back); document.body.prepend(banner);
        const nick = document.querySelector('[data-nick]');
        if (nick && !window.localStorage.getItem('hangout-nick')) nick.value = `${script.dataset.previewNick}${id.slice(0, 5)}`.slice(0, 20);
        for (const link of document.querySelectorAll('[data-signin], [data-owner-signin]')) {
            link.href = '/__preview/'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Choose a local test identity';
        }
    });
})();
