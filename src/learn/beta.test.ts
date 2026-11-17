// Beta-readiness regression tests for the Learning Center: the financial lessons' explanations
// must match the figures the pages show (N3, N4), and the remaining fixes from the QA retest.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../data/store';
import { MemoryStorage } from '../data/storage';
import { addItem, recordSale } from '../domain/actions';
import { createBidPlan, defaultAssumptions, lotPrefillFromPlan, recordBidPurchase } from '../domain/bids';
import { defaultSettings, emptyData, type AppData, type Settings } from '../domain/types';
import { lotPerformance } from '../insights/performance';
import { monthLabel, monthOf, rollForward } from '../insights/monthly';
import { signedMoney, signedPct } from '../pages/performance/parts';
import { defaultMonth } from '../pages/close/parts';
import { formatMoney, toCents } from '../domain/money';
import { MODE_PATHS, lessonById, nextUnfinished, pathFor, practiceMonth, practicePerformance, resumeCandidate, stepsFor } from './lessons';
import { completeLesson, defaultTutorial, pauseLesson, sanitizeTutorial, startLesson, type TutorialProgress } from './progress';
import { HELP_TOPICS } from './help';
import { DomainError } from '../domain/errors';
import type { LessonEnv, LessonStep, StaticEnv } from './types';

const settings: Settings = { ...defaultSettings(), onboarded: true, mode: 'reseller' };
const envFor = (data: AppData, path = '/'): LessonEnv => ({
  data,
  settings,
  path,
  scannerEnabled: false,
  baseline: { items: 0, sales: 0, lots: 0, bidPlans: 0 },
  has: () => false,
  text: () => '',
});
const say = (step: LessonStep, e: LessonEnv) => (typeof step.body === 'function' ? step.body(e) : step.body);
const stepOf = (lesson: string, id: string) => lessonById(lesson)!.steps.find((s) => s.id === id)!;
const money = (n: number) => formatMoney(n, settings.currency);

/** Runs a lesson's practice setup the way the app does: through the store, so the inventory ledger records it. */
async function practiceRecords(lessonId: string): Promise<AppData> {
  const s = new AppStore();
  await s.init(new MemoryStorage());
  s.updateSettings({ onboarded: true, mode: 'reseller' });
  await s.enterPractice(true);
  s.update(lessonById(lessonId)!.setup!);
  await s.flush();
  return s.getState().data;
}

