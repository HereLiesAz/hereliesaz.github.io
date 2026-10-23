#!/usr/bin/env node
// Fails if the colours the Android admin and the web manifests hard-code have
// drifted from src/tokens.css, the single source for the web. Run by
// scripts/verify-repo.mjs (npm run verify).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

const css = read('src/tokens.css');
const token = name => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`--${name} is missing or not a #rrggbb colour in src/tokens.css`);
  return m[1].toLowerCase();
};
const field = token('field');
const ink = token('ink');

const kotlin = read('app/src/main/java/com/hereliesaz/admin/AdminUi.kt');
const kotlinColor = name => {
  const m = kotlin.match(new RegExp(`private val ${name} = Color\\(0xFF([0-9A-Fa-f]{6})\\)`));
  if (!m) throw new Error(`AdminUi.kt: private val ${name} = Color(0xFF......) not found`);
  return `#${m[1].toLowerCase()}`;
};

const problems = [];
const expect = (label, actual, wanted) => {
  if (String(actual).toLowerCase() !== wanted) problems.push(`${label} is ${actual}, tokens.css says ${wanted}`);
};

expect('AdminUi.kt Ink', kotlinColor('Ink'), ink);
expect('AdminUi.kt Void', kotlinColor('Void'), field);

const themes = read('app/src/main/res/values/themes.xml');
for (const item of ['statusBarColor', 'navigationBarColor', 'windowBackground']) {
  const m = themes.match(new RegExp(`name="android:${item}">(#[0-9A-Fa-f]{6})<`));
  if (!m) problems.push(`themes.xml: android:${item} not found`);
  else expect(`themes.xml ${item}`, m[1], field);
}

for (const file of ['public/manifest.json', 'public/admin-manifest.json']) {
  const manifest = JSON.parse(read(file));
  expect(`${file} background_color`, manifest.background_color, field);
  expect(`${file} theme_color`, manifest.theme_color, field);
}

if (problems.length) {
  console.error('Design tokens have drifted:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`tokens in sync (field ${field}, ink ${ink})`);
