import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
const res = await page.evaluate(() => {
  const el = document.querySelector('.cb-ui');
  if (!el) return { noEl: true };
  const matches = el.innerHTML.match(/id="(cb-[a-z-]+)"/g) || [];
  const ui = {};
  for (const id of matches) ui[id.slice(4, -1)] = !!el.querySelector('#' + id.slice(4, -1));
  const failed = Object.entries(ui).filter(([, ok]) => !ok).map(([k]) => k);
  return {
    matchCount: matches.length,
    sampleMatches: matches.slice(0, 8),
    hasCats: 'cats' in ui,
    failedLookups: failed,
    catsDirect: !!document.getElementById('cb-cats'),
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
