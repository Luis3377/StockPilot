import { describe, expect, it } from 'vitest';
import { completeLesson, defaultTutorial, goToStep, lessonStatus, pauseLesson, sanitizeTutorial, skipLesson, startLesson } from './progress';
import { LESSONS, MODE_PATHS, lessonById, lessonsFor, pathFor, practiceDetailParent, stepsFor } from './lessons';
import { HELP_TOPICS, helpTopic } from './help';
import { defaultSettings, emptyData, type Settings, type UserMode } from '../domain/types';
import { AppStore, datasetFor } from '../data/store';
import { MemoryStorage } from '../data/storage';
import { createBackup, parseBackup } from '../data/backup';
import { sanitizeSettings } from '../data/sanitize';
import { addItem, recordSale } from '../domain/actions';
import type { StaticEnv } from './types';

const base = { items: 0, sales: 0, lots: 0, bidPlans: 0 };
const env = (mode: UserMode, extra: Partial<Settings> = {}, scannerEnabled = false): StaticEnv => ({ settings: { ...defaultSettings(), mode, ...extra }, scannerEnabled });

describe('tutorial progress', () => {
  it('shows the welcome to new users only', () => {
    expect(defaultTutorial(false).welcome).toBe('pending');
    expect(defaultTutorial(true).welcome).toBe('seen');
    // People who used StockPilot before the Learning Center existed (no saved progress) aren't interrupted.
    expect(sanitizeTutorial(undefined, true).welcome).toBe('seen');
    expect(sanitizeSettings({ onboarded: true }).tutorial.welcome).toBe('seen');
    expect(sanitizeSettings({ onboarded: false }).tutorial.welcome).toBe('pending');
  });

  it('starts, moves, pauses, resumes, completes and skips lessons', () => {
    let p = startLesson(defaultTutorial(true), 'practice-add-item', base);
    expect(lessonStatus(p, 'practice-add-item')).toBe('in_progress');
    p = goToStep(p, 4);
    p = pauseLesson(p);
    expect(p.active).toBeNull();
    expect(p.resume['practice-add-item']).toBe(4);
    expect(lessonStatus(p, 'practice-add-item')).toBe('in_progress');
    p = startLesson(p, 'practice-add-item', base, p.resume['practice-add-item']);
    expect(p.active?.step).toBe(4);
    p = completeLesson(p, '2026-11-16T10:00:00.000Z');
    expect(lessonStatus(p, 'practice-add-item')).toBe('completed');
    expect(p.resume).toEqual({});
    p = skipLesson(startLesson(p, 'backup', base));
    expect(lessonStatus(p, 'backup')).toBe('skipped');
    // Starting a skipped lesson again un-skips it; replaying a completed one keeps its completion.
    p = startLesson(p, 'backup', base);
    expect(p.skipped).toEqual([]);
    const replay = pauseLesson(startLesson(p, 'practice-add-item', base));
    expect(lessonStatus(replay, 'practice-add-item')).toBe('in_progress');
    expect(replay.completed).toHaveProperty('practice-add-item');
    // Nothing happens without a running lesson.
    const idle = defaultTutorial(true);
    expect(pauseLesson(idle)).toBe(idle);
    expect(completeLesson(idle, 'x')).toBe(idle);
  });

  it('cleans up saved progress that is damaged or hand-edited', () => {
    const p = sanitizeTutorial(
      {
        welcome: 'nonsense',
        completed: { backup: '2026-01-01', 'Bad Id!': 'x', 'max-bid': 5 },
        skipped: ['payouts', 'payouts', 7, '../x'],
        resume: { 'practice-add-item': 3, 'max-bid': -1, backup: 1.5 },
        active: { lessonId: 'tour-dashboard', step: 2, baseline: { items: 4, sales: 'x' } },
      },
      false,
    );
    expect(p).toEqual({
      welcome: 'pending',
      completed: { backup: '2026-01-01' },
      skipped: ['payouts'],
      resume: { 'practice-add-item': 3 },
      active: { lessonId: 'tour-dashboard', step: 2, baseline: { items: 4, sales: 0, lots: 0, bidPlans: 0 } },
    });
    expect(sanitizeTutorial({ active: { lessonId: 'x y', step: 1 } }, true).active).toBeNull();
    expect(sanitizeTutorial('garbage', true)).toEqual(defaultTutorial(true));
  });
});

