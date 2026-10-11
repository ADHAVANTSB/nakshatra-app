import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * Read journeys for the Participants and Events pages (checklist areas
 * J-03 and Phase-2 journey 5) — MOCKED.
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
}

test.describe('participants and events reads', () => {
  test('the participants page lists imported participants with their home', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/participants');
    await expect(page.getByRole('heading', { name: 'Participants' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Arun Kumar');
    await expect(page.locator('body')).toContainText('Sunshine Childrens Home');
    expect(pageErrors).toEqual([]);
  });

  test('the events page lists the event catalogue', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/events');
    await expect(page.getByRole('heading', { name: 'Event Master' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Watercolour Painting');
    expect(pageErrors).toEqual([]);
  });
});
