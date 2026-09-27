import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage();
let errUrl = null, errLine = 0, errCol = 0;
page.on('pageerror', async (e) => {
  const m = e.stack?.split('\n').find(l => l.includes('createUI'));
  if (m && !errUrl) {
    const mm = m.match(/(http:\S+\.js):(\d+):(\d+)/);
    if (mm) { errUrl = mm[1]; errLine = +mm[2]; errCol = +mm[3]; }
  }
});
await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
if (errUrl) {
  const txt = await page.evaluate(async (u) => await fetch(u).then(r => r.text()), errUrl);
  const lines = txt.split('\n');
  console.log('chunk:', errUrl, 'line', errLine, 'col', errCol);
  console.log('>>>', lines[errLine - 1]?.slice(Math.max(0, errCol - 250), errCol + 250));
} else {
  console.log('no createUI frame captured');
}
await browser.close();
