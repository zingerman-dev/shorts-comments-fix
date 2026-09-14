// Shorts Comments Fix
//
// Desktop Shorts reuse a single comments panel for every short. Comments are
// loaded through /youtubei/v1/browse, and the response is applied to whatever
// the panel is showing when it arrives (it is addressed by the shared targetId
// "shorts-engagement-panel-comments-section"). YouTube also caches the loaded
// comments inside each short's data, so a mistake sticks to that short.
//
// Scroll to the next short while comments are still loading and:
//   - the old response lands in the new short: wrong or mixed comments;
//   - the new short's loader is reused and never sends its own request, so
//     simply dropping the old response leaves an endless spinner.
//
// So when a comments response arrives for a short the panel is no longer on,
// we fetch the first page of comments for the current short and hand that to
// YouTube instead. Anything we cannot recognise is passed through untouched.
//
// A second, rarer problem shows up with very fast flips (a trackpad fling that
// crosses into the next short and snaps back): the new short plays, but its
// buttons stay invisible and the panels keep the previous short until the next
// flip. See "Stuck Shorts page" below.
//
// And when a comments request fails, the panel's loader never fires again for
// the following shorts. See "Comments that never start loading" below.
(() => {
  'use strict';

  const COMMENTS_TARGET_ID = 'shorts-engagement-panel-comments-section';
  // Inside Shorts only: a watch page opened earlier in the same tab leaves its
  // own hidden comments panel (for another video) in the document.
  const PANEL_SELECTOR =
    'ytd-shorts ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]';
  const MAX_RELOADS = 5;

  let debug = false;
  try {
    debug = localStorage.getItem('shorts-comments-fix:debug') === '1';
  } catch {}
  const log = (...args) => {
    if (debug) console.log('[shorts-comments-fix]', ...args);
  };

  // Continuation tokens are base64 protobuf with another base64 protobuf nested
  // inside. The video id is an 11-character string field.
  const VIDEO_ID_FIELD = /[\x0a\x12\x1a\x22\x2a\x32\x3a\x42]\x0b([A-Za-z0-9_-]{11})/;
  const NESTED_BASE64 = /[A-Za-z0-9_\-+/%]{24,}={0,2}/g;

  function base64ToBinary(value) {
    try {
      const s = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/');
      return atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    } catch {
      return '';
    }
  }

  function videoIdFromToken(token) {
    let layer = [base64ToBinary(token)];
    for (let depth = 0; depth < 3 && layer.length; depth++) {
      for (const binary of layer) {
        const match = binary.match(VIDEO_ID_FIELD);
        if (match) return match[1];
      }
      layer = layer.flatMap((binary) => (binary.match(NESTED_BASE64) || []).map(base64ToBinary)).filter(Boolean);
    }
    return null;
  }

  // The sort menu in the panel header holds a token per sort order; each one
  // loads the first page of comments. Prefer the selected order.
  function firstPageToken(header) {
    let fallback = null;
    const walk = (node, selected) => {
      if (!node || typeof node !== 'object') return null;
      if (typeof node.selected === 'boolean') selected = node.selected;
      const token = node.continuationCommand?.token;
      if (typeof token === 'string') {
        if (selected) return token;
        fallback ??= token;
      }
      for (const value of Object.values(node)) {
        const found = walk(value, selected);
        if (found) return found;
      }
      return null;
    };
    return walk(header, false) || fallback;
  }

  // The short the comments panel is set up for. The header comes from the
  // short's data and, unlike the comment list, is never overwritten.
  function currentPanel() {
    const panels = [...document.querySelectorAll(PANEL_SELECTOR)];
    const panel = panels.find((p) => p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') || panels[0];
    const token = firstPageToken(panel?.data?.header);
    const urlVideoId = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/)?.[1] || null;
    return { token, videoId: (token && videoIdFromToken(token)) || urlVideoId };
  }

  // Continuation token -> time it was last requested.
  const requestedAt = new Map();

  function noteRequest(token, time = performance.now()) {
    if (requestedAt.size > 200) {
      for (const [key, at] of requestedAt) if (time - at > 300000) requestedAt.delete(key);
    }
    requestedAt.set(token, time);
    return time;
  }

  async function readRequestJson(request) {
    try {
      let bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      const json = JSON.parse(new TextDecoder().decode(bytes));
      return typeof json?.continuation === 'string' ? json : null;
    } catch {
      return null;
    }
  }

  const targetsComments = (entry) =>
    !!entry && Object.values(entry).some((command) => command?.targetId === COMMENTS_TARGET_ID);

  // Keep the response well-formed (so the loader that asked for it finishes
  // normally) but address its commands to nothing.
  function neutralize(body) {
    try {
      const json = JSON.parse(body);
      for (const key of ['onResponseReceivedEndpoints', 'onResponseReceivedActions']) {
        for (const entry of Array.isArray(json[key]) ? json[key] : []) {
          if (!targetsComments(entry)) continue;
          for (const command of Object.values(entry)) {
            if (command?.targetId === COMMENTS_TARGET_ID) command.targetId = 'shorts-comments-fix-discarded';
          }
        }
      }
      return JSON.stringify(json);
    } catch {
      return body;
    }
  }

  // Whenever we are unsure, we return the body untouched: never worse than stock YouTube.
  async function forCurrentShort(body, requestJson, template, sentAt, reloads) {
    if (!requestJson || !body.includes(COMMENTS_TARGET_ID)) return body;
    const requestedVideoId = videoIdFromToken(requestJson.continuation);
    const panel = currentPanel();
    if (!requestedVideoId || !panel.videoId || requestedVideoId === panel.videoId) return body;

    if ((requestedAt.get(panel.token) ?? -Infinity) > sentAt) {
      log(`dropping late comments of ${requestedVideoId}: ${panel.videoId} is loading its own`);
      return neutralize(body);
    }
    if (!panel.token || reloads >= MAX_RELOADS) return body;

    log(`late comments of ${requestedVideoId}, loading ${panel.videoId} instead`);
    const json = { ...requestJson, continuation: panel.token };
    const reloadSentAt = noteRequest(panel.token);
    try {
      const headers = new Headers(template.headers);
      headers.delete('content-encoding');
      const response = await nativeFetch(new Request(template, { headers, body: JSON.stringify(json), signal: null }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return forCurrentShort(await response.text(), json, template, reloadSentAt, reloads + 1);
    } catch (error) {
      log(`loading ${panel.videoId} failed:`, error);
      return body;
    }
  }

  // YouTube reads the body with text(). Clones share the result, since other
  // extensions that wrap fetch (ad blockers) often read a clone instead.
  function guardResponse(response, template, requestJson, sentAt, shared = { body: null }) {
    if (!response.ok) return response;
    const nativeText = response.text;
    const nativeClone = response.clone;
    const text = () =>
      (shared.body ??= Promise.all([nativeText.call(response), requestJson]).then(([body, json]) =>
        forCurrentShort(body, json, template, sentAt, 0).catch(() => body)
      ));
    const clone = () => guardResponse(nativeClone.call(response), template, requestJson, sentAt, shared);
    Object.defineProperties(response, {
      text: { value: text, configurable: true, writable: true },
      json: { value: () => text().then(JSON.parse), configurable: true, writable: true },
      clone: { value: clone, configurable: true, writable: true },
    });
    return response;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function fetch(input, init) {
    let request, copy;
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (!location.pathname.startsWith('/shorts/') || !url.includes('/youtubei/v1/browse') ||
          init?.body instanceof ReadableStream) {
        return nativeFetch(input, init);
      }
      request = input instanceof Request && init === undefined ? input : new Request(input, init);
      copy = request.clone();
    } catch {
      return nativeFetch(input, init);
    }
    const sentAt = performance.now();
    const requestJson = readRequestJson(copy).then((json) => {
      if (json) noteRequest(json.continuation, sentAt);
      return json;
    });
    return nativeFetch(request).then((response) => guardResponse(response, request, requestJson, sentAt));
  };

  // ---- Stuck Shorts page ----------------------------------------------------
  // YouTube's job scheduler runs its lowest-priority jobs only when the browser is
  // idle, and after a very fast flip it can keep finding other work for good. The
  // new short's re-render, "keep the comments panel open" and comment loading all
  // wait there, so the buttons stay transparent (opacity 0) and the panels show
  // the previous short until the next flip. Once the page has settled in that
  // state we run one idle pass of YouTube's own scheduler: it does exactly the
  // work YouTube had queued, nothing else.

  let navigating = false;
  let navigationStartedAt = 0;
  document.addEventListener('yt-navigate-start', () => {
    navigating = true;
    navigationStartedAt = performance.now();
  });
  document.addEventListener('yt-navigate-finish', () => {
    navigating = false;
  });

  function isStuck() {
    const shorts = document.querySelector('ytd-shorts');
    const reel = shorts?.querySelector('ytd-reel-video-renderer');
    if (!reel || !shorts.data || shorts.index !== shorts.currentPlayerIndex) return false;
    if (navigating && performance.now() - navigationStartedAt < 5000) return false;
    const overlayHidden = reel.querySelector('#experiment-overlay')?.style.opacity === '0';
    const { token } = currentPanel();
    const panelVideoId = token && videoIdFromToken(token);
    const urlVideoId = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
    return overlayHidden || !!(panelVideoId && urlVideoId && panelVideoId !== urlVideoId);
  }

  // The idle pass is the scheduler's only method that reads deadline.timeRemaining().
  function runSchedulerIdlePass() {
    const scheduler = window.ytglobal?.schedulerInstanceInstance_;
    const proto = scheduler && Object.getPrototypeOf(scheduler);
    if (!proto) return false;
    const passes = Object.getOwnPropertyNames(proto)
      .map((name) => Object.getOwnPropertyDescriptor(proto, name).value)
      .filter((fn) => typeof fn === 'function' && /\.timeRemaining\(\)/.test(Function.prototype.toString.call(fn)));
    if (passes.length !== 1) return false;
    const deadline = { didTimeout: true, timeRemaining: () => 30 };
    for (let i = 0; i < 5; i++) passes[0].call(scheduler, deadline);
    return true;
  }

  const unstickDisabled = () => {
    try {
      return localStorage.getItem('shorts-comments-fix:unstick') === '0';
    } catch {
      return false;
    }
  };

  // ---- Comments that never start loading -------------------------------------
  // The open panel's first loader fires only when it appears on screen. When a
  // comments request fails (YouTube sometimes answers with an error after ~10 s),
  // that loader stays on screen for the next shorts and never fires again, so
  // their comments never load. If it sits there for a few seconds with no
  // request for its token, we fire it the way YouTube does.

  const FIRST_LOADER_SELECTOR =
    `${PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ` +
    'ytd-item-section-renderer #contents > ytd-continuation-item-renderer[is-initial-load]';
  const firedLoaders = new Map(); // token -> times fired
  let waitingLoader = { token: null, checks: 0 };

  function fireStalledLoader() {
    const loader = document.querySelector(FIRST_LOADER_SELECTOR);
    const token = loader?.data?.continuationEndpoint?.continuationCommand?.token;
    // A request for this token in the last 15 s may still be on its way.
    const stalled = typeof token === 'string' && performance.now() - (requestedAt.get(token) ?? -Infinity) > 15000;
    waitingLoader = stalled
      ? { token, checks: waitingLoader.token === token ? waitingLoader.checks + 1 : 1 }
      : { token: null, checks: 0 };
    const fired = firedLoaders.get(token) ?? 0;
    if (!stalled || waitingLoader.checks < 3 || fired >= 2 || typeof loader.triggerContinuation !== 'function') return;
    if (firedLoaders.size > 500) firedLoaders.clear();
    firedLoaders.set(token, fired + 1);
    waitingLoader = { token: null, checks: 0 };
    log('comments never started loading: fired the loader');
    loader.triggerContinuation();
  }

  let stuckChecks = 0;
  setInterval(() => {
    if (!location.pathname.startsWith('/shorts/')) return;
    try {
      fireStalledLoader();
    } catch (error) {
      log('checking the comments loader failed:', error);
    }
    if (unstickDisabled()) return;
    try {
      stuckChecks = isStuck() ? stuckChecks + 1 : 0;
      if (stuckChecks < 2) return;
      stuckChecks = -2; // let the repair settle before checking again
      log(runSchedulerIdlePass()
        ? 'page got stuck after a fast flip: ran the work YouTube had queued'
        : 'page got stuck after a fast flip, but the scheduler was not recognised');
    } catch (error) {
      log('checking for a stuck page failed:', error);
    }
  }, 1000);
})();
