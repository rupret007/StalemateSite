export const DISMISS_KEY = 'hangout-add-home-dismissed';
export const INSTALLED_KEY = 'hangout-add-home-installed';
export const SHARE_HINT = 'Tap Share, then Add to Home Screen.';

const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'];

export function isIos(userAgent, maxTouchPoints = 0) {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS reports a Macintosh UA. A touchscreen Mac running Chrome still gets the install button.
    return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1 && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

export function isAndroidInstallBrowser(userAgent) {
    const ua = String(userAgent || '');
    if (!/Android/i.test(ua) || isIos(ua)) return false;
    return /Chrome\/|Chromium\/|EdgA\/|SamsungBrowser\//.test(ua);
}

export function standaloneFrom({ matchMedia, navigatorStandalone } = {}) {
    if (navigatorStandalone === true) return true;
    if (typeof matchMedia !== 'function') return false;
    for (const mode of DISPLAY_MODES) {
        try {
            if (matchMedia(`(display-mode: ${mode})`)?.matches) return true;
        } catch {
            return false;
        }
    }
    return false;
}

export function readFlag(storage, key) {
    try {
        return storage.getItem(key) === '1';
    } catch {
        return false;
    }
}

export function writeFlag(storage, key) {
    try {
        storage.setItem(key, '1');
        return true;
    } catch {
        return false;
    }
}

export function installCardState({
    userAgent = '',
    maxTouchPoints = 0,
    standalone = false,
    dismissed = false,
    deferredPrompt = null
} = {}) {
    if (standalone || dismissed) return { visible: false, variant: 'hidden', installEnabled: false };
    if (isIos(userAgent, maxTouchPoints)) return { visible: true, variant: 'ios', installEnabled: false };
    if (deferredPrompt) return { visible: true, variant: 'install', installEnabled: true };
    if (isAndroidInstallBrowser(userAgent)) return { visible: true, variant: 'install', installEnabled: false };
    return { visible: false, variant: 'hidden', installEnabled: false };
}

function icon(doc, paths) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.8');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);
    }
    return svg;
}

const SHARE_PATHS = [
    'M12 15.5V4.5',
    'M8.2 8.2 12 4.4l3.8 3.8',
    'M6.5 11.5V18a1.5 1.5 0 0 0 1.5 1.5h8A1.5 1.5 0 0 0 17.5 18v-6.5'
];
const ADD_PATHS = [
    'M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 17 19.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5z',
    'M12 8.5v7',
    'M8.5 12h7'
];

function step(doc, graphic, label) {
    const item = doc.createElement('li');
    item.append(graphic, Object.assign(doc.createElement('span'), { textContent: label }));
    return item;
}

export function fillInstallCard(root, state, actions = {}) {
    const doc = root.ownerDocument;
    root.replaceChildren();
    root.hidden = !state.visible;
    root.dataset.variant = state.variant;
    if (!state.visible) {
        root.removeAttribute('role');
        root.removeAttribute('aria-label');
        return;
    }

    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Add Hang Out to your home screen');

    const title = doc.createElement('h2');
    title.id = 'add-home-title';
    title.textContent = 'Add Hang Out to your home screen';
    root.append(title);

    if (state.variant === 'ios') {
        const hint = doc.createElement('p');
        hint.className = 'install__hint';
        hint.textContent = SHARE_HINT;
        const steps = doc.createElement('ol');
        steps.className = 'install__steps';
        steps.append(
            step(doc, icon(doc, SHARE_PATHS), 'Share'),
            step(doc, icon(doc, ADD_PATHS), 'Add to Home Screen')
        );
        root.append(hint, steps);
    } else {
        const copy = doc.createElement('p');
        copy.className = 'install__hint';
        copy.textContent = state.installEnabled
            ? 'One tap puts Hang Out on your home screen.'
            : 'Chrome will turn on Install in a moment.';
        const install = doc.createElement('button');
        install.type = 'button';
        install.className = 'install__go';
        install.textContent = 'Install';
        install.disabled = !state.installEnabled;
        install.addEventListener('click', () => { actions.onInstall?.(); });
        root.append(copy, install);
    }

    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'install__dismiss';
    dismiss.textContent = 'Not now';
    dismiss.addEventListener('click', () => { actions.onDismiss?.(); });
    root.append(dismiss);
}

export function mountInstallCard(root, env) {
    const storage = env.storage;
    let deferred = null;
    let busy = false;
    let hiddenNow = false;

    const render = () => {
        const state = installCardState({
            userAgent: env.userAgent,
            maxTouchPoints: env.maxTouchPoints || 0,
            standalone: standaloneFrom(env),
            dismissed: hiddenNow || readFlag(storage, DISMISS_KEY) || readFlag(storage, INSTALLED_KEY),
            deferredPrompt: deferred
        });
        fillInstallCard(root, state, { onInstall: install, onDismiss: dismiss });
    };

    function dismiss() {
        hiddenNow = true;
        writeFlag(storage, DISMISS_KEY);
        deferred = null;
        render();
    }

    async function install() {
        const promptEvent = deferred;
        if (busy || !promptEvent || typeof promptEvent.prompt !== 'function') return;
        busy = true;
        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            deferred = null;
            if (choice?.outcome === 'accepted') {
                hiddenNow = true;
                writeFlag(storage, INSTALLED_KEY);
            }
        } catch {
            deferred = null;
        } finally {
            busy = false;
            render();
        }
    }

    env.listen('beforeinstallprompt', (event) => {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        deferred = event;
        render();
    });
    env.listen('appinstalled', () => {
        hiddenNow = true;
        writeFlag(storage, INSTALLED_KEY);
        deferred = null;
        render();
    });
    render();
}
