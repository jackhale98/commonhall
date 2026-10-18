// The site menu (loaded as a file so the Content Security Policy allows it; see astro.config.mjs).
// Expanding menu on narrow screens: toggle, close on Escape or when a link is chosen.
(function () {
  const button = document.getElementById('menu-toggle');
  const menu = document.getElementById('site-menu');
  if (!button || !menu) return;
  const set = (open) => {
    button.setAttribute('aria-expanded', String(open));
    menu.toggleAttribute('data-open', open);
  };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    set(open);
    if (open) menu.querySelector('a, input')?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      set(false);
      button.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) set(false);
  });
  window.matchMedia('(min-width: 64rem)').addEventListener('change', (e) => e.matches && set(false));

  // Wide screens: Congress and States & local open a small menu on click (not hover).
  const groups = [...menu.querySelectorAll('.nav-group-button')];
  const close = (except) => groups.forEach((g) => g !== except && g.setAttribute('aria-expanded', 'false'));
  groups.forEach((g) =>
    g.addEventListener('click', () => {
      const open = g.getAttribute('aria-expanded') !== 'true';
      close(g);
      g.setAttribute('aria-expanded', String(open));
    }),
  );
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.nav-group')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = groups.find((g) => g.getAttribute('aria-expanded') === 'true');
    if (open) {
      close();
      open.focus();
    }
  });
  menu.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Element) || !e.relatedTarget.closest('.nav-group')) close();
  });
})();
