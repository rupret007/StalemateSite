// WebKit has no Chromium fake-camera launch flags. A successful getUserMedia
// is what turns off WPE's mDNS host-candidate substitution; those .local
// names never resolve here, so the peer connection stays in checking.
// The same call is also the only capture that reports a real video size.
// If the machine has no camera (NotFoundError, or a stream with no live tracks), a canvas track is the stand-in. Permission, security, constraint, and unexpected getUserMedia errors are rethrown, not replaced with fake tracks. WPE's
// LibWebRTC VP8 decoder crashes once canvas frames are sent, so video
// negotiations prefer H.264, which decodes those frames.

function installWebKitMedia() {
    if (typeof RTCPeerConnection === 'function' && !RTCPeerConnection.prototype.__webkitH264) {
        const h264 = (RTCRtpSender.getCapabilities?.('video')?.codecs || [])
            .filter(codec => codec.mimeType.toLowerCase() === 'video/h264');
        if (h264.length && RTCRtpTransceiver.prototype.setCodecPreferences) {
            const prefer = function preferH264() {
                for (const transceiver of this.getTransceivers()) {
                    if (transceiver.receiver?.track?.kind === 'video') transceiver.setCodecPreferences(h264);
                }
            };
            for (const method of ['createOffer', 'createAnswer']) {
                const negotiate = RTCPeerConnection.prototype[method];
                RTCPeerConnection.prototype[method] = function (...args) {
                    prefer.call(this);
                    return negotiate.apply(this, args);
                };
            }
            // The lobby publishes with setLocalDescription() and no JS offer.
            // An explicit offer or answer already had its codecs chosen above.
            const setLocal = RTCPeerConnection.prototype.setLocalDescription;
            RTCPeerConnection.prototype.setLocalDescription = function (description, ...rest) {
                if (description == null && this.signalingState !== 'closed') prefer.call(this);
                return setLocal.call(this, description, ...rest);
            };
            RTCPeerConnection.prototype.__webkitH264 = true;
        }
    }

    const devices = navigator.mediaDevices;
    if (!devices || devices.__webkitMedia || typeof devices.getUserMedia !== 'function') return;
    const native = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async function webKitMedia(constraints = {}) {
        const wantsVideo = Boolean(constraints && constraints.video);
        const wantsAudio = Boolean(constraints && constraints.audio);
        if (!wantsVideo && !wantsAudio) return native(constraints);
        try {
            const stream = await native(constraints);
            const videoOk = !wantsVideo || stream.getVideoTracks().some(track => track.readyState === 'live');
            const audioOk = !wantsAudio || stream.getAudioTracks().some(track => track.readyState === 'live');
            if (videoOk && audioOk) return stream;
            stream.getTracks().forEach(track => track.stop());
            // A returned stream with no usable tracks is treated like a missing
            // device. Any other failed capture must not be turned into success.
        } catch (error) {
            const name = String(error && error.name || '');
            if (name !== 'NotFoundError' && name !== 'DevicesNotFoundError') throw error;
        }
        const stream = new MediaStream();
        const kept = window.__webkitMedia || (window.__webkitMedia = []);
        if (wantsVideo) {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const surface = canvas.getContext('2d', { alpha: false });
            const paint = () => {
                surface.fillStyle = '#252d2b';
                surface.fillRect(0, 0, canvas.width, canvas.height);
                surface.fillStyle = '#d4ad65';
                surface.fillRect(48, 60, 140, 120);
            };
            paint();
            const [track] = canvas.captureStream(8).getVideoTracks();
            const timer = setInterval(() => {
                if (track.readyState === 'ended') clearInterval(timer);
                else paint();
            }, 120);
            track.addEventListener('ended', () => clearInterval(timer));
            kept.push(canvas);
            stream.addTrack(track);
        }
        if (wantsAudio) {
            const Context = window.AudioContext || window.webkitAudioContext;
            const audio = new Context();
            const destination = audio.createMediaStreamDestination();
            const tone = audio.createOscillator();
            const level = audio.createGain();
            level.gain.value = 0;
            tone.connect(level).connect(destination);
            tone.start();
            if (audio.state === 'suspended') await audio.resume();
            const [track] = destination.stream.getAudioTracks();
            track.addEventListener('ended', () => { void audio.close(); });
            kept.push(audio);
            stream.addTrack(track);
        }
        return stream;
    };
    devices.__webkitMedia = true;
}

function chromiumMediaLaunch(browserName, launchOptions, args) {
    if (browserName !== 'chromium') return launchOptions;
    return { ...launchOptions, args: [...(launchOptions.args || []), ...args] };
}

module.exports = { installWebKitMedia, chromiumMediaLaunch };
