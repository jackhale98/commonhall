// While the next page loads, the roll call plays in a small badge so a slow load doesn't
// look like a hang. Loaded as a file so the Content Security Policy allows it (see
// astro.config.mjs). Fast loads finish before the badge fades in.
(function () {
  let badge = null;
  let timer = 0;
  const hide = () => {
    badge?.remove();
    badge = null;
    window.clearTimeout(timer);
  };
  const show = () => {
    if (badge) return;
    // The roll-call mark from the footer logo, so it is drawn in one place.
    const mark = document.querySelector('#brand-egg .ch-loader')?.cloneNode(true);
    if (!mark) return;
    mark.setAttribute('class', 'ch-loader');
    badge = document.createElement('div');
    badge.className = 'ch-navigating';
    badge.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'Loading…';
    badge.append(mark, text);
    document.body.append(badge);
    // A stopped or failed load fires nothing here; don't leave the badge up for good.
    timer = window.setTimeout(hide, 20000);
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // A jump within the page loads nothing.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    show();
  });
  // Coming back with the Back button can restore this page with the badge still up.
  window.addEventListener('pageshow', hide);
})();
