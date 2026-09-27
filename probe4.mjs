import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage();
const stackLines = [];
page.on('pageerror', (e) => stackLines.push(...e.stack.split('\n')));
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(
    () => (document.getElementById('cb-money') || {}).textContent?.length > 0 ||
          document.body.innerText.includes('failed to start'),
    { timeout: 25000 }
  );
} catch (e) { console.log('timeout waiting for boot'); }
const money = await page.evaluate(() => document.getElementById('cb-money')?.textContent);
console.log('money:', JSON.stringify(money));
console.log('--- full pageerror stack ---');
console.log(stackLines.join('\n').slice(0, 3000) || '(none)');
await browser.close();
