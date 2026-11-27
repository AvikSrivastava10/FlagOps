// The callbacks passed to evaluate() run in the browser, so this file needs the DOM types.
/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The P2 gate (plan.md, P2 exit criteria 1 to 4): screenshots of every gallery section, axe, the
// keyboard checks and reduced motion. Screenshots go to .agents/screenshots/P2/, which git ignores.
const galleryUrl = 'http://127.0.0.1:5174/gallery.html';
const shots = '.agents/screenshots/P2';
const lineBlue = 'rgb(0, 57, 166)';

async function openGallery(page: Page) {
  // Shortly after start-up, Vite's dependency optimizer may reload open pages, which aborts a
  // navigation that is still loading; the next attempt gets the optimized dependencies.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(galleryUrl);
      break;
    } catch (error) {
      if (attempt === 3 || !String(error).includes('ERR_ABORTED')) throw error;
    }
  }
  await page.locator('[data-gallery-section]').first().waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

function shot(name: string): { path: string } {
  return { path: `${shots}/${test.info().project.name}-${name}.png` };
}

test.describe('gallery', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('renders every section without page overflow or clipped flag names', async ({ page }) => {
    const sections = await page.locator('[data-gallery-section]').all();
    expect(sections.length).toBeGreaterThanOrEqual(24);
    for (const section of sections) {
      const id = await section.getAttribute('data-gallery-section');
      await section.screenshot(shot(`section-${id ?? 'unknown'}`));
    }
    await page.screenshot({ ...shot('full'), fullPage: true });

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);

    // ui-design.md 9: no flag name clips (FlagName is an inline-block box, so this measures).
    const clipped = await page
      .locator('[data-flag-entry] [data-flag-name]')
      .evaluateAll((names) =>
        names.filter((name) => name.scrollWidth > name.clientWidth).map((name) => name.textContent),
      );
    expect(clipped).toEqual([]);
  });

  test('the line diagram keeps 200px stations and scrolls inside its region', async ({ page }) => {
    const region = page
      .locator('[data-gallery-section="line-diagram"] [data-line-diagram]')
      .first();
    const widths = await region
      .locator('section[data-stage]')
      .evaluateAll((stations) => stations.map((station) => station.getBoundingClientRect().width));
    expect(widths).toHaveLength(11);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(200);
    const scrolls = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(scrolls).toBe(true);
  });

  test('counts and tables use tabular figures', async ({ page }) => {
    const selectors = [
      '[data-station-count]',
      '[data-timetable] td',
      '[data-gallery-section="impact-summary"] [data-kind] dd a',
    ];
    for (const selector of selectors) {
      const variants = await page
        .locator(selector)
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fontVariantNumeric),
        );
      expect(variants.length, selector).toBeGreaterThan(0);
      for (const variant of variants) expect(variant, selector).toContain('tabular-nums');
    }
  });

  test('axe reports no serious or critical violations', async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    console.log(
      `axe: ${results.violations.length} violations, ${blocking.length} serious or critical`,
      results.violations.map(
        (violation) =>
          `${violation.id} (${violation.impact ?? 'none'}): ${violation.nodes
            .map((node) => node.target.join(' '))
            .join(', ')}`,
      ),
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });

  test('interactive components show the focus ring', async ({ page }) => {
    const targets = [
      '[data-gallery-section="buttons"] button',
      '[data-gallery-section="inputs"] input[type="email"]',
      '[data-gallery-section="inputs"] select',
      '[data-gallery-section="inputs"] [aria-pressed]',
      '[data-gallery-section="signage-bar"] nav a',
      '[data-gallery-section="flag-entry"] [data-flag-entry]',
      '[data-gallery-section="timetable"] [data-roving]',
      '[data-gallery-section="confirm-gate"] input',
    ];
    for (const [index, selector] of targets.entries()) {
      const target = page.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      // Focus the element before the target, then Tab, so focus comes from the keyboard.
      await target.evaluate((element) => {
        (element as HTMLElement).focus();
      });
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return null;
        const style = getComputedStyle(active);
        return {
          width: style.outlineWidth,
          colour: style.outlineColor,
          visible: active.matches(':focus-visible'),
        };
      });
      expect(ring, selector).toEqual({ width: '3px', colour: lineBlue, visible: true });
      await page.screenshot({ ...shot(`focus-${String(index + 1).padStart(2, '0')}`) });
    }
  });

  test('the evidence card opens on focus, describes the entry and closes with Escape', async ({
    page,
  }) => {
    const entry = page.locator('[data-gallery-entries] [data-flag-entry]').first();
    await entry.focus();
    const cardId = await entry.getAttribute('aria-describedby');
    expect(cardId).not.toBeNull();
    const card = page.locator(`[id="${cardId ?? ''}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('ON for everyone in 3 of 3 environments');
    const [entryBox, cardBox] = [await entry.boundingBox(), await card.boundingBox()];
    expect(entryBox && cardBox).toBeTruthy();
    if (entryBox && cardBox) {
      const overlaps =
        cardBox.y < entryBox.y + entryBox.height && entryBox.y < cardBox.y + cardBox.height;
      expect(overlaps).toBe(false);
    }
    await page.screenshot(shot('evidence-card-open'));
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(entry).toBeFocused();
  });

  test('the board moves focus with the arrow keys', async ({ page }) => {
    const region = page
      .locator('[data-gallery-section="line-diagram"] [data-line-diagram]')
      .first();
    const plate = (stage: string) => region.locator(`section[data-stage="${stage}"] h3`);
    await plate('new').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(plate('new')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(plate('development')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      region.locator('section[data-stage="development"] [data-flag-entry]'),
    ).toBeFocused();
    await page.keyboard.press('End');
    await expect(plate('archived')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(plate('archived')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(plate('new')).toBeFocused();
    await page.screenshot(shot('board-keyboard'));
  });

  test('the confirm gate enables Apply only for the exact typed name', async ({ page }) => {
    const gate = page.locator('[data-gallery-state="Production: typed name"]');
    const input = gate.getByLabel('Type dark_mode to apply to Production');
    const apply = gate.getByRole('button', { name: 'Apply to Production' });
    const applied = gate.locator('[data-gallery-applied]');
    for (const wrong of ['', 'dark_mod', 'Dark_mode', 'dark_mode ']) {
      await input.fill(wrong);
      await expect(apply).toHaveAttribute('aria-disabled', 'true');
      // Playwright refuses to click an aria-disabled button; force the click to prove it is inert.
      await apply.click({ force: true });
      await expect(applied).toHaveAttribute('data-gallery-applied', '0');
    }
    await input.fill('dark_mode');
    await expect(apply).not.toHaveAttribute('aria-disabled');
    await page.screenshot(shot('confirm-gate-ready'));
    await apply.click();
    await expect(applied).toHaveAttribute('data-gallery-applied', '1');
  });

  test('tooltips stay in the viewport and Escape hides them from anywhere', async ({ page }) => {
    const trigger = page.locator('[data-gallery-tip="2 references"]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    const tip = page.locator(`[id="${(await trigger.getAttribute('aria-describedby')) ?? ''}"]`);
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    await page.screenshot(shot('tooltip-right-edge'));
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();

    const inner = page.locator('[data-gallery-tip="6 references"]');
    await inner.scrollIntoViewIfNeeded();
    await inner.hover();
    await expect(
      page.getByRole('tooltip', { name: 'Latest scans of 2 repositories.' }),
    ).toBeVisible();
    await page.screenshot(shot('tooltip-scrolling-region'));
  });

  test('a flap change flips at most 8 tiles within 400ms', async ({ page }) => {
    const flap = page.locator('[data-gallery-flap]');
    await flap.getByRole('button', { name: 'Change status' }).click();
    const timings = await flap.locator('[data-flipping]').evaluateAll((tiles) =>
      tiles.map((tile) => {
        const style = getComputedStyle(tile);
        return parseFloat(style.animationDelay) + parseFloat(style.animationDuration);
      }),
    );
    expect(timings.length).toBeGreaterThan(0);
    expect(timings.length).toBeLessThanOrEqual(8);
    expect(Math.max(...timings)).toBeLessThanOrEqual(0.4);
  });
});

test.describe('gallery with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('changes show their end state and the static marker', async ({ page }) => {
    await openGallery(page);
    const flap = page.locator('[data-gallery-flap]');
    await flap.getByRole('button', { name: 'Change status' }).click();
    await expect(flap.locator('[data-flipping]')).toHaveCount(0);
    await expect(flap.locator('[data-changed-marker]')).toBeVisible();
    const arrival = page.locator('[data-gallery-state="Arrival after a sync"]');
    await arrival.getByRole('button', { name: 'Simulate a sync' }).click();
    await expect(arrival.locator('[data-changed-marker]')).toBeVisible();
    const moving = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return timing !== undefined && Number(timing.duration) > 0;
        }).length,
    );
    expect(moving).toBe(0);
    await flap.screenshot(shot('reduced-motion-flap'));
    await arrival.screenshot(shot('reduced-motion-arrival'));
    await page.screenshot({ ...shot('reduced-motion-full'), fullPage: true });
  });
});
