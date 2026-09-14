// End-to-end check: open Shorts with the comments panel, flip back and forth
// quickly, and verify that the panel shows comments of the short on screen.
//
//   npm test               with the extension
//   npm run test:baseline  without it (to see the YouTube bug itself)
//
// Options: --iterations=N  --no-ext  --headful  --extension=<dir> (e.g. the unzipped store package)
// Env: CHROME_PATH (defaults to Google Chrome on macOS)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const arg = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return arg ? (arg.includes('=') ? arg.split('=')[1] : true) : fallback;
};
const ITERATIONS = Number(option('iterations', 30));
const WITH_EXTENSION = !option('no-ext', false);
const EXTENSION_DIR = path.resolve(option('extension', path.join(import.meta.dirname, '../extension')));
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BAD = new Set(['WRONG_VIDEO', 'MIXED', 'WRONG_LOADER', 'EMPTY', 'STUCK_LOADING', 'PANEL_OTHER_SHORT', 'BUTTONS_HIDDEN']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs in the page. Video ids are recovered from continuation tokens: the
// thread data and the "load more" loader both carry the id of their short.
function installChecker() {
  const decode = (s) => {
    try {
      s = decodeURIComponent(s).replace(/-/g, '+').replace(/_/g, '/');
      return atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    } catch {
      return '';
    }
  };
  const videoIdFromToken = (token) => {
    let layer = [decode(token)];
    for (let depth = 0; depth < 3 && layer.length; depth++) {
      for (const bin of layer) {
        const m = bin.match(/[\x0a\x12\x1a\x22\x2a\x32\x3a\x42]\x0b([A-Za-z0-9_-]{11})/);
        if (m) return m[1];
      }
      layer = layer.flatMap((bin) => (bin.match(/[A-Za-z0-9_\-+/%]{24,}={0,2}/g) || []).map(decode)).filter(Boolean);
    }
    return null;
  };
  const videoIdsIn = (data) => {
    const counts = new Map();
    for (const [, token] of (JSON.stringify(data) || '').matchAll(/"token":"([^"]+)"/g)) {
      const id = videoIdFromToken(token);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };

  window.__shortsCommentsState = () => {
    const panel = document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]'
    );
    const contents = panel?.querySelector('ytd-item-section-renderer > #contents');
    const threads = contents ? [...contents.querySelectorAll(':scope > ytd-comment-thread-renderer')] : [];
    const loader = contents?.querySelector(':scope > ytd-continuation-item-renderer');
    return {
      url: location.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || null,
      visible: panel?.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
      panelVideo: videoIdsIn(panel?.data?.header)[0] || null,
      // The header shows a comment count only when the short has comments.
      hasComments: !!panel?.data?.header?.engagementPanelTitleHeaderRenderer?.contextualInfo,
      // YouTube hides the buttons while switching shorts; they must not stay hidden.
      buttonsHidden: document.querySelector('ytd-reel-video-renderer #experiment-overlay')?.style.opacity === '0',
      threads: threads.length,
      threadVideos: [...new Set(threads.flatMap((t) => videoIdsIn(t.data).slice(0, 1)))],
      loader: loader ? (loader.hasAttribute('is-initial-load') ? 'initial' : 'more') : null,
      loaderVideo: loader ? videoIdsIn(loader.data)[0] || null : null,
    };
  };
}

function verdict(s) {
  if (s.buttonsHidden) return 'BUTTONS_HIDDEN';
  if (!s.visible) return 'CLOSED';
  if (s.panelVideo && s.url && s.panelVideo !== s.url) return 'PANEL_OTHER_SHORT';
  if (s.loader === 'initial' && s.threads === 0) return 'STUCK_LOADING';
  if (s.threads === 0) return s.hasComments ? 'EMPTY' : 'NO_COMMENTS';
  if (s.threadVideos.length && !s.threadVideos.includes(s.url)) return 'WRONG_VIDEO';
  if (s.threadVideos.some((v) => v !== s.url)) return 'MIXED';
  if (s.loaderVideo && s.loaderVideo !== s.url) return 'WRONG_LOADER';
  return s.threadVideos.length ? 'OK' : 'UNKNOWN';
}

async function openComments(page) {
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('ytd-reel-video-renderer reel-action-bar-view-model button');
    const button = [...buttons].find((b) => /comment|коммент/i.test(b.getAttribute('aria-label') || ''));
    button?.click();
    return !!button && !button.disabled;
  });
  if (!clicked) return false;
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(() => window.__shortsCommentsState())).threads) return true;
    await sleep(250);
  }
  return false;
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-comments-fix-'));
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: !option('headful', false),
  userDataDir,
  pipe: true,
  enableExtensions: WITH_EXTENSION ? [EXTENSION_DIR] : false,
  defaultViewport: null,
  args: ['--window-size=1500,950', '--mute-audio', '--no-first-run', '--no-default-browser-check'],
});

let exitCode = 0;
try {
  const [page] = await browser.pages();
  const version = (await browser.version()).match(/[\d.]+/)[0];
  await page.setUserAgent({
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
  });
  await page.setViewport({ width: 1500, height: 950 });
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 200)));

  await page.goto('https://www.youtube.com/shorts/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (page.url().includes('consent.')) {
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /accept|принять/i.test(b.textContent))?.click()
    );
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForSelector('ytd-reel-video-renderer reel-action-bar-view-model button', { timeout: 60000 });
  await sleep(2000);
  await page.evaluate(installChecker);
  if (!(await openComments(page))) throw new Error('could not open the comments panel');

  console.log(`${WITH_EXTENSION ? 'With' : 'Without'} the extension, ${ITERATIONS} double flips:\n`);
  const stats = {};
  const gaps = [150, 250, 400, 600, 900];
  for (let i = 1; i <= ITERATIONS; i++) {
    const gap = gaps[Math.floor(Math.random() * gaps.length)];
    const second = Math.random() < 0.5 ? 'ArrowUp' : 'ArrowDown';
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowDown');
    await sleep(gap);
    await page.keyboard.press(second);
    await sleep(2500);

    let state = await page.evaluate(() => window.__shortsCommentsState());
    let result = verdict(state);
    if (BAD.has(result)) {
      await sleep(3000); // give it a chance to settle
      state = await page.evaluate(() => window.__shortsCommentsState());
      result = verdict(state);
    }
    stats[result] = (stats[result] || 0) + 1;
    const others = state.threadVideos.filter((v) => v !== state.url);
    console.log(
      `${String(i).padStart(3)}  ↓ ${String(gap).padStart(3)}ms ${second === 'ArrowUp' ? '↑' : '↓'}  ${result.padEnd(17)} ` +
        `short=${state.url} threads=${state.threads}${others.length ? ` foreign=${others.join(',')}` : ''}`
    );
    if (result === 'CLOSED') await openComments(page); // e.g. a short with comments turned off
  }

  const bad = Object.entries(stats).filter(([name]) => BAD.has(name)).reduce((sum, [, n]) => sum + n, 0);
  console.log(`\n${JSON.stringify(stats)}`);
  console.log(bad ? `${bad} of ${ITERATIONS} checks showed broken comments` : 'comments were correct in every check');
  exitCode = bad ? 1 : 0;
} catch (error) {
  console.error(error);
  exitCode = 2;
} finally {
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
process.exit(exitCode);
