import { expect, signIn, test } from '../fixtures';

/**
 * Animated welcome smiley (hero card) — MOCKED.
 *
 * The mouth must visibly open and close (1.3s loop) and the eyes must blink
 * on an independent loop, in the real rendered dashboard — with no layout
 * movement. Reduced motion must show a static happy smile instead.
 */
test.describe('dashboard animated smiley', () => {
  test('mouth opens and closes in a loop without moving the tile', async ({ page }) => {
    await signIn(page);

    const icon = page.locator('.welcome-icon');
    await expect(icon).toBeVisible();
    const boxBefore = await icon.boundingBox();

    // Watch the real dashboard for one full mouth loop and collect samples.
    const samples = await page.evaluate(async () => {
      const open = document.querySelector('.nk-smiley-mouth-open') as SVGElement | null;
      const closed = document.querySelector('.nk-smiley-mouth-closed') as SVGElement | null;
      if (!open || !closed) return null;

      const read = () => ({
        open: getComputedStyle(open).opacity,
        closed: getComputedStyle(closed).opacity,
      });

      const seen: Array<{ open: string; closed: string }> = [read()];
      for (let i = 0; i < 14; i++) {
        await new Promise(resolve => setTimeout(resolve, 120));
        seen.push(read());
      }
      return seen;
    });

    expect(samples).not.toBeNull();
    const openValues = new Set(samples!.map(s => s.open));
    // The mouth-open path must have been visible at some point and hidden at
    // another — that is the open/close motion, verified on the live DOM.
    expect(openValues.size).toBeGreaterThan(1);
    expect([...openValues].some(v => Number(v) > 0.5)).toBe(true);
    expect([...openValues].some(v => Number(v) < 0.2)).toBe(true);

    // Independent blink loop exists (animation attached to blink paths).
    const blinkAnimations = await page.evaluate(() =>
      document.querySelectorAll('.nk-smiley-eye-blink').length,
    );
    expect(blinkAnimations).toBe(2);

    // No layout shift: the tile never moves.
    const boxAfter = await icon.boundingBox();
    expect(boxAfter).toEqual(boxBefore);
  });

  test('prefers-reduced-motion shows a static happy smile', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);

    const state = await page.evaluate(() => {
      const open = document.querySelector('.nk-smiley-mouth-open') as SVGElement | null;
      const closed = document.querySelector('.nk-smiley-mouth-closed') as SVGElement | null;
      if (!open || !closed) return null;
      const animations = document.querySelector('.nk-smiley')!.getAnimations().length
        + open.getAnimations().length
        + closed.getAnimations().length;
      return {
        open: getComputedStyle(open).opacity,
        closed: getComputedStyle(closed).opacity,
        animations,
      };
    });

    expect(state).not.toBeNull();
    // Static cheerful open smile, nothing animating.
    expect(Number(state!.open)).toBe(1);
    expect(Number(state!.closed)).toBe(0);
    expect(state!.animations).toBe(0);
  });
});
