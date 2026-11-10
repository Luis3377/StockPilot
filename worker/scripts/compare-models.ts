// Compares Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 on your own product photos, using exactly
// the prompt, schema, settings and validation the scanner uses in production.
//
// THIS CALLS THE REAL ANTHROPIC API AND COSTS MONEY. Without --confirm-cost it only prints the
// plan and the worst-case cost. See docs/AI_SCANNER.md → "Choosing the model".
//
//   npm run compare-models -- --photos ~/scanner-photos                     (dry run, free)
//   ANTHROPIC_API_KEY=… npm run compare-models -- --photos ~/scanner-photos --confirm-cost
//
// Options:
//   --photos <dir>        folder of .jpg/.jpeg/.png/.webp photos (required)
//   --models a,b,c        any of haiku, sonnet, opus (default: all three)
//   --effort low|medium|high   (default: low, same as the scanner)
//   --labels <file.csv>   optional "file,what it really is" lines, shown next to each photo
//   --out <dir>           where to write results (default: compare-results-<time>)
//   --max-usd <n>         refuse to start if the worst case is above this (default: 5)
//   --confirm-cost        actually call the API

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeImage, createClient, type AiOutcome } from '../src/claude';
import { MAX_IMAGE_BYTES, MODELS, worstCaseMicros, type Effort, type ScanModel } from '../src/config';
import { checkImage, type ImageMediaType } from '../src/image';

const SHORT: Record<string, ScanModel> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
/** The app resizes photos to this before sending them. */
const APP_MAX_SIDE = 1600;

interface Args {
  photos: string;
  models: ScanModel[];
  effort: Effort;
  labels: string | null;
  out: string;
  maxUsd: number;
  confirm: boolean;
}

