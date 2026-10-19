(() => {
    'use strict';
    const status = document.querySelector('#preview-status');
    const nonce = document.querySelector('meta[name="preview-csrf"]').content;
    for (const button of document.querySelectorAll('[data-profile]')) button.addEventListener('click', async () => {
        // Open during the user gesture so browsers do not block the completed launch.
        const tab = window.open('about:blank', '_blank');
        if (tab) tab.opener = null;
        button.disabled = true;
        status.textContent = 'Creating your local test identity…';
        try {
            const response = await fetch('/__preview/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Preview-CSRF': nonce }, body: JSON.stringify({ profile: button.dataset.profile }) });
            if (!response.ok) throw new Error(await response.text());
            const result = await response.json();
            if (tab) tab.location.replace(result.url);
            else { const link = document.createElement('a'); link.href = result.url; link.textContent = `Open ${result.label}`; status.replaceChildren(link); return; }
            status.textContent = `${result.label} opened in another tab. Use a different nickname for each connection.`;
        } catch (error) { tab?.close(); status.textContent = `Could not open the preview: ${error.message}`; }
        finally { button.disabled = false; }
    });
    const update = async () => {
        try {
            const response = await fetch('/__preview/status');
            if (!response.ok) return;
            const result = await response.json();
            document.querySelector('#preview-runtime').textContent = `${result.connected} live connection${result.connected === 1 ? '' : 's'} · ${result.persistentRooms} registered room${result.persistentRooms === 1 ? '' : 's'} · AI disabled. Local room, account, and moderation state survive a preview restart.`;
        } catch { document.querySelector('#preview-runtime').textContent = 'The local preview server is stopped. Run npm run dev:hangout to return.'; }
    };
    update(); setInterval(update, 4000);
})();
