import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * Attendance journeys (checklist area F) — MOCKED.
 *
 * Marks are persisted in an in-memory stub store served by the intercepted
 * `markAttendance`/`listAttendance` actions. Nothing here proves a live
 * Apps Script round-trip; those stay BLOCKED until a test backend exists.
 */

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

const REGISTRATION = {
  id: 'reg-1',
  participantId: 'p-1',
  eventId: 'event-1',
  registrationStatus: 'REGISTERED',
  version: 1,
};

interface Mark {
  id: string;
  participantId: string;
  eventId: string;
  status: 'PRESENT' | 'ABSENT';
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

function makeMark(status: 'PRESENT' | 'ABSENT', version: number): Mark {
  const now = new Date().toISOString();
  return {
    id: `event-1:p-1`,
    participantId: 'p-1',
    eventId: 'event-1',
    status,
    version,
    createdAt: now,
    createdBy: 'e2e-stub',
    updatedAt: now,
    updatedBy: 'e2e-stub',
  };
}

const row = (page: import('@playwright/test').Page) =>
  page.locator('tbody tr').filter({ hasText: 'Arun Kumar' });

const rowStatus = (page: import('@playwright/test').Page) =>
  row(page).locator('.status');

/** Standard catalogue + one SOLO event with one registered participant. */
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
    body: { success: true, data: { participantEvents: [REGISTRATION] } },
  }));
}

test.describe('attendance', () => {
  test('shows persisted marks when the event is opened', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => ({
      body: { success: true, data: { attendance: [makeMark('PRESENT', 2)] } },
    }));

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');

    await expect(row(page)).toBeVisible();
    await expect(rowStatus(page)).toHaveText('Present');
    expect(pageErrors).toEqual([]);
  });

  test('a failed attendance read shows a retry, and retrying recovers the marks', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    let failRead = true;

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => (failRead
      ? { body: { success: false, error: { code: 'ATTENDANCE_READ_FAILED', message: 'The attendance read failed.' } } }
      : { body: { success: true, data: { attendance: [makeMark('ABSENT', 3)] } } }));

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');

    const alert = page.getByRole('alert').filter({ hasText: 'Saved attendance could not be read.' });
    await expect(alert).toBeVisible();
    // Existing marks must never be invented while the read fails.
    await expect(rowStatus(page)).toHaveText('Not marked');

    failRead = false;
    await alert.getByRole('button', { name: 'Retry' }).click();

    await expect(rowStatus(page)).toHaveText('Absent');
    expect(pageErrors).toEqual([]);
  });

  test('marking persists, repeats idempotently and updates with the record version', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const marks: Mark[] = [];

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => ({
      body: { success: true, data: { attendance: [...marks] } },
    }));
    backend.on('markAttendance', (request) => {
      const payload = request.payload as { status: 'PRESENT' | 'ABSENT'; expectedVersion?: number };
      const current = marks.find((mark) => mark.participantId === 'p-1');
      if (current && payload.expectedVersion !== current.version) {
        return {
          body: { success: false, error: { code: 'VERSION_CONFLICT', message: 'Stale version.' } },
        };
      }
      const next = makeMark(payload.status, (current?.version ?? 0) + 1);
      if (current) {
        marks[marks.indexOf(current)] = next;
      } else {
        marks.push(next);
      }
      return { body: { success: true, data: { attendance: next } } };
    });

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');

    await expect(rowStatus(page)).toHaveText('Not marked');

    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(page.getByText('Attendance saved for 1 participant.').first()).toBeVisible();
    await expect(rowStatus(page)).toHaveText('Present');

    // The identical re-save is handled without a conflict error.
    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(page.getByText('Attendance saved for 1 participant.')).toHaveCount(2);
    await expect(rowStatus(page)).toHaveText('Present');

    // Updating reuses the persisted record version, so the backend accepts it.
    await row(page).getByRole('button', { name: 'Absent' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(page.getByText('Attendance saved for 1 participant.').first()).toBeVisible();
    await expect(rowStatus(page)).toHaveText('Absent');

    const markRequests = backend.requests.filter((request) => request.action === 'markAttendance');
    expect(markRequests).toHaveLength(3);
    expect(pageErrors).toEqual([]);
  });

  test('a version conflict reloads the latest saved values and asks to retry', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    // Another coordinator saved ABSENT v3 behind this session's back.
    const marks: Mark[] = [makeMark('ABSENT', 3)];
    let conflictPending = true;

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => ({
      body: { success: true, data: { attendance: [...marks] } },
    }));
    backend.on('markAttendance', (request) => {
      if (conflictPending) {
        conflictPending = false;
        // The "other" write lands: this is what the forced re-read returns.
        marks[0] = makeMark('PRESENT', 4);
        return {
          body: { success: false, error: { code: 'VERSION_CONFLICT', message: 'Stale version.' } },
        };
      }
      const payload = request.payload as { status: 'PRESENT' | 'ABSENT'; expectedVersion?: number };
      const next = makeMark(payload.status, (marks[0]?.version ?? 0) + 1);
      marks[0] = next;
      return { body: { success: true, data: { attendance: next } } };
    });

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');

    await expect(rowStatus(page)).toHaveText('Absent');
    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();

    await expect(page.locator('.alert.error')).toContainText(
      'Attendance was updated elsewhere. The latest saved values have been reloaded.',
    );
    // The forced re-read shows the other coordinator's value, not the stale one.
    await expect(rowStatus(page)).toHaveText('Present');

    // Buttons are usable again and a fresh save is accepted.
    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();
    await expect(page.getByText('Attendance saved for 1 participant.').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('a backend-rejected mark (archived home) surfaces the exact error and marks nothing', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => ({ body: { success: true, data: { attendance: [] } } }));
    backend.on('markAttendance', () => ({
      body: {
        success: false,
        error: {
          code: 'SHELTER_HOME_ARCHIVED',
          message: 'This participant belongs to an archived shelter home.',
        },
      },
    }));

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');
    await expect(rowStatus(page)).toHaveText('Not marked');

    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();

    // The backend message is surfaced verbatim — no local fake success.
    await expect(page.getByText('This participant belongs to an archived shelter home.').first()).toBeVisible();
    await expect(rowStatus(page)).toHaveText('Not marked');
    await expect(row(page).getByRole('button', { name: 'Present' })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test('a failed save never reports success and the row returns to idle', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);
    backend.on('listAttendance', () => ({ body: { success: true, data: { attendance: [] } } }));
    backend.on('markAttendance', () => ({ abort: true }));

    await page.goto('/#/attendance');
    await page.locator('#attendance-event').selectOption('event-1');

    await expect(rowStatus(page)).toHaveText('Not marked');
    await row(page).getByRole('button', { name: 'Present' }).click();
    await page.getByRole('button', { name: 'Save Attendance' }).click();

    await expect(page.getByText('Attendance for Arun Kumar was not saved.').first()).toBeVisible();
    await expect(rowStatus(page)).toHaveText('Not marked');
    await expect(row(page).getByRole('button', { name: 'Present' })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });
});
