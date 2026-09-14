// Checks the extension and its store listing against Chrome Web Store basics and builds what the dashboard asks for:
//   npm run pack  ->  dist/shorts-comments-fix-<version>.zip
//                     dist/store-upload/  (the ZIP, images and texts in one flat folder)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pngInfo } from './png.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extensionDir = path.join(root, 'extension');
const storeDir = path.join(root, 'store');
const distDir = path.join(root, 'dist');
const problems = [];
const check = (ok, message) => ok || problems.push(message);

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(/^\d+(\.\d+){0,3}$/.test(manifest.version), `invalid version "${manifest.version}"`);

// Name and description in every locale (the store shows them per language).
const localesDir = path.join(extensionDir, '_locales');
const locales = fs.existsSync(localesDir) ? fs.readdirSync(localesDir) : [];
check(!manifest.default_locale || locales.includes(manifest.default_locale), 'default_locale has no _locales folder');
for (const locale of locales.length ? locales : [null]) {
  const messages = locale ? JSON.parse(fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8')) : {};
  const resolve = (value) => value.replace(/__MSG_(\w+)__/g, (_, key) => messages[key]?.message ?? `<missing ${key}>`);
  const name = resolve(manifest.name);
  const description = resolve(manifest.description);
  check(!name.includes('<missing') && [...name].length <= 75, `${locale}: name must exist and be at most 75 characters`);
  check(!description.includes('<missing') && [...description].length <= 132, `${locale}: description must exist and be at most 132 characters`);
  console.log(`${locale ?? 'default'}: ${name} — ${description}`);
}

check(manifest.icons?.['128'], 'a 128px icon is required');
for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  const iconPath = path.join(extensionDir, file);
  if (!fs.existsSync(iconPath)) {
    problems.push(`icon ${file} is missing`);
    continue;
  }
  const info = pngInfo(fs.readFileSync(iconPath));
  check(info.width === Number(size) && info.height === Number(size), `icon ${file} is ${info.width}x${info.height}, expected ${size}x${size}`);
}
for (const script of manifest.content_scripts ?? []) {
  for (const file of script.js ?? []) check(fs.existsSync(path.join(extensionDir, file)), `content script ${file} is missing`);
}

// Store listing: a detailed description and two screenshots per locale, one icon and English promo tiles for all.
function checkImage(file, width, height, { alpha = false } = {}) {
  const imagePath = path.join(storeDir, 'images', file);
  if (!fs.existsSync(imagePath)) return problems.push(`store/images/${file} is missing (npm run store:images)`);
  const info = pngInfo(fs.readFileSync(imagePath));
  check(info.width === width && info.height === height && (alpha || !info.hasAlpha), `store/images/${file} must be a ${width}x${height} PNG${alpha ? '' : ' without alpha'}`);
}
checkImage('icon-128.png', 128, 128, { alpha: true });
checkImage('en/promo-small.png', 440, 280);
checkImage('en/promo-marquee.png', 1400, 560);
const descriptions = {};
for (const locale of locales) {
  for (const n of [1, 2]) checkImage(`${locale}/screenshot-${n}.png`, 1280, 800);
  const file = path.join(storeDir, 'descriptions', `${locale}.txt`);
  descriptions[locale] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  check(descriptions[locale] && [...descriptions[locale]].length <= 16000, `store/descriptions/${locale}.txt must exist and be at most 16000 characters`);
}
const listing = fs.readFileSync(path.join(storeDir, 'listing.md'), 'utf8');
const codeBlockAfter = (marker) => listing.slice(Math.max(listing.indexOf(marker), 0)).match(/```\n([\s\S]*?)\n```/)?.[1].trim();
const singlePurpose = codeBlockAfter('**Single purpose:**');
const hostJustification = codeBlockAfter('**Host permission justification**');
const testInstructions = codeBlockAfter('## Test instructions');
check(listing.includes('**Single purpose:**') && listing.includes('**Host permission justification**') && listing.includes('## Test instructions'),
  'store/listing.md must keep its Single purpose, Host permission justification and Test instructions blocks');

