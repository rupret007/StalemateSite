// The initial offerer establishes one transceiver per kind. Both peers can
// renegotiate after that, for example when both turn on their mics at once.
export function openGameNightPeer({ initiates, iceServers, send, remoteTrack, connectionChanged, failed }) {
    const pc = new RTCPeerConnection({ iceServers });
    const kinds = ['audio', 'video'];
    const tracks = new Map();
    const pendingIce = [];
    let closed = false, ignoreOffer = false, jobs = Promise.resolve();
    const enqueue = operation => {
        jobs = jobs.then(() => !closed && operation()).catch(() => { if (!closed) failed(); });
    };
    function describe() {
        if (!closed && pc.localDescription) send({ sdp: pc.localDescription.toJSON() });
    }
    async function applyTracks() {
        for (const transceiver of pc.getTransceivers()) {
            if (closed) return;
            const track = tracks.get(transceiver.receiver.track.kind) || null;
            const direction = track ? 'sendrecv' : 'recvonly';
            if (transceiver.direction !== direction) transceiver.direction = direction;
            if (transceiver.sender.track !== track) await transceiver.sender.replaceTrack(track);
        }
    }
    function applyIce(ice) { return pc.addIceCandidate(ice).catch(() => {}); }
    pc.onnegotiationneeded = () => enqueue(async () => {
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription();
        describe();
    });
    pc.onicecandidate = ({ candidate }) => { if (!closed && candidate) send({ ice: candidate.toJSON() }); };
    pc.ontrack = ({ track }) => { if (!closed) remoteTrack(track); };
    pc.onconnectionstatechange = () => { if (!closed) connectionChanged(pc.connectionState); };
    if (initiates) for (const kind of kinds) pc.addTransceiver(kind, { direction: 'recvonly' });
    return {
        setTrack(kind, track) {
            tracks.set(kind, track);
            enqueue(applyTracks);
        },
        setIceServers(servers) {
            enqueue(async () => {
                pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
                if (!pc.getTransceivers().length) return;
                if (pc.connectionState === 'connected') {
                    const stats = await pc.getStats();
                    const transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
                    const pair = stats.get(transport?.selectedCandidatePairId);
                    const selected = stats.get(pair?.localCandidateId);
                    if (selected && selected.candidateType !== 'relay') return;
                }
                if (!closed) pc.restartIce();
            });
        },
        receive({ sdp, ice }) {
            enqueue(async () => {
                if (sdp) {
                    const offer = sdp.type === 'offer';
                    const collision = offer && pc.signalingState !== 'stable';
                    ignoreOffer = collision && initiates;
                    if (ignoreOffer) return;
                    await pc.setRemoteDescription(sdp);
                    if (closed) return;
                    for (const candidate of pendingIce.splice(0)) await applyIce(candidate);
                    if (offer && !closed) {
                        await applyTracks();
                        if (closed) return;
                        await pc.setLocalDescription();
                        describe();
                    }
                } else if (ice && !ignoreOffer) {
                    if (pc.remoteDescription) await applyIce(ice);
                    else if (pendingIce.length < 64) pendingIce.push(ice);
                }
            });
        },
        close() {
            closed = true;
            pc.close();
        }
    };
}
