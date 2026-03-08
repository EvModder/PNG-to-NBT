import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = '/Users/Nate/Documents/Codex/PNG-to-NBT';
const WEBSITE = path.join(ROOT, 'website');
const SAMPLE_DIR = path.join(ROOT, 'sample_imgs');
const REPORT_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = path.join(WEBSITE, '.tmp', 'comparison', REPORT_STAMP);
const LOCAL_URL = 'http://127.0.0.1:4173/';
const BASELINE_URL = process.env.BASELINE_URL || 'https://evmodder.net/PNG-to-NBT/';
const BASELINE_NAME = process.env.BASELINE_NAME || (BASELINE_URL.includes('127.0.0.1') || BASELINE_URL.includes('localhost') ? 'baseline-local' : 'live');
const IMAGE_FILTER = process.env.IMAGE_FILTER || '';
const SCENARIO_FILTER = process.env.SCENARIO_FILTER || '';
const MODE_FILTER = process.env.MODE_FILTER || '';

const BASE_SCENARIOS = [
  { name: 'default_fullblock', preset: 'Fullblock' },
  { name: 'carpets', preset: 'Carpets' },
  { name: 'pistonclear', preset: 'PistonClear' },
  { name: 'filler_none', preset: 'Fullblock', filler: 'none' },
  { name: 'filler_glass', preset: 'Fullblock', filler: 'glass' },
  { name: 'support_all', preset: 'Fullblock', support: 'all' },
  { name: 'support_steps', preset: 'Fullblock', support: 'steps' },
  { name: 'support_fragile', preset: 'Fullblock', support: 'fragile' },
  { name: 'support_water', preset: 'Fullblock', filler: 'glass', support: 'water' },
];

const PRO_SEED_XPATH = '//span[normalize-space()="Palette Seed:"]/preceding-sibling::input[@type="checkbox"][1] | //span[normalize-space()="Palette Seed:"]/following-sibling::input[@type="checkbox"][1]';