if (problems.length) {
  console.error(`\nNot packed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, `shorts-comments-fix-${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-9', zipPath, '.', '-x', '.*', '-x', '*/.*'], { cwd: extensionDir, stdio: 'ignore' });
console.log(`\n${execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' }).trim()}`);

// Upload kit: shared files start with 00- so they come first, the rest start with the language code.
const uploadDir = path.join(distDir, 'store-upload');
fs.rmSync(uploadDir, { recursive: true, force: true });
fs.mkdirSync(uploadDir);
const shared = {
  zip: `00-${path.basename(zipPath)}`,
  icon: '00-store-icon-128.png',
  promoSmall: '00-promo-small-440x280.png',
  promoMarquee: '00-promo-marquee-1400x560.png',
};
fs.copyFileSync(zipPath, path.join(uploadDir, shared.zip));
fs.copyFileSync(path.join(storeDir, 'images', 'icon-128.png'), path.join(uploadDir, shared.icon));
fs.copyFileSync(path.join(storeDir, 'images', 'en', 'promo-small.png'), path.join(uploadDir, shared.promoSmall));
fs.copyFileSync(path.join(storeDir, 'images', 'en', 'promo-marquee.png'), path.join(uploadDir, shared.promoMarquee));
for (const locale of locales) {
  fs.writeFileSync(path.join(uploadDir, `${locale}-description.txt`), `${descriptions[locale]}\n`);
  for (const n of [1, 2]) {
    fs.copyFileSync(path.join(storeDir, 'images', locale, `screenshot-${n}.png`), path.join(uploadDir, `${locale}-screenshot-${n}.png`));
  }
}

// Language names as the Russian dashboard lists them.
const LANGUAGE_NAMES = {
  en: 'английский', ar: 'арабский', bn: 'бенгальский', he: 'иврит', id: 'индонезийский', es: 'испанский',
  zh_CN: 'китайский (упрощённый)', de: 'немецкий', pt_BR: 'португальский (Бразилия)', ru: 'русский',
  fr: 'французский', hi: 'хинди', ja: 'японский',
};
const label = (locale) => `${LANGUAGE_NAMES[locale] ?? locale} – ${locale}`;
// English first, then the dashboard's alphabetical order.
const ordered = [...locales].sort((a, b) => (b === 'en') - (a === 'en') || label(a).localeCompare(label(b), 'ru'));
const rule = '='.repeat(72);
const paste = (text) => ['-'.repeat(72), text, '-'.repeat(72)];
const guide = [
  `ЗАГРУЗКА В CHROME WEB STORE — Shorts Comments Fix ${manifest.version}`,
  'Всё лежит в этой папке: общие файлы начинаются с 00-, остальные — с кода языка.',
  'Текст для вставки — между пунктирными линиями, сами линии не копируйте.',
  'Описание каждого языка есть и отдельным файлом <код>-description.txt: открыть, выделить всё, скопировать.',
  '',
  rule, 'ПАКЕТ', rule,
  `Загрузите ${shared.zip}`,
  '',
  rule, 'ВКЛАДКА «ОПИСАНИЕ» (Store listing)', rule,
  'Название и «Сводные данные» подтягиваются из пакета на каждом языке — их вводить не нужно.',
  '',
  'Для всех языков, один раз:',
  '  Категория: «Функциональность и интерфейс» (Functionality & UI, группа Make Chrome Yours)',
  `  Домашняя страница: ${pkg.homepage}`,
  `  Страница поддержки: ${pkg.bugs}`,
  `  Значок магазина: ${shared.icon}`,
  '  Глобальные скриншоты: en-screenshot-1.png, en-screenshot-2.png',
  `  Маленькое рекламное изображение: ${shared.promoSmall}`,
  `  Очень большое рекламное изображение: ${shared.promoMarquee}`,
  '',
  'По языкам (язык выбирается вверху формы):',
  ...ordered.map((locale, i) => `  ${String(i + 1).padStart(2)}. ${label(locale)}: ${locale}-description.txt, ${
    locale === 'en'
      ? 'скриншоты уже в глобальных (если форма потребует локализованные, загрузите туда те же два)'
      : `в «Локализованные скриншоты» — ${locale}-screenshot-1.png и ${locale}-screenshot-2.png`
  }`),
  '',
  ...ordered.flatMap((locale, i) => [rule, `${i + 1}. ${label(locale)} — описание`, rule, ...paste(descriptions[locale]), '']),
  rule, 'ВКЛАДКА «КОНФИДЕНЦИАЛЬНОСТЬ» (Privacy)', rule,
  'Единственное назначение (Single purpose):', ...paste(singlePurpose), '',
  'Обоснование доступа к хосту (Host permission justification):', ...paste(hostJustification), '',
  'Удалённый код: нет, не используется.',
  'Передача данных: отметьте только «Содержимое сайтов» и «Действия пользователей». Расширение читает ответы YouTube с комментариями',
  'и следит за запросами страницы, только внутри неё, а магазин требует раскрывать и такую локальную обработку.',
  'Подтверждения: поставьте все три галочки.',
  `Политика конфиденциальности: ${pkg.homepage}/blob/main/PRIVACY.md`,
  '',
  rule, 'ВКЛАДКА «ИНСТРУКЦИИ ДЛЯ ТЕСТИРОВАНИЯ» (Test instructions)', rule,
  ...paste(testInstructions), '',
  rule, 'ВКЛАДКА «РАСПРОСТРАНЕНИЕ» (Distribution)', rule,
  'Бесплатно, общедоступно (Public), все регионы.',
  '',
];
fs.writeFileSync(path.join(uploadDir, '00-guide.txt'), guide.join('\n'));

console.log(`\nReady to upload: ${path.relative(root, zipPath)}`);
console.log(`Upload kit: ${path.relative(root, uploadDir)}/ (${fs.readdirSync(uploadDir).length} files, start with 00-guide.txt)`);
