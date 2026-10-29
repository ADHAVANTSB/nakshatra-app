import { certificateTeamUser, expect, monitorPageErrors, signIn, test, type ScopeSeed } from '../fixtures';

/**
 * Programme & zone scope journeys — MOCKED.
 *
 * After sign-in every user must pass through programme selection (Arts /
 * Sports) and zone selection (the event zone card and the Zone 2 card are
 * offered; Zone 1 stays hidden by organiser decision but is a valid scope)
 * before any
 * scoped page opens. The scope is kept in sessionStorage, survives refreshes,
 * cannot be bypassed by deep links, and is persisted on the server-side
 * session via the selectScope action (stubbed here).
 *
 * The selection screens render in a minimal shell (no sidebar / hamburger /
 * navigation controls). Operational pages keep the full shell. Zone data
 * isolation is enforced by the backend on every request (covered by the
 * backend verification suites); these journeys verify the frontend flow.
 */

const ARTS_ZONE_1: ScopeSeed = { program: 'ARTS', zone: 'ZONE_1' };

test.describe('programme and zone selection flow', () => {
  test('sign-in without a scope lands on programme selection, then Arts → the event zone reaches the dashboard', async ({ page }) => {
    const pageErrors = monitorPageErrors(page);

    // Real selection flow: no scope is pre-seeded.
    await signIn(page, { scope: false });
    await expect(page).toHaveURL(/#\/select-program/);
    await expect(page.getByRole('heading', { name: 'Choose your programme' })).toBeVisible();

    await page.getByRole('button', { name: /Arts, Literary and Cultural events/ }).click();
    await expect(page).toHaveURL(/#\/select-zone/);
    await expect(page.getByRole('heading', { name: 'Choose your zone' })).toBeVisible();
    // Zone page shows the chosen programme.
    await expect(page.getByText(/You are working in/)).toContainText('Arts');
    // Zone 1 card stays hidden (organiser decision); Zone 2 is offered.
    await expect(page.getByRole('button', { name: /Zone 1/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Zone 2/ })).toHaveCount(1);

    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();
    await expect(page).toHaveURL(/#\/dashboard/);

    // Dashboard shows the scope prominently.
    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toBeVisible();
    await expect(scopeCard).toContainText('Arts');
    await expect(scopeCard).toContainText('Nakshatra Arts 25OCT');
    // Header chip mirrors the scope app-wide.
    await expect(page.locator('.nk-scope-chip')).toContainText('Arts');
    await expect(page.locator('.nk-scope-chip')).toContainText('Nakshatra Arts 25OCT');
    expect(pageErrors).toEqual([]);
  });

  test('a seeded Zone 2 scope renders the Zone 2 date on the dashboard', async ({ page }) => {
    // Seeded the way deep links and sessions restore it - this proves the
    // restore path independently of clicking the (now visible) Zone 2 card.
    await signIn(page, { scope: { program: 'ARTS', zone: 'ZONE_2' } });

    await expect(page).toHaveURL(/#\/dashboard/);
    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toContainText('Zone 2');
    await expect(scopeCard).toContainText('Sunday, 1 November 2026');
  });

  test('Sports selection flows through the zone step into the dashboard', async ({ page }) => {
    await signIn(page, { scope: false });

    await page.getByRole('button', { name: /Sports meets and tournaments/ }).click();
    await expect(page).toHaveURL(/#\/select-zone/);
    await expect(page.getByText(/You are working in/)).toContainText('Sports');

    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();
    await expect(page).toHaveURL(/#\/dashboard/);

    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toContainText('Sports');
    await expect(scopeCard).toContainText('Nakshatra Arts 25OCT');
    await expect(page.locator('.nk-scope-chip')).toContainText('Sports');
  });

  test('the event zone shows no invented date and no test-data copy', async ({ page }) => {
    await signIn(page, { scope: false });

    await page.getByRole('button', { name: /Arts, Literary and Cultural events/ }).click();

    const eventCard = page.getByRole('button', { name: /Nakshatra Arts 25OCT/ });
    await expect(eventCard).toBeVisible();
    await expect(eventCard).not.toContainText('to be confirmed');
    await expect(eventCard).not.toContainText('Rehearsal');

    await eventCard.click();
    await expect(page).toHaveURL(/#\/dashboard/);

    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toContainText('Nakshatra Arts 25OCT');
    await expect(scopeCard).toContainText('Nakshatra Arts 25OCT environment');
  });

  test('selection screens render without the sidebar, hamburger or navigation controls', async ({ page }) => {
    await signIn(page, { scope: false });
    await expect(page).toHaveURL(/#\/select-program/);

    // Sidebar, hamburger and expand/collapse controls are gone; branding and
    // the signed-in account stay.
    await expect(page.locator('aside.nk-sidebar')).toHaveCount(0);
    await expect(page.locator('.nk-sidebar-toggle')).toHaveCount(0);
    await expect(page.locator('#sidebar-toggle')).toHaveCount(0);
    await expect(page.locator('.nk-menu-button')).toHaveCount(0);
    await expect(page.locator('.nk-mobile-drawer')).toHaveCount(0);
    await expect(page.locator('.nk-selection-logo')).toBeVisible();
    await expect(page.locator('.nk-selection-shell .nk-user-details strong')).toContainText('Praveen');

    // Zone selection screen gets the same treatment.
    await page.getByRole('button', { name: /Arts, Literary and Cultural events/ }).click();
    await expect(page).toHaveURL(/#\/select-zone/);
    await expect(page.locator('aside.nk-sidebar')).toHaveCount(0);
    await expect(page.locator('.nk-selection-logo')).toBeVisible();
  });

  test('refreshing the dashboard keeps the selected scope', async ({ page }) => {
    await signIn(page, { scope: ARTS_ZONE_1 });

    await page.reload();

    await expect(page).toHaveURL(/#\/dashboard/);
    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toContainText('Arts');
    await expect(scopeCard).toContainText('Zone 1');
  });

  test('deep links into scoped pages without a scope are redirected to programme selection', async ({ page }) => {
    // Session exists but no programme/zone was chosen in this tab.
    await signIn(page, { scope: false });
    await expect(page).toHaveURL(/#\/select-program/);

    await page.goto('/#/participants');
    await expect(page).toHaveURL(/#\/select-program/);

    await page.goto('/#/events');
    await expect(page).toHaveURL(/#\/select-program/);
  });

  test('deep links with a complete scope open the requested page directly', async ({ page }) => {
    await signIn(page, { scope: ARTS_ZONE_1 });

    await page.goto('/#/participants');

    await expect(page).toHaveURL(/#\/participants/);
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    await expect(page.locator('.nk-scope-chip')).toContainText('Zone 1');
  });

  test('deep links with the Test scope open real page content directly', async ({ page }) => {
    await signIn(page, { scope: { program: 'ARTS', zone: 'TEST' } });

    await page.goto('/#/participants');

    await expect(page).toHaveURL(/#\/participants/);
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    await expect(page.locator('.nk-scope-chip')).toContainText('Nakshatra Arts 25OCT');
  });

  test('switching the programme clears the zone and forces a fresh choice', async ({ page }) => {
    await signIn(page, { scope: ARTS_ZONE_1 }); // Arts · Zone 1

    // Switch from the dashboard scope card.
    await page.getByRole('button', { name: 'Switch programme or zone' }).click();
    await expect(page).toHaveURL(/#\/select-program/);

    await page.getByRole('button', { name: /Sports meets and tournaments/ }).click();
    // The zone step is mandatory again — no zone was silently reused.
    await expect(page).toHaveURL(/#\/select-zone/);
    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();

    await expect(page).toHaveURL(/#\/dashboard/);
    const scopeCard = page.getByRole('region', { name: 'Current programme and zone' });
    await expect(scopeCard).toContainText('Sports');
    await expect(scopeCard).toContainText('Nakshatra Arts 25OCT');
    // Header chip reflects the new scope, not the stale one. The programme
    // segment is checked on its own: the zone label "Nakshatra Arts 25OCT"
    // contains the substring "Arts", so a whole-chip negative assertion
    // cannot distinguish programme from zone.
    await expect(page.locator('.nk-scope-chip')).toContainText('Sports');
    await expect(page.locator('.nk-scope-chip-program')).toHaveText('Sports');
  });

  test('switching scope from the header chip works anywhere in the app', async ({ page }) => {
    await signIn(page, { scope: ARTS_ZONE_1 }); // Arts · Zone 1

    await page.locator('.nk-scope-chip').click();
    await expect(page).toHaveURL(/#\/select-program/);

    await page.getByRole('button', { name: /Arts, Literary and Cultural events/ }).click();
    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.nk-scope-chip')).toContainText('Nakshatra Arts 25OCT');
  });

  test('a non-admin with a complete scope still cannot reach the settings section', async ({ page, backend }) => {
    await signIn(page, { user: certificateTeamUser, backend, scope: ARTS_ZONE_1 });

    await page.goto('/#/settings');

    // The section guard still wins; the scope flow does not open admin areas.
    await expect(page).toHaveURL(/#\/dashboard/);
  });

  test('an unauthenticated visitor is redirected to sign-in, not into the scope flow', async ({ page }) => {
    await page.goto('/#/dashboard');

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('programme and zone selection — reference screenshots (desktop only)', () => {
  test('captures the selection flow and scoped dashboard', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'Screenshots are captured once, on the desktop project.');

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const outDir = path.resolve(__dirname, '../../docs/screenshots');
    await fs.mkdir(outDir, { recursive: true });

    await signIn(page, { scope: false });
    await expect(page.getByRole('heading', { name: 'Choose your programme' })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, 'program-selection.png'), fullPage: true });

    await page.getByRole('button', { name: /Arts, Literary and Cultural events/ }).click();
    await expect(page.getByRole('heading', { name: 'Choose your zone' })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, 'zone-selection.png'), fullPage: true });

    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();
    await expect(page.getByRole('region', { name: 'Current programme and zone' })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, 'scoped-dashboard.png'), fullPage: true });
  });
});