const extraVariantsForMode = mode => {
  const variants = [{ name: 'base' }];
  if (mode === 'staircase_pro') variants.push({ name: 'seeded', proPaletteSeed: true });
  if (mode === 'suppress_2layer_late_fillers' || mode === 'suppress_2layer_late_pairs') {
    variants.push({ name: 'gap3', layerGap: 3 });
    variants.push({ name: 'gap7', layerGap: 7 });
  }
  return variants;
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const TAG = { Int: 3, String: 8, List: 9, Compound: 10 };

function readU16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readI32(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getInt32(0, false);
}

function readString(bytes, offset) {
  const length = readU16(bytes, offset);
  const start = offset + 2;
  return [new TextDecoder().decode(bytes.subarray(start, start + length)), start + length];
}

function readPayload(tag, bytes, offset) {
  if (tag === TAG.Int) return [readI32(bytes, offset), offset + 4];
  if (tag === TAG.String) return readString(bytes, offset);
  if (tag === TAG.List) {
    const elemType = bytes[offset];
    const count = readI32(bytes, offset + 1);
    let next = offset + 5;
    const items = [];
    for (let i = 0; i < count; ++i) {
      const [value, after] = readPayload(elemType, bytes, next);
      items.push(value);
      next = after;
    }
    return [items, next];
  }
  if (tag === TAG.Compound) {
    const object = {};
    let next = offset;
    while (bytes[next] !== 0) {
      const entryTag = bytes[next++];
      const [name, afterName] = readString(bytes, next);
      const [value, afterValue] = readPayload(entryTag, bytes, afterName);
      object[name] = value;
      next = afterValue;
    }
    return [object, next + 1];
  }
  throw new Error(`Unsupported NBT tag ${tag}`);
}

function canonicalizeNbtBytes(bytes) {
  const decompressed = zlib.gunzipSync(bytes);
  let offset = 1;
  [, offset] = readString(decompressed, offset);
  const [root] = readPayload(TAG.Compound, decompressed, offset);
  const palette = root.palette.map(entry => {
    const props = entry.Properties
      ? `[${Object.entries(entry.Properties).map(([key, value]) => `${key}=${value}`).join(',')}]`
      : '';
    return `${entry.Name}${props}`;
  });
  const size = root.size.join(',');
  const blocks = root.blocks
    .map(block => `${block.pos[0]},${block.pos[1]},${block.pos[2]},${palette[block.state]}`)
    .sort()
    .join('|');
  return new TextEncoder().encode(`${size}|${blocks}`);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function waitForSettled(page, ms = 200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function findSelectIndex(page, predicate) {
  return page.evaluate(predicate);
}

async function getPresetSelect(page) {
  const index = await findSelectIndex(page, () =>
    [...document.querySelectorAll('select')].findIndex(el =>
      [...el.options].some(o => o.textContent?.trim() === 'Fullblock')
      && [...el.options].some(o => o.textContent?.trim() === 'Carpets')
      && [...el.options].some(o => o.textContent?.trim() === 'PistonClear')
    )
  );
  if (index < 0) throw new Error('Preset select not found');
  return page.locator('select').nth(index);
}

async function getBuildModeSelect(page) {
  const index = await findSelectIndex(page, () =>
    [...document.querySelectorAll('select')].findIndex(el =>
      [...el.options].some(o =>
        o.value === 'flat'
        || o.value.startsWith('staircase_')
        || o.value.startsWith('suppress_')
      )
    )
  );
  return index < 0 ? null : page.locator('select').nth(index);
}

async function getSupportSelect(page) {
  const index = await findSelectIndex(page, () =>
    [...document.querySelectorAll('select')].findIndex(el =>
      ['none', 'steps', 'all', 'fragile', 'water'].every(value => [...el.options].some(o => o.value === value))
    )
  );
  if (index < 0) throw new Error('Support select not found');
  return page.locator('select').nth(index);
}

async function setInputValue(locator, value) {
  await locator.click({ clickCount: 3 });
  await locator.fill('');
  await locator.type(String(value), { delay: 10 });
  await locator.blur();
}

async function collectModeOptions(page) {
  const shading = await getBuildModeSelect(page);
  if (!shading) {
    const button = page.getByRole('button', { name: /Generate \.nbt/i });
    return await button.count() ? ['flat'] : [];
  }
  return shading.evaluate(el => [...el.options].filter(o => !o.disabled).map(o => o.value));
}

async function selectByValue(locator, value) {
  const options = await locator.evaluate(el => [...el.options].map(o => ({ value: o.value, disabled: o.disabled })));
  const match = options.find(o => !o.disabled && o.value === value);
  if (!match) return false;
  await locator.selectOption(match.value);
  return true;
}

async function openConfiguredPage(browser, url, imagePath, scenario) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const presetSelect = await getPresetSelect(page);
  await presetSelect.selectOption({ label: scenario.preset });
  await waitForSettled(page);
  await page.setInputFiles('input[type=file]', imagePath);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('select')].some(el =>
        [...el.options].some(o => o.value === 'flat' || o.value.startsWith('staircase_') || o.value.startsWith('suppress_'))
      )
      || [...document.querySelectorAll('button')].some(el => /Generate \.nbt/i.test(el.textContent || '')),
    undefined,
    { timeout: 45000 },
  );
  await waitForSettled(page, 1000);

  const filler = page.locator('input[type=text]').first();
  if (scenario.filler !== undefined && await filler.count()) {
    await setInputValue(filler, scenario.filler);
    await waitForSettled(page);
  }

  if (scenario.support) {
    const support = await getSupportSelect(page);
    await selectByValue(support, scenario.support);
    await waitForSettled(page);
  }

  return { context, page };
}

async function setModeVariant(page, mode, variant) {
  const shading = await getBuildModeSelect(page);
  if (shading) {
    await shading.selectOption(mode);
    await waitForSettled(page);
  } else if (mode !== 'flat') {
    throw new Error(`Build mode select missing for mode ${mode}`);
  }

  const layerGap = page.locator('input[type=number]').first();
  if (variant.layerGap !== undefined && await layerGap.count()) {
    await setInputValue(layerGap, variant.layerGap);
    await waitForSettled(page);
  }

  const proSeed = page.locator(`xpath=${PRO_SEED_XPATH}`);
  if (await proSeed.count()) {
    const wantChecked = variant.proPaletteSeed === true;
    if ((await proSeed.isChecked()) !== wantChecked) {
      await proSeed.click();
      await waitForSettled(page);
    }
  }
}

function normalizeDownload(filename, bytes) {
  if (filename.endsWith('.nbt')) {
    const canonical = canonicalizeNbtBytes(bytes);
    return { kind: 'nbt', bytes: canonical, hash: sha256(canonical) };
  }
  return { kind: 'raw', bytes, hash: sha256(bytes) };
}

