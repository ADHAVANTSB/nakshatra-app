import { expect, monitorPageErrors, signIn, test, adminUser, certificateTeamUser } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Navigation and role-gating journeys (checklist areas A-12…A-14 + J-01).
 *
 * The section→role mapping is enforced by the frontend guards AND the
 * navigation; the backend remains the authorization authority (frontend
 * checks alone are UX, not security).
 */

const ADMIN_NAV = ['Dashboard', 'Events', 'Shelter Homes', 'Participants', 'Attendance', 'Judging', 'Scores', 'Results', 'Certificates', 'Reports'];

/**
 * One section link in the role-driven navigation. The accessible name carries
 * the icon glyph ("📊, Dashboard"), so the label is matched at the END of the
 * name — plain substring matching would be too loose for multi-word labels.
 */
const sectionLink = (page: Page, label: string) =>
  test.info().project.name === 'mobile-chromium'
    ? page.locator('aside.nk-mobile-drawer').getByRole('link', { name: new RegExp(label + '$') })
    : page.locator('aside.nk-sidebar').getByRole('link', { name: new RegExp(label + '$') });

/**
 * Navigates through the role-driven navigation. On the mobile emulation the
 * nav lives in a drawer that must be opened first.
 */
async function navigateViaNav(page: Page, label: string): Promise<void> {
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('aside.nk-mobile-drawer')).toBeVisible();
  }
  await sectionLink(page, label).click();
}

test.describe('navigation and role gating', () => {
  test('an unauthenticated visitor is kept out of protected routes', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await page.goto('/#/homes');

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('an admin sees the full navigation and reaches each section', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    // The full nav is role-driven: every section link is present. On mobile
    // the nav lives in a drawer that is opened for the check.
    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    for (const label of ADMIN_NAV) {
      await expect(sectionLink(page, label)).toHaveCount(1);
    }

    // The drawer is already open on mobile; the click closes it afterwards.
    await sectionLink(page, 'Participants').click();
    await expect(page).toHaveURL(/#\/participants/);

    await navigateViaNav(page, 'Shelter Homes');
    await expect(page).toHaveURL(/#\/homes/);
    expect(pageErrors).toEqual([]);
  });

  test('the merged navigation keeps exactly one Results entry and no Results Approval entry', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    // One "Results" workspace: the approval page merged into it.
    await expect(sectionLink(page, 'Results')).toHaveCount(1);
    await expect(sectionLink(page, 'Results Approval')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('the legacy /results-approval URL redirects into the unified Results workspace', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    await page.goto('/#/results-approval');

    await expect(page).toHaveURL(/#\/results/);
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('a limited role sees only its permitted sections', async ({ page, backend }) => {
    // CERTIFICATE_TEAM is allowed: Dashboard, Results, Certificates only.
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { user: certificateTeamUser, backend });

    // The limited nav is role-driven. On mobile the drawer is opened for the
    // check; permitted links exist, forbidden ones do not exist at all.
    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(sectionLink(page, 'Certificates')).toHaveCount(1);
    await expect(sectionLink(page, 'Results')).toHaveCount(1);
    await expect(sectionLink(page, 'Shelter Homes')).toHaveCount(0);
    await expect(sectionLink(page, 'Participants')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a limited role is redirected away from a forbidden direct URL', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { user: certificateTeamUser, backend });

    await page.goto('/#/participants');

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('a non-admin cannot reach the settings section', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { user: certificateTeamUser, backend });

    // No settings link reachable in the navigation (on mobile the sidebar is
    // an attached-but-hidden drawer, so hidden covers both cases)…
    await expect(page.locator('a[href="#/settings"]')).toBeHidden();
    // …and a direct URL is redirected to the dashboard by the admin guard.
    await page.goto('/#/settings');
    await expect(page).toHaveURL(/#\/dashboard/);
    expect(pageErrors).toEqual([]);
  });

  test('an admin can reach the settings section', async ({ page }) => {
    await signIn(page);

    await navigateViaNav(page, 'Settings');

    await expect(page).toHaveURL(/#\/settings/);
  });

  test('signing out returns to the sign-in page with a cleared session', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    // The account menu holds the logout control. The button's accessible name
    // comes from its content (avatar, display name, role chip).
    await page.locator('button.nk-user').click();
    await page.getByRole('button', { name: /logout/i }).click();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const persisted = await page.evaluate(() => window.sessionStorage.getItem('nakshatra.applicationSession'));
    expect(persisted).toBeNull();
    expect(pageErrors).toEqual([]);
  });
});
