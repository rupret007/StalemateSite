/* Thank-you state after FormSubmit redirect; keep _next aligned with the live origin. */
(function () {
    'use strict';
    var form = document.querySelector('[data-contact-form]');
    if (!form) return;

    var nextInput = form.querySelector('input[name="_next"]');
    if (nextInput) {
        var pathname = window.location.pathname || '/';
        if (!pathname.endsWith('/')) pathname += '/';
        nextInput.value = window.location.origin + pathname + '?contact=sent#contact';
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get('contact') !== 'sent') return;

    var thanks = document.querySelector('[data-contact-thanks]');
    var panel = document.querySelector('[data-contact-panel]');
    if (thanks) thanks.hidden = false;
    if (panel) panel.hidden = true;
    if (thanks) {
        thanks.focus({ preventScroll: true });
    }
}());
