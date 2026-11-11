// Manage private-beta invite codes and check usage.
//
//   SCANNER_URL=https://stockpilot-scanner.<you>.workers.dev  SCANNER_ADMIN_TOKEN=…  node scripts/admin.mjs <command>
//
// Commands:
//   create "<label>" [--days 30] [--daily 20]   Create a code (shown once — send it to the tester)
//   list                                        List codes (labels, limits, expiry, today's scans)
//   revoke <code-id>                            Turn a code off immediately
//   usage                                       Today's scans and this month's spend

const [command, ...args] = process.argv.slice(2);
const base = process.env.SCANNER_URL?.replace(/\/+$/, '');
const token = process.env.SCANNER_ADMIN_TOKEN;

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: SCANNER_URL=… SCANNER_ADMIN_TOKEN=… node scripts/admin.mjs create "<label>" [--days 30] [--daily 20] | list | revoke <id> | usage');
  process.exit(1);
}
if (!base || !token) usage('Set SCANNER_URL and SCANNER_ADMIN_TOKEN.');

const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};

async function call(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Request failed (${res.status}): ${body.error?.message ?? res.statusText}`);
    process.exit(1);
  }
  return body;
}

const date = (ms) => new Date(ms).toISOString().slice(0, 10);

if (command === 'create') {
  const flagValues = new Set(['--days', '--daily'].map((f) => args[args.indexOf(f) + 1]).filter(Boolean));
  const label = args.find((a) => !a.startsWith('--') && !flagValues.has(a));
  if (!label) usage('Give the code a label, e.g. the tester’s name.');
  const c = await call('/admin/codes', { method: 'POST', body: JSON.stringify({ label, days: flag('--days'), dailyLimit: flag('--daily') }) });
  console.log(`\nInvite code for ${c.label}:\n\n    ${c.code}\n`);
  console.log(`Id: ${c.id} · ${c.dailyLimit} scans/day · expires ${date(c.expiresAt)}`);
  console.log(`This is the only time the code is shown. Send it privately. To turn it off: node scripts/admin.mjs revoke ${c.id}`);
} else if (command === 'list') {
  const { codes } = await call('/admin/codes');
  if (!codes.length) console.log('No codes yet.');
  for (const c of codes) {
    const state = c.revokedAt ? 'revoked' : c.expiresAt < Date.now() ? 'expired' : 'active';
    console.log(`${c.id}  ${state.padEnd(7)}  ${String(c.scansToday).padStart(3)}/${c.dailyLimit} today  expires ${date(c.expiresAt)}  ${c.label}`);
  }
} else if (command === 'revoke') {
  if (!args[0]) usage('Give the code id (from the list command).');
  await call(`/admin/codes/${encodeURIComponent(args[0])}/revoke`, { method: 'POST' });
  console.log(`Revoked ${args[0]}.`);
} else if (command === 'usage') {
  const u = await call('/admin/usage');
  const usd = (micros, digits = 4) => `$${(micros / 1e6).toFixed(digits)}`;
  if (u.scanner) {
    console.log(u.scanner.ready ? `Scanner: ready · ${u.scanner.model} · effort ${u.scanner.effort}` : `Scanner: OFF · ${u.scanner.problems.join('; ')}`);
    const p = u.scanner.pricePerMillionTokens;
    if (p) {
      console.log(`Prices used for the budget: $${p.input} / $${p.output} per million input / output tokens (compare with Anthropic's pricing page)`);
      console.log(`Reserved per scan (worst case): ${usd(u.scanner.reservationPerScanMicros)}`);
    }
  }
  console.log(`Today (${u.day} UTC): ${u.scansToday}/${u.dailyGlobalLimit} scans`);
  console.log(`This month (${u.month}): ${usd(u.spentMicros)} spent, ${usd(u.reservedMicros)} in flight, budget ${usd(u.monthlyBudgetMicros, 2)}`);
  if (u.overruns?.count) {
    console.log(
      `WARNING: ${u.overruns.count} scan(s) this month cost more than reserved (${usd(u.overruns.excessMicros)} over in total, most expensive ${usd(u.overruns.maxScanMicros)}). ` +
        'Reservations have been raised automatically. Check the prices in worker/src/config.ts and the Claude Console cost page.',
    );
  }
} else {
  usage(command ? `Unknown command "${command}".` : undefined);
}
