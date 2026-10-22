import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * Homes -> Participants navigation (checklist area: participation is
 * the roster + registrations workflow) — MOCKED.
 *
 * The Homes page "Participants" action must open the home's participant
 * roster with its registered events and role/lock-aware editing, and
 * NEVER the event-day attendance workflow: no Present/Absent controls,
 * no Save Attendance on the roster. The check-in workflow is reachable
 * only through its own explicit action on the page.
 */

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

const HOME = {
  id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home',
  address: '12 Lake Road', contactName: '', contactPhone: '', status: 'ACTIVE',
  version: 1, sourceStatus: 'CONNECTED', sheetStatus: 'LOCKED',
};

const CHECK_IN_ENTRY = {
  participantId: 'p-1',
  participantCode: 'P-001',
  fullName: 'Arun Kumar',
  level: 'SUB_JUNIOR',
  shelterHomeId: 'home-1',
  homeName: 'Sunshine Childrens Home',
  homeSheetStatus: 'LOCKED',
  checkInStatus: 'NOT_REGISTERED',
  checkedInAt: '',
  checkedInBy: '',
  version: 0,
};

function installBackend(backend: BackendStub): void {
  backend.on('listShelterHomes', () => ({
    body: { success: true, data: { shelterHomes: [HOME] } },
  }));
  backend.on('getPageData', () => ({
    body: {
      success: true,
      data: {
        shelterHomes: [HOME],
        participants: [PARTICIPANT],
        imports: [],
        validationResults: [],
      },
    },
  }));
  backend.on('listParticipants', () => ({
    body: { success: true, data: { participants: [PARTICIPANT] } },
  }));
  backend.on('listEvents', () => ({ body: { success: true, data: { events: [], registrationCounts: {} } } }));
  backend.on('listParticipantEvents', () => ({ body: { success: true, data: { participantEvents: [] } } }));
  backend.on('getParticipantEventSummaries', () => ({
    body: {
      success: true,
      data: {
        summaries: [{
          participantId: 'p-1',
          participantCode: 'P-001',
          fullName: 'Arun Kumar',
          events: [{
            eventId: 'event-1', eventName: 'Rangoli', category: 'ARTS',
            mode: 'GROUP', registrationStatus: 'REGISTERED',
          }],
          activeEventCount: 1,
          artsCount: 1, literaryCount: 0, culturalCount: 0, soloCount: 0,
        }],
        issues: [],
      },
    },
  }));
  backend.on('listEventDayRegistrations', () => ({
    body: { success: true, data: { eventDayRegistrations: [CHECK_IN_ENTRY] } },
  }));
}

test.describe('homes to participation navigation', () => {
  test('the Homes "Participants" action opens the roster with NO attendance controls', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installBackend(backend);

    await page.goto('/#/homes');
    await expect(page.getByRole('heading', { name: 'Shelter Homes', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Participants', exact: true }).first().click();

    await page.waitForURL('**/participants**');
    // The Homes action carries the home context to the roster.
    await expect(page).toHaveURL(/shelterHomeId=home-1/);
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText('Arun Kumar');

    // The roster shows the participation facts, never attendance marks.
    const buttons = page.getByRole('button');
    await expect(buttons.filter({ hasText: 'Save Attendance' })).toHaveCount(0);
    await expect(buttons.filter({ hasText: /^Present$/ })).toHaveCount(0);
    await expect(buttons.filter({ hasText: /^Absent$/ })).toHaveCount(0);
    await expect(buttons.filter({ hasText: 'Select All Present' })).toHaveCount(0);
    await expect(buttons.filter({ hasText: 'Mark All Absent' })).toHaveCount(0);

    // No attendance write was ever attempted from the roster.
    const mutations = backend.requests
      .map(r => r.action)
      .filter(action => action === 'saveEventDayAttendanceBatch' || action === 'markAttendance' || action === 'saveAttendance');
    expect(mutations).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('the event-day check-in is a separate, explicit mode of the page', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installBackend(backend);

    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();

    // Roster mode: the check-in workflow is not rendered.
    await expect(page.locator('body')).not.toContainText('Save Attendance');

    // The explicit action opens the check-in workflow.
    await page.getByRole('button', { name: 'Event Day Check-In' }).click();
    await expect(page.locator('body')).toContainText('Event Day Check-In');
    await expect(page.getByRole('button', { name: 'Save Attendance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Present' }).first()).toBeVisible();

    // And can be left again, back to the roster.
    await page.getByRole('button', { name: 'Back to participants' }).click();
    await expect(page.locator('body')).not.toContainText('Save Attendance');
    expect(pageErrors).toEqual([]);
  });
});
