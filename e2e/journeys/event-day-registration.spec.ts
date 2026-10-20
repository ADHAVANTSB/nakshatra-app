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
    await page.goto('/#/participants');
    const section = eventDaySection(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText('One check-in for the overall event day');

    const row = section.locator('tr').filter({ hasText: 'Arun Kumar' });
    await expect(row).toContainText('Sunshine Childrens Home');
    await expect(row).toContainText('Home sheet confirmed and locked');
    await expect(row).toContainText('Not registered');

    // Check-in enables registration; it never registers anyone itself.
    await row.getByRole('button', { name: 'Check in' }).click();
    await expect(section.locator('.alert.success')).toContainText('Arun Kumar is checked in for the event day.');
    await expect(row).toContainText('Checked in');
    expect(backend.requests.filter((request) => request.action === 'registerParticipant')).toHaveLength(0);
    expect(backend.requests.some((request) => request.action === 'markAttendance')).toBe(false);

    // A full reload restores the check-in state from the persisted record
    // (the app boots to the dashboard, so navigate back to the queue).
    await page.reload();
    await page.goto('/#/participants');
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
    await page.goto('/#/participants');
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
    expect(pageErrors).toEqual([]);
  });
});
