const fragment = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const status = document.getElementById('status');
const request = /^([a-f0-9]{32})&(k=[A-Za-z0-9_-]{43}&s=[a-f0-9]{64}&g=[1-9][0-9]{0,9}&e=[1-9][0-9]{0,12})$/.exec(fragment);
const retry = 'End the browser invite in WebJam, then retry from your Jam room in this browser profile.';
if (!request || location.protocol !== 'https:' || typeof BroadcastChannel !== 'function') {
    status.textContent = retry;
} else {
    const channel = new BroadcastChannel(`webjam-music-${request[1]}`);
    const timer = setTimeout(() => {
        channel.close();
        status.textContent = retry;
    }, 8000);
    channel.onmessage = ({ data }) => {
        if (typeof data?.returned !== 'boolean') return;
        clearTimeout(timer);
        channel.close();
        status.textContent = data.returned ? 'Return to your Jam room. You can close this tab.' : retry;
    };
    channel.postMessage({ href: `${location.origin}/join/#${request[2]}` });
}
