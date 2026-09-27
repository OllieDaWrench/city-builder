import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
         '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));

const boot = await page.evaluate(() => ({
  money: document.getElementById('cb-money')?.textContent ?? null,
  cats: document.querySelectorAll('.cb-cat').length,
  connWarn: !document.getElementById('cb-connwarn')?.classList.contains('hidden'),
  helpShown: !!document.querySelector('.cb-backdrop:not(.hidden)'),
  canvas: (() => { const c = document.querySelector('.cb-ui')?.previousElementSibling; return c ? c.tagName : null; })(),
}));

// close help, pick the street tool, drag a road near the map centre
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.press('1');
const c = await page.$('#cb-root canvas');
const box = await c.boundingBox();
await page.mouse.move(box.x + 620, box.y + 430);
await page.mouse.down();
await page.mouse.move(box.x + 760, box.y + 430, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 800));

const state = await page.evaluate(() => {
  // reach into React props via the root element's internal fibre is fragile;
  // instead read the HUD and count roads via a quick canvas-independent hack:
  return { money: document.getElementById('cb-money')?.textContent };
});
await page.screenshot({ path: 'test/game-screenshot.png' });
console.log('boot :', JSON.stringify(boot));
console.log('hud  :', JSON.stringify(state));
console.log('errors:', errors.length ? errors.join(' | ') : 'NONE ✓');
await browser.close();
