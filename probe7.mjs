import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
const res = await page.evaluate(() => {
  const el = document.querySelector('.cb-ui');
  const matches = (el.innerHTML.match(/id="(cb-[a-z-]+)"/g) || []).map(m => m.slice(4, -1));
  const counts = {};
  for (const m of matches) counts[m] = (counts[m] || 0) + 1;
  const dups = Object.entries(counts).filter(([, n]) => n > 1);
  const wanted = ['cats','subtools','overlays','pause','play','fast','save','load','export','import','file','new','settings','help','daynight','cityname','money','pop','happy','jobs','bal','date','dr','dc','di','do','connwarn','hint','tooltip','info','toasts','modal'];
  const notMatched = wanted.filter(w => !counts['cb-' + w]);
  return { total: matches.length, dups, notMatched };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
