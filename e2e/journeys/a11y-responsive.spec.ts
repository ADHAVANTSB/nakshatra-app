import { readFileSync } from 'node:fs';

import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';
import type { Page } from '@playwright/test';

/**
 * Accessibility smoke (axe-core) and responsive emulation checks.
 *
 * - axe runs on the desktop project only; mobile/tablet cover layout.
 * - Device viewports are EMULATION â€” no physical devices are exercised.
 * - Automated axe results are a smoke check, NOT a WCAG compliance claim.
 *   Manual review remains necessary (see the QA report).
 */

const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

const EVENT = {
  id: 'event-1',
  eventCode: 'AR-01',
  name: 'Watercolour Painting',
  category: 'ARTS',
  mode: 'SOLO',
  eligibleLevels: ['SUB_JUNIOR', 'JUNIOR'],
  status: 'ACTIVE',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

const PARTICIPANT = {
  id: 'p-1',
  participantCode: 'P-001',
  shelterHomeId: 'home-1',
  fullName: 'Arun Kumar',
  gender: 'MALE',
  age: 12,
  standard: 7,
  level: 'SUB_JUNIOR',
  eligibilityStatus: 'ELIGIBLE',
  validationStatus: 'PASSED',
  approvalStatus: 'APPROVED',
  lockStatus: 'UNLOCKED',
  version: 1,
  createdAt: '2026-09-02T08:00:00.000Z',
  createdBy: 'e2e-stub',
  updatedAt: '2026-09-02T08:00:00.000Z',
  updatedBy: 'e2e-stub',
};

function installCatalogue(backend: BackendStub): void {
  backend.on('listEvents', () => ({ body: { success: true, data: { events: [EVENT] } } }));
  backend.on('listShelterHomes', () => ({
    body: {
      success: true,
      data: {
        shelterHomes: [{
          id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home',
          address: '12 Lake Road', contactName: '', contactPhone: '', status: 'ACTIVE',
          version: 1, sourceStatus: 'CONNECTED',
        }],
      },
    },
  }));
  backend.on('listParticipants', () => ({ body: { success: true, data: { participants: [PARTICIPANT] } } }));
  backend.on('listEventRegistrations', () => ({
    body: {
      success: true,
      data: {
        participantEvents: [{
          id: 'reg-1', participantId: 'p-1', eventId: 'event-1',
          registrationStatus: 'REGISTERED', version: 1,
        }],
      },
    },
  }));
  backend.on('listAttendance', () => ({ body: { success: true, data: { attendance: [] } } }));
  // D-Day (home-level) attendance: the sweep expects a usable attendance
  // page, so the participant is checked in for the event day.
  backend.on('listEventDayRegistrations', () => ({
    body: {
      success: true,
      data: {
        eventDayRegistrations: [{
          participantId: 'p-1', shelterHomeId: 'home-1', checkInStatus: 'CHECKED_IN',
          checkedInAt: '2026-09-01T08:00:00.000Z', checkedInBy: 'e2e-stub', version: 1,
        }],
      },
    },
  }));
}

/** No unintended horizontal overflow: content must not exceed the viewport. */
async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow detected').toBeLessThanOrEqual(0);
}

test.describe('responsive emulation sweep', () => {
  test('key pages fit the viewport and keep their controls usable', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);

    // Sign-in page (fresh context state is exercised by the login spec; here
    // the authenticated sweep matters).
    for (const [path, heading] of [
      ['/#/dashboard', 'Dashboard'],
      ['/#/homes', 'Shelter Homes'],
      ['/#/participants', 'Participants'],
      ['/#/events', 'Events'],
      ['/#/attendance', 'Attendance'],
      ['/#/results', 'Results'],
      ['/#/certificates', 'Certificates'],
      ['/#/reports', 'Reports'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }

    // Attendance becomes usable once an event is selected: rows must be
    // reachable (scrollable container is fine; the page must not overflow).
    await page.goto('/#/attendance');
    await page.locator('button.event-card').first().click();
    await expect(page.getByText('Arun Kumar')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(rowButtons(page, 'Present')).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test('the mobile navigation drawer opens and navigates', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-chromium', 'mobile drawer is a mobile-viewport behaviour');

    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    // The mobile drawer opens from the header menu button.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawerLink = page.locator('aside.nk-mobile-drawer').getByRole('link', { name: 'Shelter Homes' });
    await drawerLink.click();

    await expect(page).toHaveURL(/#\/homes/);
    await expect(page.getByRole('heading', { name: 'Shelter Homes', exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });
});

function rowButtons(page: Page, name: string) {
  return page.locator('tbody tr').filter({ hasText: 'Arun Kumar' }).getByRole('button', { name });
}

test.describe('accessibility smoke (axe-core, desktop)', () => {
  test('login page has no critical or serious axe violations', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'axe sweep runs on the desktop project only');

    await page.goto('/#/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<AxeResults> } }).axe.run({}));

    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });

  test('authenticated key pages have no critical or serious axe violations', async ({ page, backend }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'axe sweep runs on the desktop project only');
    await signIn(page);
    installCatalogue(backend);
    await page.addScriptTag({ content: axeSource });

    for (const [path, heading] of [
      ['/#/dashboard', 'Dashboard'],
      ['/#/homes', 'Shelter Homes'],
      ['/#/participants', 'Participants'],
      ['/#/events', 'Events'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await page.addScriptTag({ content: axeSource });
      const results = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<AxeResults> } }).axe.run({}));
      const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
      expect(blocking, `${path}: ${describeViolations(blocking)}`).toEqual([]);
    }
  });

  test('attendance page has no critical or serious axe violations', async ({ page, backend }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'axe sweep runs on the desktop project only');
    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/attendance');
    await page.locator('button.event-card').first().click();
    await expect(page.getByText('Arun Kumar')).toBeVisible();

    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<AxeResults> } }).axe.run({}));
    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });
});

interface AxeResults {
  violations: Array<{
    id: string;
    impact: string | null;
    help: string;
    nodes: Array<{ target: string[] }>;
  }>;
}

function describeViolations(violations: AxeResults['violations']): string {
  return violations
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help} â€” ${violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join('; ')}`)
    .join('\n');
}

