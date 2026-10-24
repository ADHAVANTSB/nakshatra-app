import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * Zone-switch isolation journeys — MOCKED.
 *
 * Regression guards for the live-zone leakage report: a participant that
 * belongs to TEST (or any other scope) must never be visible, even briefly,
 * in another zone's views - and opening one must show the backend's friendly
 * scope-mismatch message instead of a broken edit form.
 *
 * True enforcement lives in the backend (backend-verification/
 * test-scope-audit.js + test-zone-isolation.js). These journeys prove the
 * FRONTEND half: caches and in-flight requests never cross a scope switch.
 */

const ZONE_ONE_PARTICIPANT = {
  id: 'p-zone1',
  participantCode: 'P-901',
  shelterHomeId: 'home-zone1',
  fullName: 'Zed Zone One',
  gender: 'MALE',
  age: 14,
  standard: 8,
  level: 'JUNIOR',
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

const ZONE_ONE_HOME = {
  id: 'home-zone1',
  homeCode: 'SH-901',
  homeName: 'Zone One Home',
  address: '1 Zone Way',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
  sourceStatus: 'CONNECTED',
};

function installZoneOne(backend: BackendStub): void {
  backend.on('listEvents', () => ({ body: { success: true, data: { events: [] } } }));
  backend.on('listShelterHomes', () => ({
    body: { success: true, data: { shelterHomes: [ZONE_ONE_HOME] } },
  }));
  backend.on('listParticipants', () => ({
    body: { success: true, data: { participants: [ZONE_ONE_PARTICIPANT] } },
  }));
  backend.on('listParticipantEvents', () => ({
    body: { success: true, data: { participantEvents: [] } },
  }));
  backend.on('getParticipantEventSummaries', () => ({
    body: { success: true, data: { summaries: [], issues: [] } },
  }));
}

test.describe('zone-switch isolation', () => {
  test('switching the zone drops the previous zone rows (empty zone shows the empty state)', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'ZONE_1' } });
    installZoneOne(backend);

    await page.goto('/#/participants');
    await expect(page.locator('body')).toContainText('Zed Zone One');

    // The switched-to zone has no data (a fresh live zone starts empty):
    // the stub answers like a scoped backend for the new scope.
    backend.on('listShelterHomes', () => ({ body: { success: true, data: { shelterHomes: [] } } }));
    backend.on('listParticipants', () => ({ body: { success: true, data: { participants: [] } } }));

    await page.locator('.nk-scope-chip').click();
    await expect(page).toHaveURL(/#\/select-program/);
    await page.getByRole('button', { name: /Sports meets and tournaments/ }).click();
    await expect(page).toHaveURL(/#\/select-zone/);
    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();
    await expect(page).toHaveURL(/#\/dashboard/);

    // Nothing from the previous zone survives the switch.
    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Zed Zone One');
    await expect(page.locator('body')).toContainText('No participants yet');
    expect(pageErrors).toEqual([]);
  });

  test('an in-flight read for the previous zone never lands after a rapid switch', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'ZONE_1' } });
    installZoneOne(backend);

    // The first participant read hangs in flight; every later read answers
    // for the new (empty) scope - exactly like a scoped backend would.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let participantReads = 0;
    backend.on('listParticipants', async () => {
      participantReads += 1;
      if (participantReads === 1) {
        await firstGate;
        return {
          body: { success: true, data: { participants: [ZONE_ONE_PARTICIPANT] } },
        };
      }
      return { body: { success: true, data: { participants: [] } } };
    });

    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();

    // Rapid zone switching while the previous scope's read is still open.
    await page.locator('.nk-scope-chip').click();
    await page.getByRole('button', { name: /Sports meets and tournaments/ }).click();
    await page.getByRole('button', { name: /Nakshatra Arts 25OCT/ }).click();
    await expect(page).toHaveURL(/#\/dashboard/);

    releaseFirst();
    await page.goto('/#/participants');

    // The stale response was discarded: the old-zone row never appears.
    await expect(page.locator('body')).not.toContainText('Zed Zone One');
    await expect(page.locator('body')).toContainText('No participants yet');
    expect(pageErrors).toEqual([]);
  });

  test('opening a record of another scope shows the friendly scope-mismatch message, never a broken form', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page, { backend, scope: { program: 'ARTS', zone: 'ZONE_1' } });
    installZoneOne(backend);

    // The backend refuses a TEST-scope record from a Zone 1 session exactly
    // as the live deployment does (wording from scopeMismatchResponse).
    backend.on('getParticipant', () => ({
      body: {
        success: false,
        error: {
          code: 'SCOPE_MISMATCH',
          message:
            'This record belongs to Unassigned programme · TEST and is outside ' +
            'your selected programme and zone.',
          recordProgramId: '',
          recordEnvironmentId: 'TEST',
        },
      },
    }));

    await page.goto('/#/participants');
    await expect(page.locator('body')).toContainText('Zed Zone One');
    await page.locator('tbody tr').first().getByRole('button', { name: 'View / Edit' }).click();

    await expect(page.locator('.detail-card')).toBeVisible();
    await expect(page.locator('.detail-card')).toContainText(
      'This record belongs to Unassigned programme · TEST and is outside your selected programme and zone.',
    );

    // No edit form is opened for a record the user may not see.
    await expect(page.locator('.detail-card').getByRole('button', { name: 'Save' })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
