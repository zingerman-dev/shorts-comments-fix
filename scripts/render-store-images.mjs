// Renders the extension icons and the Chrome Web Store graphics:
//   npm run store:images
// Icons:  store/src/icon.svg (48, 128) and icon-small.svg (16, 32) -> extension/icons/
// Store:  store/src/graphics.html -> store/images/<lang>/<asset>.png (24-bit PNG)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pngInfo, withoutAlpha } from './png.mjs';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'store', 'src');
const out = path.join(root, 'store', 'images');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ICONS = [
  { size: 16, svg: 'icon-small.svg' },
  { size: 32, svg: 'icon-small.svg' },
  { size: 48, svg: 'icon.svg' },
  { size: 128, svg: 'icon.svg' },
];
const ASSETS = {
  'screenshot-1': [1280, 800],
  'screenshot-2': [1280, 800],
  'promo-small': [440, 280],
  'promo-marquee': [1400, 560],
};
const LANGS = ['en', 'ru', 'es', 'fr', 'de', 'pt_BR', 'id', 'ja', 'zh_CN', 'hi', 'ar', 'bn', 'he'];
// The Chrome Web Store localizes screenshots but not promo tiles, so the tiles are English only.
const PROMO_LANGS = ['en'];

// Unbounded (headlines) and Onest (text) cover Latin and Cyrillic; other scripts add a pair of their own.
const FONTS = ['unbounded', 'onest'];
const SCRIPT_FONTS = {
  ja: ['m-plus-1', 'noto-sans-jp'],
  zh_CN: ['noto-sans-sc'],
  hi: ['baloo-2', 'noto-sans-devanagari'],
  bn: ['baloo-da-2', 'noto-sans-bengali'],
  ar: ['baloo-bhaijaan-2', 'noto-sans-arabic'],
  he: ['rubik', 'heebo'],
};

// Does a CSS unicode-range such as "U+26,U+0-7F,U+4??" cover any of the code points?
function coversAny(range, codePoints) {
  return range.split(',').some((part) => {
    const [from, to = from] = part.trim().slice(2).split('-');
    const low = parseInt(from.replace(/\?/g, '0'), 16);
    const high = parseInt(to.replace(/\?/g, 'f'), 16);
    return codePoints.some((cp) => cp >= low && cp <= high);
  });
}

// Fontsource CSS with the font files inlined: file:// pages can't load fonts by URL.
// Only the subsets that cover `text` are kept: CJK fonts are split into over a hundred.
function fontCss(pkg, text) {
  const dir = path.join(root, 'node_modules', '@fontsource-variable', pkg);
  const codePoints = [...new Set(text)].map((char) => char.codePointAt(0));
  return fs
    .readFileSync(path.join(dir, 'index.css'), 'utf8')
    .split(/(?=@font-face)/)
    .filter((block) => {
      const range = block.match(/unicode-range:([^;]+);/);
      return block.startsWith('@font-face') && (!range || coversAny(range[1], codePoints));
    })
    .join('')
    .replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) =>
      `url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, 'files', file)).toString('base64')})`
    );
}

// Runs in the page: text that outgrew its box, which a long translation easily does.
function layoutProblems() {
  const box = (el) => el.getBoundingClientRect();
  const problems = [];
  const overlaps = (upper, lower) => upper && lower && box(upper).bottom > box(lower).top + 0.5;
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width && r.height).sort((a, b) => a.top - b.top);
    // Glyph boxes of neighbouring lines overlap when the line height is tight, so a line starts below the middle of the previous one.
    let lines = 0;
    let middle = -Infinity;
    for (const r of rects) {
      if (r.top > middle) {
        lines++;
        middle = r.top + r.height / 2;
      }
    }
    return lines;
  };
  for (const panel of document.querySelectorAll('.panel')) {
    if (panel.scrollHeight > panel.clientHeight + 1 || overlaps(panel.querySelector('.comment:last-child'), panel.querySelector('.note'))) {
      problems.push('comments overflow their panel');
    }
  }
  if (overlaps(document.querySelector('.s1 header'), document.querySelector('.s1 .stage'))) problems.push('headline runs into the panels');
  if (overlaps(document.querySelector('.s2 header'), document.querySelector('.steps'))) problems.push('headline runs into the scenes');
  const facts = document.querySelector('.facts');
  for (const caption of facts ? document.querySelectorAll('.step p:last-child') : []) {
    const [c, f] = [box(caption), box(facts)];
    if (c.bottom > f.top && c.left < f.right && c.right > f.left) problems.push('a step caption runs into the facts');
  }
  for (const el of document.querySelectorAll('.state, .panel-head, .facts span, .s2 h1, .s2 .sub')) {
    if (lineCount(el) > 1 || el.scrollWidth > el.clientWidth + 1) problems.push(`"${el.textContent.trim()}" doesn't fit on one line`);
  }
  for (const bubble of document.querySelectorAll('.bubble')) {
    if (box(bubble).bottom > box(bubble.closest('.scene')).bottom) problems.push('a speech bubble is cut off');
  }
  return problems;
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();

  for (const { size, svg } of ICONS) {
    const data = fs.readFileSync(path.join(src, svg)).toString('base64');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
        `<img width="${size}" height="${size}" src="data:image/svg+xml;base64,${data}">`
    );
    await page.evaluate(() => document.querySelector('img').decode());
    const file = path.join(root, 'extension', 'icons', `icon-${size}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await page.screenshot({ omitBackground: true }));
    console.log(path.relative(root, file));
  }
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(root, 'extension', 'icons', 'icon-128.png'), path.join(out, 'icon-128.png'));

  // Languages can be picked on the command line: node scripts/render-store-images.mjs ja ar
  const picked = process.argv.slice(2);
  for (const lang of picked.length ? LANGS.filter((code) => picked.includes(code)) : LANGS) {
    const fonts = [...FONTS, ...(SCRIPT_FONTS[lang] || [])];
    for (const [asset, [width, height]] of Object.entries(ASSETS)) {
      if (!asset.startsWith('screenshot') && !PROMO_LANGS.includes(lang)) continue;
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const url = pathToFileURL(path.join(src, 'graphics.html'));
      url.search = new URLSearchParams({ asset, lang }).toString();
      await page.goto(url.href, { waitUntil: 'load' });
      const text = await page.evaluate(() => document.body.innerText);
      await page.addStyleTag({ content: fonts.map((pkg) => fontCss(pkg, text)).join('') });
      await page.evaluate(async () => {
        await Promise.all([...document.fonts].map((font) => font.load()));
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode()));
      });
      for (const problem of await page.evaluate(layoutProblems)) console.warn(`WARNING ${lang}/${asset}: ${problem}`);
      const file = path.join(out, lang, `${asset}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Capturing beyond the viewport returns a blank image for right-to-left pages; the viewport is the asset anyway.
      const png = withoutAlpha(await page.screenshot({ clip: { x: 0, y: 0, width, height }, captureBeyondViewport: false }));
      const info = pngInfo(png);
      if (info.width !== width || info.height !== height || info.hasAlpha) throw new Error(`${file}: wrong format`);
      fs.writeFileSync(file, png);
      console.log(path.relative(root, file));
    }
  }
} finally {
  await browser.close();
}
