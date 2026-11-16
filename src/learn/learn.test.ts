import { describe, expect, it } from 'vitest';
import { completeLesson, defaultTutorial, goToStep, lessonStatus, pauseLesson, sanitizeTutorial, skipLesson, startLesson } from './progress';
import { LESSONS, MODE_PATHS, lessonById, lessonSearchText, lessonsFor, moneyProblem, nextUnfinished, otherModeLessons, pathFor, practiceDetailParent, stepsFor } from './lessons';
import { HELP_TOPICS, helpTopic } from './help';
import { defaultSettings, emptyData, type Settings, type UserMode } from '../domain/types';
import { AppStore, datasetFor } from '../data/store';
import { MemoryStorage } from '../data/storage';
import { createBackup, parseBackup } from '../data/backup';
import { sanitizeSettings } from '../data/sanitize';
import { addItem, recordSale } from '../domain/actions';
import type { LessonEnv, StaticEnv, Text } from './types';
import { PRACTICE_DATA_LOCK, PracticeLockError } from '../data/store';
import { applyInventoryImport, previewInventoryImport } from '../csv/inventoryImport';

const base = { items: 0, sales: 0, lots: 0, bidPlans: 0 };
/** Resolves a step's wording the way the lesson box does, with empty practice records. */
const say = (t: Text, mode: UserMode = 'business') => {
  const e: LessonEnv = { settings: { ...defaultSettings(), mode }, scannerEnabled: false, data: emptyData(), path: '', baseline: base, has: () => false, text: () => '' };
  return typeof t === 'function' ? t(e) : t;
};
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
        for (const mode of l.modes) {
          expect(say(s.title, mode).length, `${l.id}/${s.id}`).toBeGreaterThan(0);
          expect(say(s.body, mode).length, `${l.id}/${s.id}`).toBeGreaterThan(10);
        }
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

  it('mark every fixed dollar example as illustrative (figures from your own practice records are not examples)', () => {
    for (const l of LESSONS) for (const s of l.steps) if (typeof s.body === 'string' && /\$\d/.test(s.body)) expect(s.illustrative, `${l.id}/${s.id}`).toBe(true);
  });

  it('use the mode’s own words: Collection for collectors', () => {
    const add = lessonById('collector-add')!;
    const open = add.steps.find((s) => s.id === 'go-inventory')!;
    expect(say(open.body, 'collector')).toContain('Click Collection in the menu');
    expect(say(open.body, 'business')).toContain('Click Inventory in the menu');
    const dash = lessonById('tour-dashboard')!.steps.find((s) => s.id === 'overview')!;
    expect(say(dash.body, 'collector')).toMatch(/collection at a glance/);
    expect(say(dash.body, 'business')).toMatch(/your business/);
    expect(say(dash.body, 'reseller')).toMatch(/reselling/);
    expect(say(lessonById('collector-sales')!.steps[0].body, 'collector')).toContain('doesn’t switch it on');
  });

  it('explain what is wrong with a number', () => {
    expect(moneyProblem('8')).toBeNull();
    expect(moneyProblem('8.50')).toBeNull();
    expect(moneyProblem('$1,200')).toBeNull();
    expect(moneyProblem('')).toMatch(/Enter an amount/);
    expect(moneyProblem('', { optional: true })).toBeNull();
    expect(moneyProblem('abc')).toMatch(/isn’t a number/);
    expect(moneyProblem('-3')).toMatch(/can’t be negative/);
    expect(moneyProblem('1.234')).toMatch(/two decimal places/);
    expect(moneyProblem('0', { positive: true })).toMatch(/above zero/);
  });

  it('Max Bid is a real calculation: the person enters a resale value and target return, and can only finish once a result shows', () => {
    const steps = lessonById('max-bid')!.steps;
    expect(steps.find((s) => s.id === 'resale')!.advance.kind).toBe('field');
    expect(steps.find((s) => s.id === 'roi')!.advance.kind).toBe('field');
    const result = steps.find((s) => s.id === 'result')!;
    expect(result.advance.kind).toBe('next');
    const ready = (result.advance as { ready?: (e: LessonEnv) => boolean }).ready!;
    const e = (shown: boolean): LessonEnv => ({
      settings: defaultSettings(),
      scannerEnabled: false,
      data: emptyData(),
      path: '',
      baseline: base,
      has: (sel) => shown && sel.includes('bid-max'),
      text: () => '$412.00',
    });
    expect(ready(e(false))).toBe(false);
    expect(ready(e(true))).toBe(true);
    expect(say(steps.find((s) => s.id === 'new')!.body)).toContain('New calculation');
  });

  it('the collector lesson walks through condition, date and where it was bought before saving', () => {
    const ids = lessonById('collector-add')!.steps.map((s) => s.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('more')).toBeGreaterThan(0);
    expect(at('condition')).toBe(at('more') + 1);
    expect(at('date')).toBe(at('condition') + 1);
    expect(at('where')).toBe(at('date') + 1);
    expect(at('save')).toBe(at('where') + 1);
    const more = lessonById('collector-add')!.steps[at('more')];
    expect(more.optional).toBeFalsy();
  });

  it('never call an estimate verified, or profit cash', () => {
    for (const l of LESSONS)
      for (const s of l.steps) {
        for (const mode of l.modes) expect(say(s.body, mode), `${l.id}/${s.id}`).not.toMatch(/verified estimate|guarantee(d)? (profit|price)|profit is (the same as )?cash/i);
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

  it("list the scanner lesson as unavailable (with the reason) when it's off, and keep it off the path", () => {
    expect(lessonsFor(env('reseller')).map((l) => l.id)).toContain('ai-scanner');
    expect(lessonById('ai-scanner')!.unavailable!(env('reseller'))).toMatch(/switched off/);
    expect(lessonById('ai-scanner')!.unavailable!(env('reseller', {}, true))).toBeNull();
    expect(pathFor(env('reseller')).map((l) => l.id)).not.toContain('ai-scanner');
    expect(pathFor(env('reseller', {}, true)).map((l) => l.id)).toContain('ai-scanner');

    const collector = env('collector');
    expect(lessonById('practice-record-sale')!.unavailable!(collector)).toMatch(/Sales tracking is off.*Track sales & profit/);
    expect(pathFor(env('collector', { collectorSalesEnabled: true })).map((l) => l.id)).toEqual(MODE_PATHS.collector);
  });

  it('make all 17 lessons discoverable in every mode: the mode’s own, plus the ones made for other modes', () => {
    expect(LESSONS).toHaveLength(17);
    for (const mode of ['business', 'reseller', 'collector'] as UserMode[]) {
      const e = env(mode);
      const ids = [...lessonsFor(e), ...otherModeLessons(e)].map((l) => l.id).sort();
      expect(ids).toEqual(LESSONS.map((l) => l.id).sort());
      expect(otherModeLessons(e).every((l) => !l.modes.includes(mode))).toBe(true);
    }
  });

  it('search finds lessons by their instructions, not just titles', () => {
    const text = (id: string) => lessonSearchText(lessonById(id)!, env('business')).toLowerCase();
    expect(text('backup')).toContain('restore');
    expect(text('practice-record-sale')).toContain('margin');
    expect(text('bulk-lots')).toContain('$100');
    expect(text('payouts')).toContain('transaction report');
  });

  it('recommend the next unfinished lesson on the path, never a completed one', () => {
    const e = env('business');
    let p = defaultTutorial(true);
    p = completeLesson(startLesson(p, 'practice-add-item', base), 'x');
    p = completeLesson(startLesson(p, 'practice-record-sale', base), 'x');
    // Finishing the dashboard tour: add-item and record-sale are done, so inventory levels comes next.
    expect(nextUnfinished(e, p, 'tour-dashboard')?.id).toBe('inventory-levels');
    // From the end of the path it wraps round to what's left.
    expect(nextUnfinished(e, p, 'backup')?.id).toBe('tour-dashboard');
    for (const l of MODE_PATHS.business) p = completeLesson(startLesson(p, l, base), 'x');
    expect(nextUnfinished(e, p, 'backup')).toBeUndefined();
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
    for (const list of ['/inventory', '/inventory/lots', '/inventory/bids', '/inventory/lots/performance', '/sales', '/learn', '/'])
      expect(practiceDetailParent(list), list).toBeNull();
  });
});

describe('help topics', () => {
  it('cover every term the help icons explain, with accurate wording', () => {
    for (const id of ['cogs', 'realized-profit', 'margin', 'roi', 'max-bid', 'net-proceeds', 'inventory-reconciliation', 'tax-reserve', 'profit-per-hour'])
      expect(helpTopic(id).text.length).toBeGreaterThan(30);
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
    await expect(again.restore(backup, true)).rejects.toThrow(/Practice Mode/);
    await again.exitPractice();
    expect(again.getState().data.items.map((i) => i.name)).toEqual(['Real lamp']);

    // From the demo, practice returns to the demo; switching demo on or off waits until practice ends.
    await again.setDemoActive(true);
    await again.enterPractice(true);
    await again.exitPractice();
    expect(again.getState().dataset).toBe('demo');
    await again.enterPractice(true);
    await expect(again.setDemoActive(false)).rejects.toThrow(PracticeLockError);
    expect(again.getState().dataset).toBe('practice');
    await again.exitPractice();
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

describe('Practice Mode data safety (H3)', () => {
  it('refuses backups, restores, imports, demo switching, demo resets and erasing, and never touches real or demo records', async () => {
    const storage = new MemoryStorage();
    const s = new AppStore();
    await s.init(storage);
    s.updateSettings({ onboarded: true });
    s.commit((d) => addItem(d, { name: 'Real lamp', quantity: 2, unitCost: 10 }));
    await s.setDemoActive(true);
    s.commit((d) => addItem(d, { name: 'My demo test item', quantity: 1, unitCost: 1 }));
    await s.setDemoActive(false);
    await s.flush();
    const real = JSON.stringify(await storage.getData('real'));
    const demo = JSON.stringify(await storage.getData('demo'));

    await s.enterPractice(true);
    s.commit((d) => addItem(d, { name: 'Practice mug', quantity: 3, unitCost: 8 }));
    expect(s.practicing).toBe(true);
    const backupFile = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), emptyData(), [])));
    const preview = previewInventoryImport('name,quantity,cost\nImported thing,1,5', s.getState().data);
    const attempts: [string, () => Promise<unknown>][] = [
      ['erase', () => s.clearRealData()],
      ['reset demo', () => s.resetDemo()],
      ['restore', () => s.restore(backupFile, true)],
      ['backup', () => s.createBackupFile()],
      ['import', async () => s.importInventory((d) => applyInventoryImport(d, preview, 'skip'))],
      ['load demo', () => s.setDemoActive(true)],
      ['leave demo', () => s.setDemoActive(false)],
      ['delete practice records', () => s.clearPractice()],
    ];
    for (const [name, run] of attempts) {
      const err = await run().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, name).toBeInstanceOf(PracticeLockError);
      expect((err as Error).message, name).toBe(PRACTICE_DATA_LOCK);
    }
    await s.flush();
    // Still practicing, with the practice records exactly as they were.
    expect(s.getState().dataset).toBe('practice');
    expect(s.getState().data.items.map((i) => i.name)).toEqual(['Practice mug']);
    // Real and demo records untouched (not erased, reset, replaced or imported into).
    expect(JSON.stringify(await storage.getData('real'))).toBe(real);
    expect(JSON.stringify(await storage.getData('demo'))).toBe(demo);
    expect(demo).toContain('My demo test item');

    // After leaving, the same actions work again and act on your own records.
    await s.exitPractice();
    expect(() => s.assertCanManageData()).not.toThrow();
    expect((await s.createBackupFile()).file.data.items.map((i) => i.name)).toEqual(['Real lamp']);
    await s.clearPractice();
    await s.enterPractice(false);
    expect(s.getState().data.items).toEqual([]);
    await s.exitPractice();
  });

  it('existing users with records are not sent through first-time onboarding (L14)', async () => {
    const storage = new MemoryStorage();
    await storage.putData('real', addItem(emptyData(), { name: 'Old record', quantity: 1, unitCost: 1 }).data);
    const s = new AppStore();
    await s.init(storage);
    expect(s.getState().settings.onboarded).toBe(true);
    expect(s.getState().settings.tutorial.welcome).toBe('seen');
    // A brand-new user still is.
    const fresh = new AppStore();
    await fresh.init(new MemoryStorage());
    expect(fresh.getState().settings.onboarded).toBe(false);
    expect(fresh.getState().settings.tutorial.welcome).toBe('pending');
  });

  it('keeps the tab that owns a running lesson (H1)', () => {
    let p = startLesson(defaultTutorial(true), 'practice-add-item', base, 0, 'tabone');
    expect(p.active?.owner).toBe('tabone');
    p = sanitizeTutorial(JSON.parse(JSON.stringify(p)), true);
    expect(p.active?.owner).toBe('tabone');
    expect(sanitizeTutorial({ active: { lessonId: 'backup', step: 0, owner: 'BAD ID!' } }, true).active).toEqual({ lessonId: 'backup', step: 0, baseline: base });
  });
});

describe('demo records added while trying StockPilot out', () => {
  it('are told apart from the demo’s own sample items, in saved demos too (no migration)', async () => {
    const { buildDemoData, isDemoSeedItem } = await import('../data/demo');
    const seeded = buildDemoData('2026-11-16');
    expect(seeded.items.length).toBeGreaterThan(10);
    expect(seeded.items.every(isDemoSeedItem)).toBe(true);
    const mine = addItem(seeded, { name: 'My test item', quantity: 1, unitCost: 2 }).item;
    expect(isDemoSeedItem(mine)).toBe(false);
  });
});