describe('lessons', () => {
  it('have unique ids, steps and sound references', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LESSONS) {
      expect(l.id).toMatch(/^[a-z0-9-]{1,60}$/);
      expect(l.steps.length).toBeGreaterThanOrEqual(2);
      const stepIds = l.steps.map((s) => s.id);
      expect(new Set(stepIds).size, l.id).toBe(stepIds.length);
      expect(l.steps.at(-1)!.id, `${l.id} ends with a summary`).toBe('done');
      l.steps.forEach((s, i) => {
        expect(s.title.length, `${l.id}/${s.id}`).toBeGreaterThan(0);
        expect(s.body.length, `${l.id}/${s.id}`).toBeGreaterThan(10);
        if (s.resumeAt) expect(stepIds.indexOf(s.resumeAt), `${l.id}/${s.id} resumes at an earlier step`).toBeLessThan(i);
        // A step the person has to do something on points at the control.
        if (s.advance.kind === 'click' || s.advance.kind === 'field') expect(s.target, `${l.id}/${s.id}`).toBeDefined();
      });
    }
  });

  it('only create records in practice lessons', () => {
    for (const l of LESSONS) {
      const acts = l.steps.some((s) => s.advance.kind === 'field' || (s.advance.kind === 'when' && /save|new/.test(s.id)));
      if (acts) expect(l.practice, `${l.id} records something, so it must use practice records`).toBe(true);
      if (l.setup) expect(l.practice, `${l.id} adds sample records, so it must use practice records`).toBe(true);
    }
  });

  it('mark every dollar example as illustrative', () => {
    for (const l of LESSONS) for (const s of l.steps) if (/\$\d/.test(s.body)) expect(s.illustrative, `${l.id}/${s.id}`).toBe(true);
  });

  it('never call an estimate verified, or profit cash', () => {
    for (const l of LESSONS)
      for (const s of l.steps) {
        expect(s.body, `${l.id}/${s.id}`).not.toMatch(/verified estimate|guarantee(d)? (profit|price)|profit is (the same as )?cash/i);
      }
  });

  it('give each mode a learning path, starting with the basics', () => {
    for (const mode of ['business', 'reseller', 'collector'] as UserMode[]) {
      const path = MODE_PATHS[mode];
      expect(path[0]).toBe('tour-dashboard');
      for (const id of path) {
        const l = lessonById(id);
        expect(l, id).toBeDefined();
        expect(l!.modes, `${id} in ${mode}`).toContain(mode);
      }
    }
    expect(MODE_PATHS.business.slice(0, 3)).toEqual(['tour-dashboard', 'practice-add-item', 'practice-record-sale']);
    expect(MODE_PATHS.reseller).toEqual(expect.arrayContaining(['ai-scanner', 'max-bid', 'bulk-lots', 'practice-record-sale', 'payouts', 'predicted-actual', 'profit-by-source']));
    expect(MODE_PATHS.collector).toEqual(expect.arrayContaining(['collector-add', 'collector-organize', 'collector-valuation', 'collector-sales']));
  });

  it("don't offer the scanner when it's off, or sales lessons when sales tracking is off", () => {
    expect(lessonsFor(env('reseller')).map((l) => l.id)).not.toContain('ai-scanner');
    expect(pathFor(env('reseller')).map((l) => l.id)).not.toContain('ai-scanner');
    expect(pathFor(env('reseller', {}, true)).map((l) => l.id)).toContain('ai-scanner');
    expect(lessonById('ai-scanner')!.unavailable!(env('reseller'))).toMatch(/isn’t available/);

    const collector = env('collector');
    expect(lessonById('practice-record-sale')!.unavailable!(collector)).toMatch(/Sales tracking is off/);
    expect(pathFor(env('collector', { collectorSalesEnabled: true })).map((l) => l.id)).toEqual(MODE_PATHS.collector);
  });

  it('can leave out steps by environment', () => {
    for (const l of LESSONS) expect(stepsFor(l, env('business')).length).toBeGreaterThan(0);
  });

  it('send a practice record page back to its list when practice ends', () => {
    expect(practiceDetailParent('/inventory/bids/abc')).toBe('/inventory/bids');
    expect(practiceDetailParent('/inventory/abc')).toBe('/inventory');
    expect(practiceDetailParent('/inventory/lots/abc/performance')).toBe('/inventory/lots');
    expect(practiceDetailParent('/insights/sourcing/trips/t1')).toBe('/insights/sourcing');
    expect(practiceDetailParent('/sales/payouts/P-1')).toBe('/sales/payouts');
    for (const list of ['/inventory', '/inventory/lots', '/inventory/bids', '/inventory/lots/performance', '/sales', '/learn', '/']) expect(practiceDetailParent(list), list).toBeNull();
  });
});

