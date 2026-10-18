// Sends canonical URLs without a prerendered page to the client-rendered fallbacks
// (loaded as a file so the Content Security Policy allows it; see astro.config.mjs).
const base = document.currentScript?.dataset.base ?? '/';
// Bills, members, council matters, state bills and discussions newer than the last build (or from older Congresses) have no
// prerendered page; send canonical URLs to the client-rendered fallbacks.
(function () {
  const root = base.endsWith('/') ? base : base + '/';
  const path = location.pathname.slice(root.length - 1);
  const bill = /^\/bills\/(\d{2,3})\/([a-z]+)\/(\d+)\/?$/.exec(path);
  if (bill) {
    document.getElementById('nf-title').textContent = 'Loading bill…';
    location.replace(root + 'bill/?id=' + bill[1] + '-' + bill[2] + '-' + bill[3]);
    return;
  }
  const member = /^\/members\/([A-Z]\d{6})\/?$/.exec(path);
  if (member) {
    document.getElementById('nf-title').textContent = 'Loading member…';
    location.replace(root + 'member/?id=' + member[1]);
    return;
  }
  const matter = /^\/states\/([a-z]{2}\/[a-z-]+)\/matters\/(\d+)\/?$/.exec(path);
  if (matter) {
    document.getElementById('nf-title').textContent = 'Loading council matter…';
    location.replace(root + 'states/' + matter[1] + '/matter/?id=' + matter[2]);
    return;
  }
  // A state's Governor & courts tab became two tabs.
  const exec = /^\/states\/([a-z]{2})\/executive\/?$/.exec(path);
  if (exec) {
    location.replace(root + 'states/' + exec[1] + '/governor/');
    return;
  }
  // Cities moved under their state (/boston/ → /states/ma/boston/); Boston councilor ids gained a "p".
  const oldCity = /^\/(boston|worcester)(\/.*)?$/.exec(path);
  if (oldCity) {
    const rest = (oldCity[2] || '/')
      .replace(/^\/councilors\/(\d+)\//, '/councilors/p$1/')
      .replace(/^\/(council|committees|neighborhoods|budget)\/?$/, '/$1/');
    location.replace(root + 'states/ma/' + oldCity[1] + rest + location.search + location.hash);
    return;
  }
  const stateBill = /^\/states\/([a-z]{2})\/bills\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/.exec(path);
  if (stateBill) {
    document.getElementById('nf-title').textContent = 'Loading state bill…';
    location.replace(root + 'state-bill/?state=' + stateBill[1] + '&session=' + stateBill[2] + '&bill=' + stateBill[3]);
    return;
  }
  const discussion = /^\/discussions\/([a-z0-9][a-z0-9-]{2,59})\/?$/.exec(path);
  if (discussion) {
    document.getElementById('nf-title').textContent = 'Loading discussion…';
    location.replace(root + 'discussion/?id=' + discussion[1]);
  }
})();
