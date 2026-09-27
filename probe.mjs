import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
const missing = await page.evaluate(() => {
  const wanted = ['cats','subtools','overlays','pause','play','fast','save','load','export','import','file','new','settings','help','daynight','cityname','money','pop','happy','jobs','bal','date','dr','dc','di','do','connwarn','hint','tooltip','info','toasts','modal'];
  return wanted.filter(id => !document.getElementById('cb-' + id));
});
console.log('missing ids:', JSON.stringify(missing));
await browser.close();
