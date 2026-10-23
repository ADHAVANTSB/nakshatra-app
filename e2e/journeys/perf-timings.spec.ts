import { expect, monitorPageErrors, signIn, test } from '../fixtures';

/**
 * Frontend timing instrumentation (production-readiness Phase A).
 *
 * ALL numbers produced here are SIMULATED: the backend is the e2e stub
 * (e2e/stubs/backend.ts) served from the local Angular dev server. They
 * measure frontend routing, rendering and request orchestration only -
 * NOT Apps Script or Sheets latency. Use them for before/after frontend
 * comparisons and request-count budgets, never as production SLAs.
 *
 * Each journey records { ms, requests } where `requests` is the number of
 * backend API calls the journey triggered (counted by the stub), so
 * duplicate-request regressions are visible as a count, not a guess.
 */

type Sample = { ms: number; requests: number };

const samples: Record<string, Sample[]> = {};

test.afterAll(async () => {
  const project = test.info().project.name;
  console.log('PERF_SAMPLES ' + JSON.stringify({ project, samples }));
});

function record(journey: string, sample: Sample): void {
  (samples[journey] ??= []).push(sample);
}

/** Wall-clock around a journey, plus the backend calls it triggered. */
async function timed<T>(backend: { requests: unknown[] }, journey: string, run: () => Promise<T>): Promise<T> {
  const before = backend.requests.length;
  const t0 = Date.now();
  const result = await run();
  record(journey, { ms: Date.now() - t0, requests: backend.requests.length - before });
  return result;
}

test.describe('perf timings (SIMULATED - mocked backend)', () => {
  test('sign-in to dashboard usable', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await timed(backend, 'signIn-to-dashboard', async () => {
      await signIn(page, { backend, scope: { program: 'ARTS', zone: 'TEST' } });
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });

    expect(pageErrors).toEqual([]);
  });

  test('route navigation to participants and homes, cold and warm', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'TEST' } });

    await timed(backend, 'nav-participants-cold', async () => {
      await page.goto('/#/participants');
      await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    });

    await timed(backend, 'nav-homes-cold', async () => {
      await page.goto('/#/homes');
      await expect(page).toHaveURL(/#\/homes/);
    });

    await timed(backend, 'nav-participants-warm', async () => {
      await page.goto('/#/participants');
      await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    });

    expect(pageErrors).toEqual([]);
  });

  test('repeated navigation keeps request counts flat (no duplicate requests per view)', async ({
    page,
    backend,
  }) => {
    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'TEST' } });

    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    const afterFirst = backend.requests.length;

    await page.goto('/#/dashboard');
    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    const secondVisit = backend.requests.length - afterFirst;

    record('participants-revisit-requests', { ms: 0, requests: secondVisit });

    // The revisit may legitimately re-read mutable lists, but must never
    // fan out into per-row or duplicate-per-action request storms.
    expect(secondVisit).toBeLessThan(15);
  });

  test('zone switch round trip (scope chip -> program -> zone -> dashboard)', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'TEST' } });

    await timed(backend, 'zone-switch-roundtrip', async () => {
      await page.locator('.nk-scope-chip').click();
      await expect(page).toHaveURL(/#\/select-program/);
      await page.getByRole('button', { name: /Sports meets and tournaments/ }).click();
      await expect(page).toHaveURL(/#\/select-zone/);
      await page.getByRole('button', { name: /Zone 2 Live/ }).click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });

    expect(pageErrors).toEqual([]);
  });
});
