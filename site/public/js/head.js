// Runs in <head> before first paint (a file, not inline, so the Content Security
// Policy allows it without a hash; see astro.config.mjs).
// Mark that scripts run, so the collapsible menu starts closed (it stays open without JS).
document.documentElement.classList.add('js');
// Apply a saved theme before first paint. Storage may be unavailable; ignore errors.
try {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  // Districts remembered on this device (lib/my-area.ts): the home page shows them
  // instead of the address form.
  if (localStorage.getItem('commonhall-area')) document.documentElement.dataset.area = '';
} catch {
  // Storage unavailable; fall back to the system theme.
}

// Photos load from their public sources; on error try data-fallback, then show initials.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('photo')) return;
    if (img.dataset.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
      return;
    }
    const span = document.createElement('span');
    span.className = 'photo photo-fallback';
    span.setAttribute('aria-hidden', 'true');
    span.style.cssText = img.style.cssText;
    span.style.fontSize = Math.min(19, Math.round((img.width || 96) * 0.4)) + 'px';
    span.textContent = img.dataset.initials || '';
    img.replaceWith(span);
  },
  true,
);
