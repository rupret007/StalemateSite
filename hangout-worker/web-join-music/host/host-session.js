import { musicSignal } from './request-signal.js';
import { enrollmentProof, open, sdpFingerprint, seal, toHex } from './crypto.js';
import { musicSdp, tuneReceiver } from './audio.js';
import { offerHasReviewedAllocation, policySdp } from './policy.js';
import { gatherAnswerSDP, WebJoinSession } from './session.js';

export class BrowserMusicHost extends WebJoinSession {
    async host(credentials, onOffer) {
        const signal = this.controller.signal;
        this.accessExpiresAt = Math.min(credentials.expiresAt, this.invite.expiresAt * 1000);
        this.quotaBytes = Math.min(this.quotaBytes, credentials.quotaBytes);
        this.expiryTimer = setTimeout(() => this.fail(new Error('Music expired.')), Math.max(0, this.accessExpiresAt - Date.now()));
        const certificate = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
        signal.throwIfAborted();
        const pc = this.pc = new RTCPeerConnection({ certificates: [certificate], iceServers: credentials.iceServers,
            iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
        pc.addEventListener('track', event => {
            tuneReceiver(event.receiver, this._jitterAdaptation.targetMs);
            this._inboundReceiver = event.receiver;
            const stream = event.streams[0] || new MediaStream([event.track]);
            if (this.authorized) this.onTrack(stream);
            else this.pendingStream = stream;
        });
        pc.addEventListener('connectionstatechange', () => {
            if (['failed', 'closed'].includes(pc.connectionState)) this.fail(new Error('Music connection ended.'));
            if (pc.connectionState === 'disconnected') this.disconnectTimer ??= setTimeout(() => this.fail(new Error('Music connection was lost.')), 10000);
            if (pc.connectionState === 'connected') { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
        });
        pc.addEventListener('datachannel', event => event.channel.close());
        const channel = this.channel = pc.createDataChannel('webjoin-enrollment');
        channel.binaryType = 'arraybuffer';
        channel.addEventListener('close', () => this.fail(new Error('The guest left Music.')));
        pc.addTrack(this.stream.getAudioTracks()[0], this.stream);
        const description = await pc.createOffer();
        await pc.setLocalDescription({ type: 'offer', sdp: musicSdp(description.sdp) });
        const sdp = await gatherAnswerSDP(pc, signal, { allowReviewedAllocations: true });
        const offer = { v: 1, kind: 'offer', session: this.invite.session, generation: this.invite.generation,
            expires_at: this.invite.expiresAt, nonce: toHex(crypto.getRandomValues(new Uint8Array(16))),
            host_pin: sdpFingerprint(sdp), guest_pin: '', sdp };
        await this.mailbox.send('offer', await seal(this.invite, offer));
        signal.throwIfAborted();
        onOffer();
        const answer = await open(this.invite, await this.mailbox.receive('answer'));
        if (!answer || Object.keys(answer).length !== Object.keys(offer).length || answer.kind !== 'answer'
            || ['v', 'session', 'generation', 'expires_at', 'nonce', 'host_pin'].some(key => answer[key] !== offer[key])
            || answer.guest_pin !== sdpFingerprint(answer.sdp)) throw new Error('Guest identity did not match.');
        const expected = await enrollmentProof(this.invite, answer);
        signal.throwIfAborted();
        const enrollment = musicSignal(signal, AbortSignal.timeout(30000));
        const enrolled = new Promise((resolve, reject) => {
            const abort = () => reject(enrollment.reason);
            enrollment.addEventListener('abort', abort, { once: true });
            channel.addEventListener('message', ({ data }) => {
                if (enrollment.aborted) return;
                const proof = data instanceof ArrayBuffer ? new Uint8Array(data) : [];
                if (this.authorized || proof.length !== expected.length || !expected.every((byte, index) => byte === proof[index])) {
                    reject(new Error('Guest authorization failed.'));
                    this.fail(new Error('Guest authorization failed.'));
                    return;
                }
                try { channel.send('authorized'); }
                catch (error) { reject(error); return; }
                enrollment.removeEventListener('abort', abort);
                this.authorized = true;
                resolve();
            });
        });
        enrolled.catch(() => {});
        await pc.setRemoteDescription({ type: 'answer', sdp: policySdp(answer.sdp, {
            remote: true, allowReviewedAllocations: offerHasReviewedAllocation(sdp)
        }) });
        await enrolled;
        signal.throwIfAborted();
        this.stream.getAudioTracks().forEach(track => { track.enabled = true; });
        if (this.pendingStream) this.onTrack(this.pendingStream);
        this.pendingStream = null;
        this.statsTimer = setInterval(() => this.updateStats(), 1000);
    }
}
