import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const [w, out, ...urls] = process.argv.slice(2);
const p = await b.newPage({ viewport: { width: Number(w), height: 844 } });
for (const u of urls) {
  await p.goto('http://localhost:4399/' + u, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(500);
  const n = u.replace(/[/?=&]/g, '_') || 'home';
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log(n, 'height', h, 'overflow', over);
  await p.screenshot({ path: `${out}/${n}-${w}.png`, fullPage: false });
}
await b.close();