describe('help topics', () => {
  it('cover every term the help icons explain, with accurate wording', () => {
    for (const id of ['cogs', 'realized-profit', 'margin', 'roi', 'max-bid', 'net-proceeds', 'inventory-reconciliation', 'tax-reserve', 'profit-per-hour']) expect(helpTopic(id).text.length).toBeGreaterThan(30);
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length);
    expect(helpTopic('realized-profit').text).toMatch(/not the cash/);
    expect(helpTopic('tax-reserve').text).toMatch(/profit isn’t the same as cash/);
    expect(helpTopic('tax-reserve').text).toMatch(/doesn’t know your tax rate/);
    expect(helpTopic('max-bid').text).toMatch(/estimate/);
    expect(helpTopic('max-bid').text).toMatch(/not a guarantee/);
    expect(helpTopic('profit-per-hour').text).toMatch(/isn’t an hourly wage/);
    expect(helpTopic('payout').text).toMatch(/not extra profit/);
    expect(helpTopic('inventory-reconciliation').text).toMatch(/only marked verified when the records support them/);
    expect(helpTopic('cost-per-item').text).toBe('What you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells.');
    for (const t of HELP_TOPICS) if (t.lesson) expect(lessonById(t.lesson), t.id).toBeDefined();
    expect(() => helpTopic('nope')).toThrow();
  });
});

describe('practice records', () => {
  it('are kept apart from real and demo records, start clean, and survive a refresh mid-lesson', async () => {
    const storage = new MemoryStorage();
    const s = new AppStore();
    await s.init(storage);
    s.updateSettings({ onboarded: true });
    s.commit((d) => addItem(d, { name: 'Real lamp', quantity: 2, unitCost: 10 }));
    await s.flush();
    const real = await storage.getData('real');

    await s.enterPractice(true);
    expect(s.getState().dataset).toBe('practice');
    expect(datasetFor(s.getState().settings)).toBe('practice');
    expect(s.getState().data.items).toEqual([]);
    const { item } = s.commit((d) => addItem(d, { name: 'Practice mug', quantity: 3, unitCost: 8 }));
    s.commit((d) => recordSale(d, { itemId: item.id, quantity: 1, salePrice: 20, priceMode: 'per_unit', saleDate: '2026-11-16' }));
    await s.flush();
    expect(await storage.getData('real')).toEqual(real);

    // A refresh in the middle of a lesson reopens the practice records.
    const again = new AppStore();
    await again.init(storage);
    expect(again.getState().dataset).toBe('practice');
    expect(again.getState().data.items.map((i) => i.name)).toEqual(['Practice mug']);

    // Leaving shows the real records exactly as they were.
    await again.exitPractice();
    expect(again.getState().dataset).toBe('real');
    expect(again.getState().data.items.map((i) => i.name)).toEqual(['Real lamp']);
    expect(again.getState().data.sales).toEqual([]);

    // Resuming keeps the practice records; starting over empties them (no duplicates).
    await again.enterPractice(false);
    expect(again.getState().data.items).toHaveLength(1);
    await again.enterPractice(true);
    expect(again.getState().data.items).toHaveLength(0);

    // Backups and restores of practice records aren't possible.
    const backup = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), emptyData(), [])));
    await expect(again.restore(backup, true)).rejects.toThrow(/practice mode/);
    await again.exitPractice();
    expect(again.getState().data.items.map((i) => i.name)).toEqual(['Real lamp']);

    // From the demo, practice returns to the demo; switching to the demo ends practice.
    await again.setDemoActive(true);
    await again.enterPractice(true);
    await again.exitPractice();
    expect(again.getState().dataset).toBe('demo');
    await again.enterPractice(true);
    await again.setDemoActive(false);
    expect(again.getState().settings.practiceActive).toBe(false);
    expect(again.getState().dataset).toBe('real');
  });

  it('progress goes into backups and comes back on restore, without a running lesson or the welcome', async () => {
    const s = new AppStore();
    await s.init(new MemoryStorage());
    let t = completeLesson(startLesson(defaultTutorial(true), 'backup', base), '2026-11-16T00:00:00.000Z');
    t = startLesson(t, 'max-bid', base);
    s.updateSettings({ onboarded: true, tutorial: t });
    const file = parseBackup(JSON.stringify(createBackup('real', s.getState().settings, s.getState().data, [])));
    expect(file.settings.tutorial.completed).toHaveProperty('backup');

    s.updateSettings({ tutorial: defaultTutorial(true) });
    await s.restore(file, true);
    const restored = s.getState().settings.tutorial;
    expect(restored.completed).toHaveProperty('backup');
    expect(restored.active).toBeNull();
    expect(restored.welcome).toBe('seen');

    // A backup that still had the welcome pending doesn't bring it back.
    const pending = parseBackup(JSON.stringify(createBackup('real', { ...defaultSettings(), onboarded: true, tutorial: defaultTutorial(false) }, emptyData(), [])));
    await s.restore(pending, true);
    expect(s.getState().settings.tutorial.welcome).toBe('seen');
  });
});
