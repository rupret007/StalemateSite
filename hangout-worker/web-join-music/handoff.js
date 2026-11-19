const fragment = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const status = document.getElementById('status');
const request = /^([a-f0-9]{32})&(k=[A-Za-z0-9_-]{43}&s=[a-f0-9]{64}&g=[1-9][0-9]{0,9}&e=[1-9][0-9]{0,12})$/.exec(fragment);
const prepare = /^([a-f0-9]{32})&p=([a-f0-9]{64})&s=([a-f0-9]{64})&g=([1-9][0-9]{0,9})$/.exec(fragment);
const retry = 'End the browser invite in WebJam, then retry from your Jam room in this browser profile.';
if ((!request && !prepare) || location.protocol !== 'https:' || typeof BroadcastChannel !== 'function') {
    status.textContent = retry;
} else if (prepare) {
    const channel = new BroadcastChannel(`webjam-music-${prepare[1]}`);
    channel.postMessage({ proofHash: prepare[2], webjam: prepare[3], generation: Number(prepare[4]) });
    channel.close();
    status.textContent = 'Return to WebJam while the invitation is prepared.';
} else {
    const channel = new BroadcastChannel(`webjam-music-${request[1]}`);
    function finish(message) {
        clearTimeout(waiting);
        clearTimeout(deadline);
        channel.onmessage = null;
        channel.close();
        status.textContent = message;
    }
    const waiting = setTimeout(() => {
        status.textContent = 'Still waiting for Hang Out to confirm delivery. Keep this tab open.';
    }, 8000);
    // The Jam room can still confirm the offer after the waiting message.
    const deadline = setTimeout(() => {
        finish('This tab stopped waiting for delivery. Check your Jam room for the latest status. If delivery is still unclear, check with your bandmate before sending another invitation.');
    }, 90000);
    channel.onmessage = ({ data }) => {
        if (typeof data?.returned !== 'boolean') return;
        finish(data.returned ? 'Return to your Jam room. You can close this tab.' : retry);
    };
    channel.postMessage({ href: `${location.origin}/join/#${request[2]}` });
}
