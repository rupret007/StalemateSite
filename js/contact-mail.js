/* Assemble the band inbox mailto without leaving a scrape-friendly href in HTML. */
(function () {
    'use strict';
    var link = document.querySelector('[data-contact-mailto]');
    if (!link) return;
    var local = 'stalemate.punk';
    var host = ['gmail', 'com'].join('.');
    var addr = local + '@' + host;
    link.href = 'mailto:' + addr;
    link.textContent = addr;
    link.hidden = false;
}());
