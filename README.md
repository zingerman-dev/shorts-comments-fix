# Shorts Comments Fix for YouTube

A Chrome extension that fixes the comments panel of YouTube Shorts on desktop.

## What goes wrong

Open the comments and scroll through Shorts, and every now and then the panel:

- shows the comments of a different short;
- mixes the comments of several shorts;
- gets stuck on an old list.

The mistake also sticks: go back to that short and it shows the wrong comments again until you reload the page.

Less often, after a very fast trackpad scroll, the new short is already playing but the like, dislike and comment buttons are gone, and the panels (comments, description) still belong to the previous short until the next scroll.

And sometimes comments stop loading altogether: the panel spins on every short until you reload the page. It starts when a single comments request fails (YouTube occasionally answers with an error after about 10 seconds).

## Why it happens

Shorts use one comments panel for every short. Comments load through a `/youtubei/v1/browse` request, and YouTube applies the response to whichever panel is open when it arrives. The response is addressed to the shared `targetId: "shorts-engagement-panel-comments-section"` and isn't tied to a short. YouTube also caches loaded comments in the short's data.

If you scroll away while the comments are still loading:

1. the late response lands in the new short's panel and stays in its cache;
2. the new short's loader is reused and never sends its own request: it only fires when it appears on screen, and it is already on screen.

That's why simply dropping late responses doesn't work: the panel would keep loading forever.

The vanishing buttons are a separate bug. When the short changes, YouTube hides the button layer (`opacity: 0`) and hands the redraw to its task scheduler at the lowest priority, which only runs when the page is idle. After a very fast scroll (trackpad momentum carries into the next short and snaps back), the scheduler may never get an idle moment, so the redraw, keeping the panel open and loading comments all wait for the next scroll.

The endless spinner after a failed request comes from the same reused loader. A failed request never replaces it, so it stays on screen for the following shorts and never fires again: no comments are requested at all.

## How the extension fixes it

On `/shorts/` pages the extension wraps `fetch`. When a comments response arrives, it compares the short in the request (its id is embedded in the continuation token) with the short the panel currently belongs to.

- They match: the response passes through untouched.
- They don't: the extension loads the first page of comments for the current short and gives that to YouTube instead of the stale response. The loader finishes normally and the right comments go into the cache.
- The current short is already loading its own comments: the stale response is neutralised.

If anything can't be recognised (say, YouTube changed the format), the response passes through unchanged, so nothing gets worse than YouTube's own behaviour.

For the vanishing buttons, the extension checks the Shorts page once a second. If navigation has finished but the button layer is still hidden or the comments panel belongs to another short, two checks in a row, it runs one idle pass of YouTube's scheduler. That runs exactly the work YouTube itself had queued. If the scheduler can't be recognised, the extension does nothing.

For comments that never start loading, the same once-a-second check looks at the open panel. If it has shown only its first loader for three seconds and nothing has requested that loader's comments in the last 15 seconds, the extension fires the loader the way YouTube does, at most twice per short.

The extension only needs access to `www.youtube.com`. It has no other permissions and sends data nowhere.

## Project layout

```
extension/        the extension itself: the contents of the store ZIP
  _locales/       name and short description in 13 languages
  icons/          16/32/48/128 icons (rendered from store/src)
store/
  listing.md      what goes into the Chrome Web Store form
  descriptions/   full store descriptions in 13 languages
  images/         store icon, screenshots and promo tiles (rendered locally, not in git)
  src/            sources: icon SVGs and the HTML template for the graphics
scripts/          graphics rendering and packaging
tests/            end-to-end check in headless Chrome
PRIVACY.md        privacy policy in 13 languages
```

## Development install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked and select the `extension` folder.
4. Reload any open YouTube tabs.

## Commands

```sh
npm install

npm test               # end-to-end check with the extension
npm run test:baseline  # the same without the extension, to see YouTube's bug
npm run store:images   # icons and store graphics from store/src
npm run pack           # checks, dist/shorts-comments-fix-<version>.zip and the upload folder dist/store-upload/
```

Tests and rendering need Google Chrome; set its path with `CHROME_PATH` if it isn't in the default macOS location. The test can also run against an unpacked ZIP: `node tests/flip-test.mjs --extension=<folder>`.

`tests/flip-test.mjs` opens Shorts, opens the comments and flips back and forth quickly many times. After every step it checks that the panel shows the comments of the current short, recovering the short's id from the tokens in the comment threads' data.

## Publishing to the Chrome Web Store

1. Render the store graphics, then build the ZIP and the upload folder: `npm run store:images && npm run pack`.
2. In the [developer dashboard](https://chrome.google.com/webstore/devconsole), create a new item and upload `dist/store-upload/00-shorts-comments-fix-<version>.zip`.
3. Fill in the tabs following `store/listing.md`. The upload folder holds every file and text the form asks for: shared files start with `00-`, the rest with the language code, and `00-guide.txt` walks through the tabs in Russian.
4. Submit for review.

For a new version, bump `version` in `extension/manifest.json`, rebuild and upload the new ZIP to the same item.

## Debugging

In the console of a YouTube tab run

```js
localStorage.setItem('shorts-comments-fix:debug', '1')
```

and reload the page. Every intervention is logged as `[shorts-comments-fix] …`. To turn it off: `localStorage.removeItem('shorts-comments-fix:debug')`.

The stuck-page repair can be switched off without a reload: `localStorage.setItem('shorts-comments-fix:unstick', '0')`. To switch it back on: `localStorage.removeItem('shorts-comments-fix:unstick')`.

## License

The code is available under the [MIT license](LICENSE).

The name “Shorts Comments Fix” and the icon are not covered by the license: if you publish a fork, please give it its own name and icon.

This project is not affiliated with or endorsed by YouTube or Google. YouTube is a trademark of Google LLC.
