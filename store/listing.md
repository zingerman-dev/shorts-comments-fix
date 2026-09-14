# Chrome Web Store listing

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) when publishing. The name and short description come from the extension itself (`extension/_locales`), per language.

Upload: `dist/shorts-comments-fix-<version>.zip` (build with `npm run pack`). The same command collects everything for the form into `dist/store-upload/`: shared files start with `00-`, the rest with the locale code, and `00-guide.txt` walks through the tabs.

## Store listing

**Languages:** English is the default. The extension package already carries the name and short description for all 13 languages (`extension/_locales`); in the dashboard add each language and paste its detailed description.

| Dashboard language | Locale | Detailed description |
|---|---|---|
| English | `en` | `store/descriptions/en.txt` |
| Русский | `ru` | `store/descriptions/ru.txt` |
| 中文（简体） | `zh_CN` | `store/descriptions/zh_CN.txt` |
| हिन्दी | `hi` | `store/descriptions/hi.txt` |
| Español | `es` | `store/descriptions/es.txt` |
| العربية | `ar` | `store/descriptions/ar.txt` |
| Français | `fr` | `store/descriptions/fr.txt` |
| বাংলা | `bn` | `store/descriptions/bn.txt` |
| Português (Brasil) | `pt_BR` | `store/descriptions/pt_BR.txt` |
| Bahasa Indonesia | `id` | `store/descriptions/id.txt` |
| Deutsch | `de` | `store/descriptions/de.txt` |
| 日本語 | `ja` | `store/descriptions/ja.txt` |
| עברית | `he` | `store/descriptions/he.txt` |

**Category:** Make Chrome Yours → Functionality & UI

**Homepage URL:** https://github.com/zingerman-dev/shorts-comments-fix
**Support URL:** https://github.com/zingerman-dev/shorts-comments-fix/issues

**Store icon:** `store/images/icon-128.png`

**Screenshots (1280×800):** every language has its own pair in `store/images/<locale>/`.
- Global screenshots: `store/images/en/screenshot-1.png`, `store/images/en/screenshot-2.png`. Everyone sees them, including languages the listing doesn't cover.
- Localized screenshots: select each of the other 12 languages at the top of the tab and drop its `screenshot-1.png` and `screenshot-2.png` into **Localized screenshots**. The store shows a language's localized screenshots first, then the global ones.

**Promo tiles** can't be localized: one set is shown for every language, so upload the English ones.
- Small promo tile (440×280): `store/images/en/promo-small.png`
- Marquee promo tile (1400×560, optional): `store/images/en/promo-marquee.png`

## Privacy practices

**Single purpose:**

```
Keeps the comments panel and the action buttons of YouTube Shorts on desktop in sync with the short currently on screen.
```

**Host permission justification** (content script on `https://www.youtube.com/*`):

```
The extension has to run on www.youtube.com to see YouTube's own comment requests on Shorts pages, replace responses that belong to a short the user has already scrolled past, and notice when a Shorts page stops updating after a fast scroll. It does not run on any other site.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** tick **Website content** and **User activity**, nothing else. The extension reads YouTube's comment responses and watches the page's comment requests, only inside the page, and the store asks to disclose data handled locally too. Tick all three certifications (no selling or transferring data, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** https://github.com/zingerman-dev/shorts-comments-fix/blob/main/PRIVACY.md

## Test instructions for the reviewer

```
1. Open https://www.youtube.com/shorts in desktop Chrome and open the comments panel of a short.
2. Press the Down arrow and then quickly the Up arrow (or scroll quickly) several times.
3. Without the extension the panel can end up showing comments of another short. With the extension the comments match the short on screen.

To see the extension act, run localStorage.setItem('shorts-comments-fix:debug', '1') in the DevTools console of the YouTube tab and reload. Every correction is logged with the prefix [shorts-comments-fix].
```

## Distribution

Free, public, all regions.
