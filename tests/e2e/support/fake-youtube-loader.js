// Appended to the ordinary offline fixture ONLY by loader failure regressions.
// Default fake-youtube.js behavior is unchanged for every other suite.
(() => {
    const BasePlayer = window.YT.Player;
    const control = window.__ytLoaderFixture = { constructed: 0, retiredCalls: [], readyHeld: false, readyDelivered: false };
    window.YT.Player = function LoaderFaultPlayer(node, options) {
        const number = ++control.constructed;
        const events = options.events || {};
        const player = new BasePlayer(node, { ...options, events: {
            ...events,
            onReady(event) {
                if (number === 1 && window.__ytLoaderFailure === 'never-ready') return;
                if (number === 1 && window.__ytLoaderFailure === 'provider-error') {
                    events.onError?.({ target: event.target, data: 100 });
                    return;
                }
                if (number === 2 && window.__ytLoaderFailure === 'hold-second-ready') {
                    control.readyHeld = true;
                    control.releaseReady = () => {
                        if (control.readyDelivered) return;
                        events.onReady?.(event);
                        control.readyDelivered = true;
                    };
                    return;
                }
                events.onReady?.(event);
            }
        } });
        // The genuine API supports destroy(); this opt-in fixture preserves a
        // target for the next real construction after failure/timeout cleanup.
        const id = typeof node === 'string' ? node : node.id;
        const ownBox = document.getElementById(id);
        let retired = false;
        for (const method of ['getCurrentTime', 'getPlayerState', 'playVideo', 'pauseVideo', 'seekTo', 'cueVideoById', 'loadVideoById', 'stopVideo']) {
            if (typeof player[method] !== 'function') continue;
            const original = player[method];
            player[method] = function (...args) {
                if (retired) {
                    control.retiredCalls.push(method);
                    throw new Error('A retired fixture player was called');
                }
                return original.apply(player, args);
            };
        }
        player.destroy = () => {
            retired = true;
            if (!ownBox?.isConnected) return;
            const placeholder = document.createElement('div');
            for (const attribute of ownBox.attributes) {
                if (!['data-fake-yt', 'data-video-id', 'data-state'].includes(attribute.name)) placeholder.setAttribute(attribute.name, attribute.value);
            }
            ownBox.replaceWith(placeholder);
        };
        return player;
    };
})();