function usage(message: string): never {
  console.error(`${message}\n\nUsage: npm run compare-models -- --photos <dir> [--models haiku,sonnet,opus] [--effort low] [--labels labels.csv] [--max-usd 5] [--confirm-cost]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) usage(`${name} needs a value.`);
    return v;
  };
  const photos = get('--photos') ?? usage('Missing --photos <dir>.');
  const models = (get('--models') ?? 'haiku,sonnet,opus').split(',').map((m) => {
    const key = m.trim().toLowerCase();
    const id = SHORT[key] ?? (key in MODELS ? (key as ScanModel) : null);
    return id ?? usage(`Unknown model "${m}". Use haiku, sonnet or opus.`);
  });
  const effort = (get('--effort') ?? 'low') as Effort;
  if (!['low', 'medium', 'high'].includes(effort)) usage('--effort must be low, medium or high.');
  const maxUsd = Number(get('--max-usd') ?? 5);
  if (!(maxUsd > 0)) usage('--max-usd must be a positive number.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    photos: resolve(photos),
    models: [...new Set(models)],
    effort,
    labels: get('--labels'),
    out: resolve(get('--out') ?? `compare-results-${stamp}`),
    maxUsd,
    confirm: argv.includes('--confirm-cost'),
  };
}

/** Width and height from the file header (JPEG, PNG, WebP), or null if it can't be read. */
export function imageSize(b: Uint8Array, type: ImageMediaType): { w: number; h: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  if (type === 'image/png') return b.length >= 24 ? { w: (u16be(16) << 16) | u16be(18), h: (u16be(20) << 16) | u16be(22) } : null;
  if (type === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: u16be(i + 7), h: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  const chunk = String.fromCharCode(...b.slice(12, 16));
  if (chunk === 'VP8 ' && b.length >= 30) return { w: ((b[27] << 8) | b[26]) & 0x3fff, h: ((b[29] << 8) | b[28]) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  if (chunk === 'VP8X' && b.length >= 30) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  return null;
}

interface Photo {
  file: string;
  path: string;
  mediaType: ImageMediaType;
  data: string;
  size: { w: number; h: number } | null;
  label: string | null;
}

function loadLabels(file: string | null): Map<string, string> {
  const labels = new Map<string, string>();
  if (!file) return labels;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const comma = line.indexOf(',');
    if (comma > 0) labels.set(line.slice(0, comma).trim(), line.slice(comma + 1).trim().replace(/^"|"$/g, ''));
  }
  return labels;
}

function loadPhotos(dir: string, labels: Map<string, string>): Photo[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) usage(`${dir} isn't a folder.`);
  const photos: Photo[] = [];
  for (const file of readdirSync(dir).sort()) {
    const stat = statSync(join(dir, file));
    if (file.startsWith('.') || !stat.isFile()) continue;
    const looksLikePhoto = /\.(jpe?g|png|webp|heic|heif)$/i.test(file);
    if (stat.size > MAX_IMAGE_BYTES) {
      if (looksLikePhoto) console.warn(`  skip ${file}: ${(stat.size / 1048576).toFixed(1)} MB is over the scanner's 4 MB limit. Resize it to ${APP_MAX_SIDE}px (see docs).`);
      continue;
    }
    const bytes = readFileSync(join(dir, file));
    // The file's contents decide, not its name (macOS `sips` keeps .HEIC names on converted JPEGs).
    const check = checkImage({ image: bytes.toString('base64') });
    if (!check.ok) {
      if (/\.(heic|heif)$/i.test(file)) console.warn(`  skip ${file}: HEIC isn't supported by the API; convert it to JPEG (see docs).`);
      else if (looksLikePhoto) console.warn(`  skip ${file}: ${check.message}`);
      continue;
    }
    photos.push({
      file,
      path: join(dir, file),
      mediaType: check.mediaType,
      data: check.data,
      size: imageSize(bytes, check.mediaType),
      label: labels.get(file) ?? labels.get(basename(file, extname(file))) ?? null,
    });
  }
  return photos;
}

interface Row {
  photo: Photo;
  model: ScanModel;
  ms: number;
  outcome: AiOutcome;
}

const usd = (micros: number) => micros / 1e6;
const money = (micros: number, digits = 4) => `$${usd(micros).toFixed(digits)}`;
const median = (xs: number[]) => percentile(xs, 0.5);
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function summarize(rows: Row[], models: ScanModel[]): string {
  const lines = [
    '| Model | Scans | Identified | Partial | Unrecognized | Errors | Median time | 90th pct time | Avg input tokens | Avg output tokens | Avg cost / scan | Cost per 1,000 scans | Scans per $10 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const model of models) {
    const mine = rows.filter((r) => r.model === model);
    const ok = mine.filter((r): r is Row & { outcome: Extract<AiOutcome, { kind: 'ok' }> } => r.outcome.kind === 'ok');
    const count = (s: string) => ok.filter((r) => r.outcome.result.status === s).length;
    const times = ok.map((r) => r.ms);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    // Per successful scan: failed calls are listed under Errors, not averaged in as free.
    const cost = avg(ok.map((r) => r.outcome.costMicros));
    lines.push(
      `| ${MODELS[model].label} | ${mine.length} | ${count('identified')} | ${count('partial')} | ${count('unrecognized')} | ${mine.length - ok.length} | ${(median(times) / 1000).toFixed(1)} s | ${(percentile(times, 0.9) / 1000).toFixed(1)} s | ${Math.round(avg(ok.map((r) => r.outcome.usage.inputTokens)))} | ${Math.round(avg(ok.map((r) => r.outcome.usage.outputTokens)))} | ${money(cost)} | ${money(cost * 1000, 2)} | ${cost > 0 ? Math.floor(10e6 / cost).toLocaleString('en-US') : '—'} |`,
    );
  }
  return lines.join('\n');
}

function reviewPage(rows: Row[], photos: Photo[], models: ScanModel[], outDir: string, summary: string): string {
  const cards = photos
    .map((p, pi) => {
      const answers = models
        .map((m) => {
          const r = rows.find((x) => x.photo === p && x.model === m);
          if (!r) return `<div class="ans"><h4>${esc(MODELS[m].label)}</h4><p class="muted">not run</p></div>`;
          const o = r.outcome;
          const body =
            o.kind === 'ok'
              ? `<p class="st ${o.result.status}">${esc(o.result.status)} · ${esc(o.result.confidence)} confidence</p>
                 <dl>${[
                   ['Name', o.result.name],
                   ['Brand', o.result.brand],
                   ['Model', o.result.model],
                   ['Category', o.result.category],
                   ['Condition', o.result.condition === 'unknown' ? null : o.result.condition],
                   ['Description', o.result.description],
                   ['Condition notes', o.result.conditionNotes],
                   ['Notes', o.result.notes],
                 ]
                   .filter(([, v]) => v)
                   .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
                   .join('')}</dl>`
              : `<p class="st error">error: ${esc(o.error)} (${esc(o.detail)})</p>`;
          const name = `p${pi}-${m}`;
          return `<div class="ans"><h4>${esc(MODELS[m].label)}</h4>${body}
            <p class="muted">${(r.ms / 1000).toFixed(1)} s · ${o.usage ? `${o.usage.inputTokens} in / ${o.usage.outputTokens} out · ` : ''}${money(o.costMicros)}</p>
            <div class="score" data-model="${esc(m)}" data-photo="${esc(p.file)}">
              ${['right', 'partly', 'wrong'].map((v) => `<label><input type="radio" name="${esc(name)}" value="${v}"> ${v}</label>`).join(' ')}
            </div></div>`;
        })
        .join('');
      return `<section class="photo"><figure><img src="${esc(relative(outDir, p.path).split('\\').join('/'))}" alt="${esc(p.file)}"><figcaption>${esc(p.file)}${p.label ? `<br><strong>Really: ${esc(p.label)}</strong>` : ''}</figcaption></figure><div class="answers">${answers}</div></section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scanner model comparison</title>
<style>
  body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#f6f5f2;color:#1d1d1f}
  h1{font-size:20px;margin:0 0 4px} h4{margin:0 0 4px;font-size:13px}
  table{border-collapse:collapse;background:#fff;margin:8px 0 16px;font-size:13px} td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}
  .photo{display:grid;grid-template-columns:220px 1fr;gap:12px;background:#fff;border:1px solid #e3e1dc;border-radius:12px;padding:12px;margin:12px 0}
  @media (max-width:700px){.photo{grid-template-columns:1fr}}
  figure{margin:0} img{width:100%;border-radius:8px} figcaption{font-size:12px;color:#555;margin-top:4px;word-break:break-all}
  .answers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .ans{border:1px solid #eee;border-radius:8px;padding:8px} dl{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin:4px 0} dt{color:#666} dd{margin:0}
  .muted{color:#777;font-size:12px;margin:4px 0} .st{font-weight:600;margin:0} .identified{color:#1a7f37} .partial{color:#9a6700} .unrecognized,.error{color:#b42318}
  .score label{margin-right:6px;font-size:12px} pre{background:#fff;padding:8px;overflow:auto}
</style></head><body>
<h1>Scanner model comparison</h1>
<p class="muted">Mark each answer right, partly or wrong. Your marks stay in this browser and the tally updates as you go.</p>
<table id="tally"></table>
<details><summary>Speed, tokens and cost</summary><pre>${esc(summary)}</pre></details>
${cards}
<script>
  const KEY = 'scanner-compare:' + ${JSON.stringify(basename(outDir))};
  let marks = {}; try { marks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const models = ${JSON.stringify(models.map((m) => [m, MODELS[m].label]))};
  document.querySelectorAll('.score').forEach((el) => {
    const id = el.dataset.photo + '|' + el.dataset.model;
    el.querySelectorAll('input').forEach((input) => {
      input.checked = marks[id] === input.value;
      input.addEventListener('change', () => { marks[id] = input.value; try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch {} tally(); });
    });
  });
  function tally() {
    const rows = models.map(([id, label]) => {
      const v = Object.entries(marks).filter(([k]) => k.endsWith('|' + id)).map(([, x]) => x);
      const n = (x) => v.filter((y) => y === x).length;
      const scored = v.length, score = scored ? Math.round(((n('right') + n('partly') / 2) / scored) * 100) + '%' : '—';
      return '<tr><td>' + label + '</td><td>' + n('right') + '</td><td>' + n('partly') + '</td><td>' + n('wrong') + '</td><td>' + score + '</td></tr>';
    });
    document.getElementById('tally').innerHTML = '<tr><th>Model</th><th>Right</th><th>Partly</th><th>Wrong</th><th>Accuracy (partly = ½)</th></tr>' + rows.join('');
  }
  tally();
</script>
</body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const photos = loadPhotos(args.photos, loadLabels(args.labels));
  if (!photos.length) usage(`No usable photos in ${args.photos}.`);

  const worst = photos.length * args.models.reduce((sum, m) => sum + worstCaseMicros(m), 0);
  const big = photos.filter((p) => p.size && Math.max(p.size.w, p.size.h) > APP_MAX_SIDE);
  console.log(`\n${photos.length} photos × ${args.models.length} models (${args.models.map((m) => MODELS[m].label).join(', ')}), effort ${args.effort}`);
  console.log(`Worst-case cost: ${money(worst, 2)} (typical is a fraction of this). Limit: $${args.maxUsd.toFixed(2)}.`);
  if (big.length) {
    console.log(`Note: ${big.length} photo(s) are larger than the ${APP_MAX_SIDE}px the app sends, so they cost more here than they would in the app. Resize them for a fair cost comparison.`);
  }
  if (usd(worst) > args.maxUsd) usage(`The worst case is above --max-usd ${args.maxUsd}. Use fewer photos or models, or raise --max-usd.`);
  if (!args.confirm) {
    console.log('\nDry run: nothing was sent. Add --confirm-cost to call the API (this is billed to your Anthropic account).');
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) usage('Set ANTHROPIC_API_KEY for this run (it is not stored anywhere).');

  mkdirSync(args.out, { recursive: true });
  const csvPath = join(args.out, 'results.csv');
  const header = ['file', 'really', 'model', 'status', 'name', 'brand', 'model_number', 'category', 'condition', 'confidence', 'description', 'condition_notes', 'notes', 'error', 'seconds', 'input_tokens', 'output_tokens', 'cost_usd'];
  writeFileSync(csvPath, header.join(',') + '\n');

  const client = createClient(apiKey, process.env.ANTHROPIC_BASE_URL || null);
  const rows: Row[] = [];
  let spent = 0;
  for (const [i, photo] of photos.entries()) {
    // Rotate the order so no model always goes first.
    const order = args.models.map((_, k) => args.models[(k + i) % args.models.length]);
    for (const model of order) {
      const start = performance.now();
      const outcome = await analyzeImage(client, { model, effort: args.effort, mediaType: photo.mediaType, data: photo.data });
      const ms = performance.now() - start;
      rows.push({ photo, model, ms, outcome });
      spent += outcome.costMicros;
      const r = outcome.kind === 'ok' ? outcome.result : null;
      appendFileSync(
        csvPath,
        [
          photo.file,
          photo.label,
          MODELS[model].label,
          r?.status ?? 'error',
          r?.name,
          r?.brand,
          r?.model,
          r?.category,
          r?.condition,
          r?.confidence,
          r?.description,
          r?.conditionNotes,
          r?.notes,
          outcome.kind === 'error' ? `${outcome.error}: ${outcome.detail}` : '',
          (ms / 1000).toFixed(2),
          outcome.usage?.inputTokens ?? '',
          outcome.usage?.outputTokens ?? '',
          usd(outcome.costMicros).toFixed(6),
        ]
          .map(csvCell)
          .join(',') + '\n',
      );
      console.log(`  [${i + 1}/${photos.length}] ${photo.file} · ${MODELS[model].label}: ${r ? `${r.status} "${r.name ?? '—'}"` : `error (${outcome.kind === 'error' ? outcome.error : ''})`} · ${(ms / 1000).toFixed(1)} s · ${money(outcome.costMicros)}`);
    }
  }

  const summary = summarize(rows, args.models);
  writeFileSync(join(args.out, 'summary.md'), `# Scanner model comparison\n\n${photos.length} photos, effort ${args.effort}, ${new Date().toISOString()}\n\n${summary}\n\nTotal spent: ${money(spent, 2)}\n`);
  writeFileSync(join(args.out, 'review.html'), reviewPage(rows, photos, args.models, args.out, summary));
  console.log(`\n${summary}\n\nTotal spent: ${money(spent, 2)}`);
  console.log(`\nResults: ${csvPath}\nOpen ${join(args.out, 'review.html')} in a browser to mark each answer right, partly or wrong.`);
}

// Only run when executed directly (the tests import imageSize).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? '')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
