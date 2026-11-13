export function homeScreenWorkerTarget(moduleUrl) {
    const script = new URL('../sw.js', moduleUrl);
    const scope = new URL('../', moduleUrl);
    return { script: script.href, scope: scope.pathname, type: 'module' };
}

export function registerHomeScreenWorker(navigatorLike, moduleUrl) {
    if (!navigatorLike?.serviceWorker?.register) return Promise.resolve(null);
    const target = homeScreenWorkerTarget(moduleUrl);
    return navigatorLike.serviceWorker.register(target.script, {
        scope: target.scope,
        type: target.type
    });
}