async function downloadCurrent(page, reportBase) {
  const button = page.getByRole('button', { name: /Generate \.nbt/i });
  if (!(await button.count()) || !(await button.isVisible())) return { available: false };
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    button.click(),
  ]);
  const failure = await download.failure();
  if (failure) return { available: true, failed: failure };
  const filename = download.suggestedFilename();
  const filePath = await download.path();
  const bytes = await fs.readFile(filePath);
  await fs.writeFile(`${reportBase}-${filename}`, bytes);
  const normalized = normalizeDownload(filename, bytes);
  return { available: true, filename, rawHash: sha256(bytes), ...normalized };
}

function scenarioApplies(name, mode) {
  if (name === 'support_steps' && mode === 'flat') return false;
  return true;
}

async function main() {
  await ensureDir(REPORT_DIR);
  const browser = await chromium.launch({ headless: true });
  const images = (await fs.readdir(SAMPLE_DIR))
    .filter(name => name.toLowerCase().endsWith('.png'))
    .filter(name => !IMAGE_FILTER || name.includes(IMAGE_FILTER))
    .sort((a, b) => a.localeCompare(b));

  const mismatches = [];
  for (const imageName of images) {
    const imagePath = path.join(SAMPLE_DIR, imageName);
    for (const scenario of BASE_SCENARIOS) {
      if (SCENARIO_FILTER && !scenario.name.includes(SCENARIO_FILTER)) continue;
      console.log(`Opening ${imageName} :: ${scenario.name}`);
      const local = await openConfiguredPage(browser, LOCAL_URL, imagePath, scenario);
      const baseline = await openConfiguredPage(browser, BASELINE_URL, imagePath, scenario);
      try {
        console.log(`Comparing ${imageName} :: ${scenario.name}`);
        const [localModes, baselineModes] = await Promise.all([collectModeOptions(local.page), collectModeOptions(baseline.page)]);
        if (JSON.stringify(localModes) !== JSON.stringify(baselineModes)) {
          mismatches.push({ type: 'mode-list', image: imageName, scenario: scenario.name, localModes, baselineModes });
        }
        const sharedModes = localModes.filter(mode => baselineModes.includes(mode));
        for (const mode of sharedModes) {
          if (MODE_FILTER && !mode.includes(MODE_FILTER)) continue;
          if (!scenarioApplies(scenario.name, mode)) continue;
          for (const variant of extraVariantsForMode(mode)) {
            const caseName = `${path.parse(imageName).name}__${scenario.name}__${mode}__${variant.name}`;
            const localBase = path.join(REPORT_DIR, `${caseName}__local`);
            const baselineBase = path.join(REPORT_DIR, `${caseName}__${BASELINE_NAME}`);
            console.log(`  ${mode} :: ${variant.name}`);
            await setModeVariant(local.page, mode, variant);
            await setModeVariant(baseline.page, mode, variant);
            const [localDownload, baselineDownload] = await Promise.all([
              downloadCurrent(local.page, localBase),
              downloadCurrent(baseline.page, baselineBase),
            ]);
            const availabilityKey = d => JSON.stringify({ available: d.available, failed: d.failed || null });
            if (availabilityKey(localDownload) !== availabilityKey(baselineDownload)) {
              mismatches.push({ type: 'availability', image: imageName, scenario: scenario.name, mode, variant: variant.name, local: localDownload, baseline: baselineDownload });
              continue;
            }
            if (!localDownload.available || localDownload.failed || baselineDownload.failed) continue;
            if (localDownload.filename !== baselineDownload.filename || localDownload.hash !== baselineDownload.hash) {
              mismatches.push({
                type: 'download', image: imageName, scenario: scenario.name, mode, variant: variant.name,
                localFilename: localDownload.filename, baselineFilename: baselineDownload.filename,
                localHash: localDownload.hash, baselineHash: baselineDownload.hash,
                localRawHash: localDownload.rawHash, baselineRawHash: baselineDownload.rawHash,
                compareKind: localDownload.kind,
              });
            } else {
              const localArtifact = `${localBase}-${localDownload.filename}`;
              const baselineArtifact = `${baselineBase}-${baselineDownload.filename}`;
              if (await pathExists(localArtifact)) await fs.unlink(localArtifact);
              if (await pathExists(baselineArtifact)) await fs.unlink(baselineArtifact);
            }
          }
        }
      } finally {
        await local.context.close();
        await baseline.context.close();
      }
    }
  }

  const reportPath = path.join(REPORT_DIR, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify({ mismatches }, null, 2));
  console.log(JSON.stringify({ mismatchCount: mismatches.length, reportPath }, null, 2));
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
