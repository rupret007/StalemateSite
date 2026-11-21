/* Local YouTube loading, cancellation and retry. Shared playback intent lives in the room. */
(() => {
    'use strict';
    const DEADLINE = 15000;

    function failure(reason) {
        const error = new Error('YouTube player unavailable');
        error.videoReason = reason;
        return error;
    }

    function providerFailure(code) {
        switch (code) {
        case 100: return failure('unavailable');
        case 101: case 150: return failure('embed-restricted');
        case 153: return failure('client-identity');
        default: return failure('video-error');
        }
    }

    function failureMessage(error, { canChooseVideo = false } = {}) {
        let next;
        switch (error?.videoReason) {
        case 'api-unavailable': case 'api-timeout':
            next = 'Couldn’t reach YouTube. Check your connection, then retry.'; break;
        case 'player-timeout':
            next = 'The video player didn’t finish connecting. Retry video when you’re ready.'; break;
        case 'unavailable': case 'embed-restricted':
            next = error.videoReason === 'unavailable' ? 'This video is unavailable.' : 'This video doesn’t allow playback inside a room.';
            next += canChooseVideo ? ' Choose another video.' : ' Ask the host to choose another video.'; break;
        case 'client-identity':
            next = 'YouTube couldn’t verify this video player. Try again later.'; break;
        default: next = 'Retry video when you’re ready.';
        }
        // Only fixed, allowlisted descriptions reach the UI. Provider errors
        // and thrown messages may include private page URLs or invitation data.
        return 'YouTube couldn’t load. ' + next;
    }

    function create(options) {
        let apiAttempt = null, current = null;

        function loadApi() {
            if (window.YT?.Player) return Promise.resolve(window.YT);
            if (apiAttempt) return apiAttempt.promise;
            const attempt = {};
            apiAttempt = attempt;
            attempt.promise = new Promise((resolve, reject) => {
                const previous = window.onYouTubeIframeAPIReady;
                const script = document.createElement('script');
                let timer;
                const done = (error) => {
                    if (apiAttempt !== attempt) return;
                    clearTimeout(timer);
                    script.onerror = null;
                    if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
                    apiAttempt = null;
                    if (error) { script.remove(); reject(error); }
                    else resolve(window.YT);
                };
                const ready = () => {
                    if (window.YT?.Player) done();
                };
                window.onYouTubeIframeAPIReady = ready;
                script.onerror = () => done(failure('api-unavailable'));
                timer = setTimeout(() => done(failure('api-timeout')), DEADLINE);
                try {
                    script.src = 'https://www.youtube.com/iframe_api';
                    document.head.append(script);
                } catch (error) { done(error); }
            });
            return attempt.promise;
        }

        function retire(record) {
            if (!record) return;
            record.active = false;
            record.cancel();
            clearTimeout(record.timer);
            // Detach before destroy: provider callbacks and late ready events
            // from this instance must never reach a replacement selection.
            const old = options.getElement();
            const placeholder = document.createElement('div');
            for (const attr of old.attributes) {
                if (!['src', 'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy'].includes(attr.name)) {
                    placeholder.setAttribute(attr.name, attr.value);
                }
            }
            old.replaceWith(placeholder);
            options.setElement(placeholder);
            try { record.instance?.stopVideo?.(); } catch (_) { /* retired provider */ }
            try { record.instance?.destroy?.(); } catch (_) { /* retired provider */ }
        }

        function select(id) {
            if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return Promise.resolve(null);
            if (current?.id === id) return current.promise;
            retire(current);
            const record = { id, active: true, instance: null, ready: false };
            const cancelled = new Promise(resolve => { record.cancel = () => resolve(null); });
            current = record;
            record.promise = (async () => {
                try {
                    const YT = await Promise.race([loadApi(), cancelled]);
                    if (!YT || !record.active) return null;
                    const loaded = new Promise((resolve, reject) => {
                        const frame = document.createElement('iframe');
                        for (const attr of options.getElement().attributes) frame.setAttribute(attr.name, attr.value);
                        frame.setAttribute('frameborder', '0');
                        frame.setAttribute('allowfullscreen', '');
                        frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                        frame.setAttribute('title', frame.getAttribute('title') || 'YouTube video player');
                        frame.referrerPolicy = 'strict-origin-when-cross-origin';
                        // Never let the API's div constructor derive metadata
                        // from the full page URL, which can contain invitations.
                        const query = new URLSearchParams({ enablejsapi: '1', origin: location.origin,
                            playsinline: '1', rel: '0', widget_referrer: location.origin });
                        frame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?${query}`;
                        options.getElement().replaceWith(frame);
                        options.setElement(frame);
                        record.timer = setTimeout(() => reject(failure('player-timeout')), DEADLINE);
                        record.instance = new YT.Player(frame, { events: {
                            onReady: (event) => {
                                if (!record.active) return;
                                clearTimeout(record.timer);
                                record.ready = true;
                                resolve(event.target);
                            },
                            onError: (event) => {
                                if (!record.active) return;
                                const error = providerFailure(event?.data);
                                if (!record.ready) reject(error);
                                else {
                                    retire(record); current = null;
                                    options.onError(error);
                                }
                            },
                            onStateChange: (event) => { if (record.active && record.ready) options.onStateChange(event); },
                            onAutoplayBlocked: (event) => { if (record.active && record.ready) options.onAutoplayBlocked(event); }
                        } });
                        options.setElement(document.getElementById(frame.id) || frame);
                    });
                    const instance = await Promise.race([loaded, cancelled]);
                    return record.active ? instance : null;
                } catch (error) {
                    if (!record.active) return null;
                    retire(record);
                    if (current === record) current = null;
                    throw error;
                }
            })();
            return record.promise;
        }

        function cancel() {
            retire(current); current = null;
            // The API belongs to this page, not a room selection. Removing its
            // script cannot stop late execution; keep one bounded attempt when
            // a room is initialized again or left while the download is pending.
        }

        return { select, cancel };
    }

    window.HangoutYouTube = { create, failureMessage };
})();
