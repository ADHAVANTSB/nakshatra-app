import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { Page } from '@playwright/test';
import type { BackendStub } from '../stubs/backend';

/**
 * Event-day registration journey (home lock -> event-day check-in ->
 * competition registration) — MOCKED.
 *
 * The three gates are exercised in order against a stateful stub:
 *   1. a home's sheet must be confirmed + LOCKED before its participants
 *      enter the event-day check-in queue,
 *   2. the one-time event-day check-in must complete before any competition
 *      registration is possible (and the check-in itself registers nobody
 *      and marks no attendance),
 *   3. only then does the existing registerParticipant flow accept the
 *      participant into a competition.
 */

const homeCard = (page: Page, name: string) =>
  page.locator('.connected-home-card').filter({ hasText: name });

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

interface FlowState {
  locked: boolean;
  checkedIn: boolean;
  registered: boolean;
}

/** Installs stateful stubs whose answers follow the lock/check-in state. */
function installFlow(backend: BackendStub, state: FlowState): void {
  backend.on('listShelterHomes', () => ({
    body: {
      success: true,
      data: {
        shelterHomes: [{
          id: 'home-1',
          homeCode: 'SH-001',
          homeName: 'Sunshine Childrens Home',
          address: '12 Lake Road',
          contactName: 'Office Desk',
          contactPhone: '555-0100',
          status: 'ACTIVE',
          version: 1,
          spreadsheetName: 'Sunshine Home Register',
          sourceStatus: 'CONNECTED',
          sheetStatus: state.locked ? 'LOCKED' : 'NOT_CONFIRMED',
          ...(state.locked
            ? {
                sheetConfirmedAt: '2026-10-20T09:00:00.000Z',
                sheetConfirmedBy: 'Praveen (E2E)',
                sheetLockedAt: '2026-10-20T09:00:00.000Z',
                sheetLockedBy: 'Praveen (E2E)',
              }
            : {}),
        }],
      },
    },
  }));

  backend.on('listParticipants', () => ({
    body: { success: true, data: { participants: [PARTICIPANT] } },
  }));

  backend.on('listEvents', () => ({
    body: { success: true, data: { events: [EVENT] } },
  }));

  backend.on('listEventDayRegistrations', () => ({
    body: {
      success: true,
      data: {
        eventDayRegistrations: state.locked
          ? [{
              participantId: PARTICIPANT.id,
              participantCode: PARTICIPANT.participantCode,
              fullName: PARTICIPANT.fullName,
              level: PARTICIPANT.level,
              shelterHomeId: PARTICIPANT.shelterHomeId,
              homeName: 'Sunshine Childrens Home',
              homeSheetStatus: 'LOCKED',
              checkInStatus: state.checkedIn ? 'CHECKED_IN' : 'NOT_REGISTERED',
              checkedInAt: state.checkedIn ? '2026-10-20T09:30:00.000Z' : '',
              checkedInBy: state.checkedIn ? 'Praveen (E2E)' : '',
              version: 1,
            }]
          : [],
      },
    },
  }));

  backend.on('confirmHomeSheet', () => {
    state.locked = true;
    return {
      body: {
        success: true,
        data: {
          sheetConfirmation: {
            id: 'conf-1',
            shelterHomeId: 'home-1',
            status: 'LOCKED',
            confirmedAt: '2026-10-20T09:00:00.000Z',
            confirmedBy: 'Praveen (E2E)',
            lockedAt: '2026-10-20T09:00:00.000Z',
            lockedBy: 'Praveen (E2E)',
            version: 1,
          },
        },
      },
    };
  });

  backend.on('markEventDayRegistration', () => {
    state.checkedIn = true;
    return {
      body: {
        success: true,
        data: {
          eventDayRegistration: {
            id: 'edr-1',
            participantId: PARTICIPANT.id,
            shelterHomeId: PARTICIPANT.shelterHomeId,
            status: 'CHECKED_IN',
            checkedInAt: '2026-10-20T09:30:00.000Z',
            checkedInBy: 'Praveen (E2E)',
            version: 1,
          },
        },
      },
    };
  });

  // The bulk save the UI uses: ONE request, many records.
  backend.on('saveEventDayAttendanceBatch', (request) => {
    const items = ((request['payload'] as { items?: unknown[] })?.items ?? []) as Array<{
      participantId: string;
      status: 'CHECKED_IN' | 'NOT_REGISTERED';
      expectedVersion?: number;
    }>;
    const results = items.map((item) => {
      if (item.participantId === PARTICIPANT.id) {
        state.checkedIn = item.status === 'CHECKED_IN';
      }
      return {
        participantId: item.participantId,
        outcome: (item.expectedVersion ?? 0) === 0 ? 'CREATED' : 'UPDATED',
        status: item.status,
        version: (item.expectedVersion ?? 0) + 1,
      };
    });
    return {
      body: {
        success: true,
        data: {
          results,
          summary: {
            total: results.length,
            created: results.filter((r) => r.outcome === 'CREATED').length,
            updated: results.filter((r) => r.outcome === 'UPDATED').length,
            unchanged: 0,
            versionConflicts: 0,
            invalid: 0,
          },
        },
      },
    };
  });

  backend.on('listEventRegistrations', () => ({
    body: {
      success: true,
      data: {
        participantEvents: state.registered
          ? [{
              id: 'pe-1',
              participantId: PARTICIPANT.id,
              eventId: EVENT.id,
              registrationStatus: 'REGISTERED',
              version: 1,
            }]
          : [],
      },
    },
  }));

  backend.on('registerParticipant', () => {
    state.registered = true;
    return {
      body: {
        success: true,
        data: {
          participantEvent: {
            id: 'pe-1',
            participantId: PARTICIPANT.id,
            eventId: EVENT.id,
            registrationStatus: 'REGISTERED',
            version: 1,
          },
        },
      },
    };
  });
}