/** A planned pallet with chosen purchase price and sale prices (for "behind plan" cases). */
async function plannedLot(paid: number, radioPrice: number, speakerPrice: number): Promise<AppData> {
  const s = new AppStore();
  await s.init(new MemoryStorage());
  await s.enterPractice(true);
  s.update((data) => {
    const today = '2026-11-16';
    const a = {
      ...defaultAssumptions(),
      valueMode: 'items' as const,
      targetRoiPct: 50,
      items: [
        { id: 'r', name: 'Radio', quantity: 2, unitValue: 60, category: '', condition: '', notes: '', aiFields: [] },
        { id: 's', name: 'Speaker', quantity: 2, unitValue: 40, category: '', condition: '', notes: '', aiFields: [] },
      ],
    };
    const p = createBidPlan(data, { name: 'Pallet', description: '', kind: 'pallet', assumptions: a });
    const { input, lineBidItemIds } = lotPrefillFromPlan(p.plan, paid, today);
    const bought = recordBidPurchase(p.data, p.plan.id, input, lineBidItemIds);
    let d = bought.data;
    d = recordSale(d, { itemId: bought.items[0].id, quantity: 2, salePrice: radioPrice, priceMode: 'per_unit', fees: 9, saleDate: today }).data;
    return recordSale(d, { itemId: bought.items[1].id, quantity: 1, salePrice: speakerPrice, priceMode: 'per_unit', fees: 4, saleDate: today }).data;
  });
  await s.flush();
  return s.getState().data;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('N3 — Predicted vs. actual: the explanation matches the page', () => {
  it('quotes the page’s own figures: profit earned so far, predicted, projected final, and the difference', async () => {
    const data = await practiceRecords('predicted-actual');
    const e = envFor(data, '/inventory/lots/x/performance');
    const perf = lotPerformance(data, settings, data.lots[0], { scenario: 'expected', skipWarnings: true });
    expect(perf.final).toBe(false);
    const profit = perf.rows.find((r) => r.key === 'profit')!;
    const net = perf.rows.find((r) => r.key === 'net')!;
    const a = perf.actual;

    const earned = say(stepOf('predicted-actual', 'earned'), e);
    expect(earned).toContain(`revenue ${money(a.revenue)}`);
    expect(earned).toContain(`= ${money(a.realizedProfit)} realized profit`);
    expect(toCents(a.revenue) - toCents(a.costOfGoods) - toCents(a.sellingExpenses)).toBe(toCents(a.realizedProfit));

    const prediction = say(stepOf('predicted-actual', 'prediction'), e);
    expect(prediction).toContain(`predicted ${money(profit.predicted!)} profit`);
    expect(prediction).toContain(`projected final profit is ${money(profit.projected!)}`);
    // The same signed difference and percentage the Difference column shows.
    expect(prediction).toContain(signedMoney(profit.difference!, settings.currency));
    expect(prediction).toContain(`(${signedPct(profit.errorPct)})`);
    // The direction matches the sign — this lot is ahead of plan (it was bought below the planned price).
    expect(profit.difference!).toBeGreaterThan(0);
    expect(prediction).toContain('ahead of the prediction');
    expect(prediction).not.toMatch(/behind/);

    // The reasons add up exactly to the difference: what you paid + net proceeds.
    const why = say(stepOf('predicted-actual', 'why'), e);
    const saved = perf.prediction!.acquisitionCost! - a.acquisitionCost;
    expect(toCents(saved) + toCents(net.difference!)).toBe(toCents(profit.difference!));
    expect(why).toContain(signedMoney(saved, settings.currency));
    expect(why).toContain(signedMoney(net.difference!, settings.currency));
    expect(why).toContain(`the ${signedMoney(profit.difference!, settings.currency)} difference in profit`);
    // Sold units went for less than estimated — said as such, without calling the whole lot behind.
    expect(why).toContain('those items sold for less than you estimated');
  });

  it('says "behind" when the projection really is behind the prediction', async () => {
    const data = await plannedLot(150, 10, 8);
    const e = envFor(data);
    const profit = lotPerformance(data, settings, data.lots[0], { skipWarnings: true }).rows.find((r) => r.key === 'profit')!;
    expect(profit.difference!).toBeLessThan(0);
    const text = say(stepOf('predicted-actual', 'prediction'), e);
    expect(text).toContain('behind the prediction');
    expect(text).toContain(signedMoney(profit.difference!, settings.currency));
    expect(text).not.toMatch(/ahead of/);
  });

  it('follows the scenario selected on the page', async () => {
    const data = await practiceRecords('predicted-actual');
    const e = { ...envFor(data), text: (sel: string) => (sel.includes('Compare with scenario') ? 'Conservative' : '') };
    expect(practicePerformance(e)!.scenario).toBe('conservative');
    const conservative = lotPerformance(data, settings, data.lots[0], { scenario: 'conservative', skipWarnings: true }).rows.find((r) => r.key === 'profit')!;
    expect(say(stepOf('predicted-actual', 'prediction'), e)).toContain(`the conservative scenario predicted ${money(conservative.predicted!)}`);
  });

  it('uses no fixed "behind the forecast" claim any more', () => {
    for (const s of lessonById('predicted-actual')!.steps) {
      if (typeof s.body === 'string') expect(s.body).not.toMatch(/behind the forecast|revenue and profit are behind/);
    }
  });
});

describe('N4 — Monthly Close opens the practice records’ month', () => {
  for (const today of ['2026-11-16', '2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01', '2028-02-29']) {
    it(`on ${today}: the lesson opens ${today.slice(0, 7)} and the worked example matches the page`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${today}T12:00:00`));
      const data = await practiceRecords('monthly-close');
      const month = practiceMonth(data, today);
      expect(month).toBe(monthOf(today));
      const e = envFor(data);
      const step = stepOf('monthly-close', 'rollforward');
      expect(typeof step.route === 'function' ? step.route(e) : step.route).toBe(`/sales/close?month=${month}`);
      // The page's default would have been the last finished month: the old bug.
      expect(defaultMonth(data, today)).not.toBe(month);
      const rf = rollForward(data, settings, month, today);
      expect(rf.status).toBe('verified');
      expect(rf.beginning).toBe(0);
      expect(rf.expectedEnding).toBe(16);
      expect(rf.recordsEnding).toBe(16);
      const text = say(step, e);
      expect(text).toContain(
        `For ${monthLabel(month)}: $0.00 at the start, items bought +$24.00, cost of goods sold −$8.00 = $16.00 expected, and your item records show $16.00. They match, so it’s verified.`,
      );
    });
  }

  it('picks the month of the latest practice record, ignoring future-dated ones', () => {
    let d = addItem(emptyData(), { name: 'A', quantity: 1, unitCost: 1, purchaseDate: '2026-10-31' }).data;
    expect(practiceMonth(d, '2026-11-02')).toBe('2026-10');
    d = recordSale(d, { itemId: d.items[0].id, quantity: 1, salePrice: 5, priceMode: 'per_unit', saleDate: '2026-11-01' }).data;
    expect(practiceMonth(d, '2026-11-02')).toBe('2026-11');
    expect(practiceMonth(emptyData(), '2027-01-01')).toBe('2027-01');
    const future = addItem(emptyData(), { name: 'B', quantity: 1, unitCost: 1, purchaseDate: '2026-12-05' }).data;
    expect(practiceMonth(future, '2026-11-20')).toBe('2026-11');
  });
});

const staticEnv = (mode: Settings['mode'], extra: Partial<Settings> = {}): StaticEnv => ({ settings: { ...defaultSettings(), mode, ...extra }, scannerEnabled: false });
const base0 = { items: 0, sales: 0, lots: 0, bidPlans: 0 };
const paused = (p: TutorialProgress, id: string, at: string) => pauseLesson(startLesson(p, id, base0, 2), at);

describe('N2 — Resume only offers a lesson that can run here, the most recently paused', () => {
  it('never offers a lesson the mode can’t run (collector without sales tracking)', () => {
    let p = paused(defaultTutorial(true), 'practice-record-sale', '2026-11-16T10:00:00Z');
    expect(resumeCandidate(staticEnv('collector'), p)).toBeUndefined();
    // With sales tracking on, it can run, but it isn't a collector lesson… unless it's made for the mode.
    expect(resumeCandidate(staticEnv('business'), p)?.id).toBe('practice-record-sale');
    p = paused(p, 'collector-add', '2026-11-16T09:00:00Z');
    expect(resumeCandidate(staticEnv('collector'), p)?.id).toBe('collector-add');
  });

  it('picks the most recently paused eligible lesson', () => {
    let p = paused(defaultTutorial(true), 'inventory-levels', '2026-11-16T08:00:00Z');
    p = paused(p, 'backup', '2026-11-16T12:00:00Z');
    p = paused(p, 'monthly-close', '2026-11-16T10:00:00Z');
    expect(resumeCandidate(staticEnv('business'), p)?.id).toBe('backup');
    // A lesson made only for another mode isn't offered here.
    p = paused(p, 'max-bid', '2026-11-16T13:00:00Z');
    expect(resumeCandidate(staticEnv('business'), p)?.id).toBe('backup');
    expect(resumeCandidate(staticEnv('reseller'), p)?.id).toBe('max-bid');
  });

  it('keeps pause times through saving, and drops them when a lesson is finished or skipped', () => {
    let p = paused(defaultTutorial(true), 'backup', '2026-11-16T12:00:00Z');
    expect(sanitizeTutorial(JSON.parse(JSON.stringify(p)), true).pausedAt).toEqual({ backup: '2026-11-16T12:00:00Z' });
    p = completeLesson(startLesson(p, 'backup', base0), 'x');
    expect(p.pausedAt).toEqual({});
    // Older saves without pause times still resume (in path order).
    expect(resumeCandidate(staticEnv('business'), { ...defaultTutorial(true), resume: { 'inventory-levels': 1 } })?.id).toBe('inventory-levels');
  });
});

describe('N1 — a tab that isn’t running the lesson can’t change the practice records', () => {
  it('refuses practice writes through the guard, and only practice writes', async () => {
    const s = new AppStore();
    await s.init(new MemoryStorage());
    s.updateSettings({ onboarded: true });
    s.setPracticeWriteGuard(() => 'running in another tab');
    // Real records are never affected by the guard.
    s.commit((d) => addItem(d, { name: 'Real', quantity: 1, unitCost: 1 }));
    await s.enterPractice(true);
    expect(() => s.commit((d) => addItem(d, { name: 'Stale practice form', quantity: 1, unitCost: 1 }))).toThrow(DomainError);
    expect(s.getState().data.items).toEqual([]);
    s.setPracticeWriteGuard(null);
    s.commit((d) => addItem(d, { name: 'Allowed', quantity: 1, unitCost: 1 }));
    expect(s.getState().data.items).toHaveLength(1);
  });
});

describe('N5 — the closing message never says "path complete" while recommending another lesson', () => {
  it('next unfinished and "path complete" are never both true', () => {
    for (const mode of ['business', 'reseller', 'collector'] as const) {
      const e = staticEnv(mode, { collectorSalesEnabled: true });
      const path = pathFor(e);
      let p = defaultTutorial(true);
      for (const [i, l] of path.entries()) {
        const next = nextUnfinished(e, p, l.id);
        const done = path.every((x) => x.id === l.id || x.id in p.completed);
        expect(Boolean(next) && done, `${mode} at ${l.id}`).toBe(false);
        if (i < path.length - 1) expect(next, `${mode} at ${l.id}`).toBeDefined();
        p = completeLesson(startLesson(p, l.id, base0), 'x');
      }
    }
  });

  it('no lesson summary recommends a specific next lesson itself (the engine does, from the path)', () => {
    for (const id of MODE_PATHS.business) {
      const done = lessonById(id)!.steps.at(-1)!;
      expect(typeof done.body === 'string' ? done.body : '', id).not.toMatch(/^Next[,:]|Next: record a sale|Next, try/);
    }
  });
});

describe('M10 — a help topic’s lesson link opens the step that explains it', () => {
  it('every topic step exists in its lesson, and practice lessons opened part-way can set themselves up', () => {
    for (const t of HELP_TOPICS) {
      if (!t.lessonStep) continue;
      const lesson = lessonById(t.lesson!)!;
      const steps = stepsFor(lesson, staticEnv(lesson.modes[0], { collectorSalesEnabled: true }));
      const at = steps.findIndex((s) => s.id === t.lessonStep);
      expect(at, `${t.id} → ${lesson.id}/${t.lessonStep}`).toBeGreaterThanOrEqual(0);
      if (lesson.practice && at > 0) expect(lesson.jumpSetup, `${lesson.id} needs a jump setup`).toBeDefined();
      // The step opens its own page, so it works without the earlier steps.
      if (at > 0 && lesson.practice) expect(steps[at].route ?? steps.slice(0, at).some((s) => s.route), `${t.id}`).toBeTruthy();
    }
    expect(HELP_TOPICS.find((t) => t.id === 'margin')!.lessonStep).toBe('margin');
  });

  it('the record-sale jump setup has a sale to explain', () => {
    const d = lessonById('practice-record-sale')!.jumpSetup!(emptyData());
    expect(d.sales).toHaveLength(1);
  });
});
