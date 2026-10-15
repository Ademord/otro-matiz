const { chromium } = require('playwright');
(async () => {
  const [,, url, out] = process.argv;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(url);
  // scroll through to trigger lazy images
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 800) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(150); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  const imgs = await page.evaluate(() => [...document.images].map(i => [i.naturalWidth, i.naturalHeight]));
  console.log(JSON.stringify({ images: imgs.length, sizes: imgs.slice(0, 3) }));
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