const eventDaySection = (page: Page) =>
  page.locator('.section-card').filter({ hasText: 'Event Day Check-In' });

test.describe('event-day registration: home lock, check-in, competition registration', () => {
  test('lock -> check-in -> register for a competition, in that order', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state: FlowState = { locked: false, checkedIn: false, registered: false };

    await signIn(page);
    installFlow(backend, state);

    // --- 1. Confirm & lock the home sheet on the Homes page.
    await page.goto('/#/homes');
    const card = homeCard(page, 'Sunshine Childrens Home');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Confirm & Lock Sheet' }).click();

    await expect(page.locator('.nk-toast').filter({ hasText: 'confirmed and locked' })).toBeVisible();
    await expect(card).toContainText('Locked');
    await expect(card.getByRole('button', { name: 'Unlock for correction' })).toBeVisible();

    // --- 2. The locked home's participant now appears in the event-day queue.
    await page.goto('/#/participants?section=checkin');
    const section = eventDaySection(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText('One check-in for the overall event day');

    const row = section.locator('tr').filter({ hasText: 'Arun Kumar' });
    await expect(row).toContainText('Sunshine Childrens Home');
    await expect(row).toContainText('Home sheet confirmed and locked');
    await expect(row).toContainText('Not registered');

    // Check-in is staged locally and saved in ONE batch request; it never
    // registers anyone itself and never marks attendance.
    const requestCountBefore = backend.requests.length;
    await row.getByRole('button', { name: 'Present' }).click();
    await expect(row).toContainText('Unsaved');
    // Toggling is local: no request left the browser for the click.
    expect(backend.requests.length).toBe(requestCountBefore);

    await section.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(section.locator('.alert.success')).toContainText('Attendance saved for 1 participant');
    await expect(row).toContainText('Checked in');

    const batchSaves = backend.requests.filter((request) => request.action === 'saveEventDayAttendanceBatch');
    expect(batchSaves).toHaveLength(1);
    expect((batchSaves[0].payload as { items: unknown[] }).items).toHaveLength(1);
    // The legacy one-by-one action is not used by this UI any more.
    expect(backend.requests.some((request) => request.action === 'markEventDayRegistration')).toBe(false);
    expect(backend.requests.filter((request) => request.action === 'registerParticipant')).toHaveLength(0);
    expect(backend.requests.some((request) => request.action === 'markAttendance')).toBe(false);

    // A full reload restores the check-in state from the persisted record
    // (the app boots to the dashboard, so navigate back to the queue).
    await page.reload();
    await page.goto('/#/participants?section=checkin');
    await expect(eventDaySection(page).locator('tr').filter({ hasText: 'Arun Kumar' })).toContainText('Checked in');

    // --- 3. Only now is the participant registrable for a competition.
    await page.goto('/#/events');
    await page.getByRole('button', { name: /Watercolour Painting/ }).click();
    await page.locator('.event-card').filter({ hasText: 'Watercolour Painting' })
      .locator('button').filter({ hasText: 'Participants' }).click();

    const drawer = page.locator('.participant-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Add Participant/ }).click();

    const panel = page.locator('.add-participant-panel');
    await expect(panel.locator('.candidate-card').filter({ hasText: 'Arun Kumar' })).toBeVisible();
    await panel.locator('.candidate-card').filter({ hasText: 'Arun Kumar' }).click();
    // The footer button sits in the drawer, outside the panel div.
    await page.getByRole('button', { name: 'Register Participant' }).click();

    await expect(page.locator('.nk-toast').filter({ hasText: 'Participant registered.' })).toBeVisible();
    const registrations = backend.requests.filter((request) => request.action === 'registerParticipant');
    expect(registrations).toHaveLength(1);
    expect(registrations[0].payload).toMatchObject({ participantId: 'p-1', eventId: 'event-1' });
    expect(pageErrors).toEqual([]);
  });

  test('before the lock: records stay visible, but the queue and registration stay closed', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state: FlowState = { locked: false, checkedIn: false, registered: false };

    await signIn(page);
    installFlow(backend, state);

    // The participant record is fully visible before any confirmation.
    await page.goto('/#/participants?section=checkin');
    await expect(page.locator('body')).toContainText('Arun Kumar');
    await expect(page.locator('body')).toContainText('Participant record exists');
    // No event-day queue may exist for a non-locked home.
    await expect(eventDaySection(page)).toHaveCount(0);

    // And no competition registration candidate is offered.
    await page.goto('/#/events');
    await page.getByRole('button', { name: /Watercolour Painting/ }).click();
    await page.locator('.event-card').filter({ hasText: 'Watercolour Painting' })
      .locator('button').filter({ hasText: 'Participants' }).click();

    const drawer = page.locator('.participant-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Add Participant/ }).click();
    await expect(page.locator('.add-participant-panel')).toContainText('No participants available');

    expect(backend.requests.filter((request) => request.action === 'registerParticipant')).toHaveLength(0);
    expect(backend.requests.some((request) => request.action === 'markEventDayRegistration')).toBe(false);
    expect(backend.requests.some((request) => request.action === 'saveEventDayAttendanceBatch')).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});

// ================================================================
// BULK EVENT-DAY ATTENDANCE (staged Present/Absent, ONE batch save)
// ================================================================

const PARTICIPANT_2 = {
  ...PARTICIPANT,
  id: 'p-2',
  participantCode: 'P-002',
  fullName: 'Meena Devi',
};

interface BulkState {
  status: Record<string, 'CHECKED_IN' | 'NOT_REGISTERED'>;
  version: Record<string, number>;
  /** participantIds whose NEXT save result is INVALID (partial failure). */
  failOnce: Set<string>;
}

/** Stateful stubs for a two-participant event-day queue with a batch save. */
function installBulk(backend: BackendStub, state: BulkState): void {
  backend.on('listShelterHomes', () => ({
    body: {
      success: true,
      data: {
        shelterHomes: [{
          id: 'home-1',
          homeCode: 'SH-001',
          homeName: 'Sunshine Childrens Home',
          address: '12 Lake Road',
          contactName: 'Office Desk',
          contactPhone: '555-0100',
          status: 'ACTIVE',
          version: 1,
          spreadsheetName: 'Sunshine Home Register',
          sourceStatus: 'CONNECTED',
          sheetStatus: 'LOCKED',
          sheetConfirmedAt: '2026-10-20T09:00:00.000Z',
          sheetConfirmedBy: 'Praveen (E2E)',
          sheetLockedAt: '2026-10-20T09:00:00.000Z',
          sheetLockedBy: 'Praveen (E2E)',
        }],
      },
    },
  }));

  backend.on('listParticipants', () => ({
    body: { success: true, data: { participants: [PARTICIPANT, PARTICIPANT_2] } },
  }));

  backend.on('listEvents', () => ({
    body: { success: true, data: { events: [EVENT] } },
  }));

  backend.on('listEventDayRegistrations', () => ({
    body: {
      success: true,
      data: {
        eventDayRegistrations: [PARTICIPANT, PARTICIPANT_2].map((participant) => ({
          participantId: participant.id,
          participantCode: participant.participantCode,
          fullName: participant.fullName,
          level: participant.level,
          shelterHomeId: participant.shelterHomeId,
          homeName: 'Sunshine Childrens Home',
          homeSheetStatus: 'LOCKED',
          checkInStatus: state.status[participant.id] ?? 'NOT_REGISTERED',
          checkedInAt: state.status[participant.id] === 'CHECKED_IN' ? '2026-10-20T09:30:00.000Z' : '',
          checkedInBy: state.status[participant.id] === 'CHECKED_IN' ? 'Praveen (E2E)' : '',
          version: state.version[participant.id] ?? 0,
        })),
      },
    },
  }));

  backend.on('saveEventDayAttendanceBatch', (request) => {
    const items = ((request['payload'] as { items?: unknown[] })?.items ?? []) as Array<{
      participantId: string;
      status: 'CHECKED_IN' | 'NOT_REGISTERED';
      expectedVersion?: number;
    }>;

    const results = items.map((item) => {
      if (state.failOnce.has(item.participantId)) {
        state.failOnce.delete(item.participantId);
        return {
          participantId: item.participantId,
          outcome: 'INVALID',
          code: 'HOME_SHEET_NOT_LOCKED',
          message: 'Confirm and lock this home’s sheet before recording the event-day check-in.',
          status: state.status[item.participantId] ?? 'NOT_REGISTERED',
          version: state.version[item.participantId] ?? 0,
        };
      }

      const current = state.version[item.participantId] ?? 0;
      state.version[item.participantId] = current + 1;
      state.status[item.participantId] = item.status;
      return {
        participantId: item.participantId,
        outcome: current === 0 ? 'CREATED' : 'UPDATED',
        status: item.status,
        version: current + 1,
      };
    });

    return {
      body: {
        success: true,
        data: {
          results,
          summary: {
            total: results.length,
            created: results.filter((r) => r.outcome === 'CREATED').length,
            updated: results.filter((r) => r.outcome === 'UPDATED').length,
            unchanged: 0,
            versionConflicts: 0,
            invalid: results.filter((r) => r.outcome === 'INVALID').length,
          },
        },
      },
    };
  });
}

test.describe('event-day bulk attendance: staged Present/Absent saved in ONE batch', () => {
  test('stages with no requests and saves the whole list in a single batch call', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state: BulkState = { status: { 'p-2': 'CHECKED_IN' }, version: { 'p-2': 1 }, failOnce: new Set() };

    await signIn(page);
    installBulk(backend, state);
    await page.goto('/#/participants?section=checkin');

    const section = eventDaySection(page);
    await expect(section).toBeVisible();

    // Stage locally on two rows: zero network per click.
    await section.locator('tr').filter({ hasText: 'Arun Kumar' }).getByRole('button', { name: 'Present' }).click();
    await expect(section).toContainText('1 unsaved');

    // Count after the first click: a settled page must issue NOTHING for
    // the second click.
    const settledRequestCount = backend.requests.length;
    await section.locator('tr').filter({ hasText: 'Meena Devi' }).getByRole('button', { name: 'Absent' }).click();
    await expect(section).toContainText('2 participants');
    await expect(section).toContainText('2 unsaved');
    expect(backend.requests.length).toBe(settledRequestCount);
    expect(backend.requests.some((request) => request.action === 'saveEventDayAttendanceBatch')).toBe(false);

    await section.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(section.locator('.alert.success')).toContainText('Attendance saved for 2 participants');

    const batchSaves = backend.requests.filter((request) => request.action === 'saveEventDayAttendanceBatch');
    expect(batchSaves).toHaveLength(1);
    expect((batchSaves[0].payload as { items: Array<{ participantId: string }> }).items.map((item) => item.participantId).sort())
      .toEqual(['p-1', 'p-2']);

    await expect(section.locator('tr').filter({ hasText: 'Arun Kumar' })).toContainText('Checked in');
    await expect(section.locator('tr').filter({ hasText: 'Meena Devi' })).toContainText('Not registered');
    await expect(section).toContainText('0 unsaved');
    expect(pageErrors).toEqual([]);
  });

  test('partial failure: successes preserved, per-record failure shown, retry sends ONLY the failed record', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state: BulkState = { status: {}, version: {}, failOnce: new Set(['p-2']) };

    await signIn(page);
    installBulk(backend, state);
    await page.goto('/#/participants?section=checkin');

    const section = eventDaySection(page);
    await section.getByRole('button', { name: 'Select All Present' }).click();
    await section.getByRole('button', { name: 'Save Attendance' }).click();

    // Saved and failed counts are reported; the failure reason shows on
    // the failed row and its change stays staged.
    await expect(section.locator('.alert.success')).toContainText('1 failed');
    await expect(section).toContainText('Confirm and lock this home’s sheet');
    const failedRow = section.locator('tr').filter({ hasText: 'Meena Devi' });
    await expect(failedRow).toContainText('Unsaved');
    await expect(failedRow).toContainText('Confirm and lock');
    await expect(section.locator('tr').filter({ hasText: 'Arun Kumar' })).toContainText('Checked in');
    await expect(section.locator('tr').filter({ hasText: 'Arun Kumar' })).not.toContainText('Unsaved');

    const firstSave = backend.requests.filter((request) => request.action === 'saveEventDayAttendanceBatch');
    expect(firstSave).toHaveLength(1);

    // Retry re-submits ONLY the failed record; the saved one is untouched.
    await section.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(section.locator('.alert.success')).toContainText('Attendance saved for 1 participant');
    await expect(section).toContainText('0 failed');

    const saves = backend.requests.filter((request) => request.action === 'saveEventDayAttendanceBatch');
    expect(saves).toHaveLength(2);
    expect((saves[1].payload as { items: Array<{ participantId: string }> }).items.map((item) => item.participantId))
      .toEqual(['p-2']);
    await expect(failedRow).not.toContainText('Unsaved');
    await expect(failedRow).toContainText('Checked in');
    expect(pageErrors).toEqual([]);
  });

  test('Reset Unsaved Changes restores the last backend-confirmed state with no request', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state: BulkState = { status: { 'p-1': 'CHECKED_IN' }, version: { 'p-1': 1 }, failOnce: new Set() };

    await signIn(page);
    installBulk(backend, state);
    await page.goto('/#/participants?section=checkin');

    const section = eventDaySection(page);
    const row = section.locator('tr').filter({ hasText: 'Arun Kumar' });
    await expect(row).toContainText('Checked in');

    await row.getByRole('button', { name: 'Absent' }).click();
    await expect(row).toContainText('Not registered (unsaved)');

    const requestCountBefore = backend.requests.length;
    await section.getByRole('button', { name: 'Reset Unsaved Changes' }).click();

    await expect(row).toContainText('Checked in');
    await expect(row).not.toContainText('unsaved');
    // Discarding is local: nothing was written or read for it.
    expect(backend.requests.length).toBe(requestCountBefore);
    expect(backend.requests.some((request) => request.action === 'saveEventDayAttendanceBatch')).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
