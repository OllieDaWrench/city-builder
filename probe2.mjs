import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage();
const src = await page.evaluate(async () => {
  const chunks = performance.getEntriesByType('resource').map(r => r.name).filter(u => u.includes('/chunks/') && u.endsWith('.js'));
  for (const u of chunks) {
    try {
      const txt = await fetch(u).then(r => r.text());
      const lines = txt.split('\n');
      if (lines[1886] && lines[1886].includes('addEventListener')) {
        return { url: u, line: lines[1886].slice(Math.max(0, 13 - 200), 13 + 200), ctx: lines.slice(1880, 1892).join('\n').slice(0, 1500) };
      }
    } catch (e) {}
  }
  return null;
});
console.log(JSON.stringify(src, null, 2));
await browser.close();
