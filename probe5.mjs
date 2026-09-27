import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(
    () => (document.getElementById('cb-money') || {}).textContent?.length > 0 ||
          document.body.innerText.includes('failed to start'),
    { timeout: 25000 }
  );
} catch (e) {}
const txt = await page.evaluate(() => document.querySelector('#cb-root pre')?.textContent?.slice(0, 900) || '(no error box — money=' + document.getElementById('cb-money')?.textContent + ')');
console.log(txt);
await browser.close();
