// Shared helpers for Learning Center browser tests: find the lesson box and its highlighted
// controls, answer field steps like a person, tap controls where they're visible, and walk lessons.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export const pop = (page: Page) => page.getByTestId('tour-popover');
export const step = (page: Page, id: string) => expect(pop(page)).toHaveAttribute('data-step', id);
/** The control the current step highlights (marked with the step's id, so it's never a stale one). */
export const at = (page: Page, id: string) => page.locator(`[data-tour-active="${id}"]`).first();
export const itemForm = (page: Page) => page.getByTestId('item-form');
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Taps the highlighted control where a person sees it: once it has stopped moving and nothing covers it. */
export async function tap(page: Page, id: string, within?: string) {
  const el = within ? at(page, id).locator(within).first() : at(page, id);
  let last = '';
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const b = await el.boundingBox();
        const key = JSON.stringify(b);
        const still = key === last;
        last = key;
        if (!b || !still) return false;
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const onTop = await el.evaluate(
          (node, [px, py]) => {
            const hit = document.elementFromPoint(px, py);
            return !!hit && (node === hit || node.contains(hit));
          },
          [x, y],
        );
        point = onTop ? { x, y } : null;
        return onTop;
      },
      { message: `the "${id}" control should be on screen and uncovered`, timeout: 5000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.click(point!.x, point!.y);
}

/** Waits for a step, then taps the control it highlights. */
export async function clickStep(page: Page, id: string) {
  await step(page, id);
  await tap(page, id);
}

/** The form control a field step reads: the highlighted control, or the one inside a highlighted field group. */
export async function fieldOf(page: Page, id: string): Promise<Locator> {
  const t = at(page, id);
  const isControl = await t.evaluate((n) => /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName));
  return isControl ? t : t.locator('input:not([type="hidden"]):not([type="file"]), select, textarea').first();
}

/** Types into the highlighted field (checked by its label) and moves on with Tab, like a person would. */
export async function answer(page: Page, id: string, label: string, value: string) {
  await step(page, id);
  const input = await fieldOf(page, id);
  await expect(input).toHaveAccessibleName(new RegExp(`^${escapeRe(label)}`));
  await input.fill(value);
  await page.keyboard.press('Tab');
}

export async function axe(page: Page, where: string) {
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The highlighted control is on screen and nothing (the lesson box included) covers it. Waits out a
 * notification that's about to go (they last 3.5 s), e.g. the last lesson's “Lesson complete”.
 */
export async function expectReachable(page: Page, control?: Locator) {
  const el = control ?? at(page, (await pop(page).getAttribute('data-step'))!);
  await expect(el).toBeInViewport();
  const covered = () =>
    el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const top = Math.max(0, r.top);
      const bottom = Math.min(window.innerHeight, r.bottom);
      let last = 'nothing';
      // The middle, or (for a big card the lesson box partly overlaps) another point inside it.
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, top + (bottom - top) * fy) as HTMLElement | null;
        if (!hit) continue;
        // Look-only steps put a clear shield over the control: shown, but not usable from the lesson.
        if (node === hit || node.contains(hit) || hit.contains(node) || hit.dataset.testid === 'tour-look-shield') return null;
        last = `${hit.tagName} ${hit.dataset.testid ?? ''} ${hit.className}`.slice(0, 160);
      }
      return last;
    });
  await expect.poll(covered, { message: `the highlighted control (${await pop(page).getAttribute('data-step')}) should not be covered`, timeout: 5000 }).toBeNull();
}

/** Every button in the lesson box is fully inside the screen. */
export async function buttonsInside(page: Page) {
  const vw = page.viewportSize()!;
  for (const b of await pop(page).getByRole('button').all()) {
    const r = await b.boundingBox();
    expect(r, 'button visible').not.toBeNull();
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(vw.width + 0.5);
    expect(r!.y).toBeGreaterThanOrEqual(0);
    expect(r!.y + r!.height).toBeLessThanOrEqual(vw.height + 0.5);
  }
}

export async function openLearn(page: Page) {
  await page.locator('[data-tour="learn-link"]:visible').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Learning Center' })).toBeVisible();
}

export const lessonRow = (page: Page, id: string) =>
  page
    .getByTestId('learn-path')
    .locator(`[data-lesson="${id}"]`)
    .or(page.locator(`[data-testid^="learn-group-"] [data-lesson="${id}"], [data-testid="learn-other-modes"] [data-lesson="${id}"]`))
    .first();

export async function startLesson(page: Page, id: string) {
  await openLearn(page);
  await lessonRow(page, id).getByTestId('learn-start').click();
  await expect(pop(page)).toBeVisible();
}

/** Walks a lesson to its end: Next on look steps, a tap on the control for steps that need one. */
export async function walk(page: Page, id: string) {
  await startLesson(page, id);
  for (let i = 0; i < 30; i++) {
    const p = pop(page);
    await expect(p).toBeVisible();
    await expect(p).not.toHaveAttribute('data-target-found', 'false', { timeout: 4000 });
    await expect(page.getByTestId('tour-body')).not.toContainText('can’t find');
    if (await page.getByTestId('tour-finish').isVisible()) {
      await page.getByTestId('tour-finish').click();
      await expect(p).toBeHidden();
      return;
    }
    const before = (await p.getAttribute('data-step'))!;
    if ((await p.getAttribute('data-target-found')) === 'true') await expectReachable(page);
    if (await page.getByTestId('tour-next').isVisible()) await page.getByTestId('tour-next').click();
    else await tap(page, before);
    await expect(p).not.toHaveAttribute('data-step', before);
  }
  throw new Error(`lesson ${id} didn't finish`);
}
