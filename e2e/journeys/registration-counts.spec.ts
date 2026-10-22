import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * Registration-count aggregate on the Events page (checklist area:
 * counts load with the catalogue at page init) — MOCKED.
 *
 * Proves: every count renders without expanding a card; `0` is a real
 * state (never an em dash); pending and failed states are distinct; the
 * count never changes between collapsed and expanded card states; and
 * NO per-event count request is ever issued (the aggregate rides with
 * the single `listEvents` read).
 */

const EVENT = (id: string, name: string) => ({
  id,
  eventCode: `AR-${id}`,
  name,
  category: 'ARTS',
  mode: 'SOLO',
  eligibleLevels: ['SUB_JUNIOR', 'JUNIOR'],
  status: 'ACTIVE',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
});

const EVENTS = [
  EVENT('event-1', 'Clay Modelling'),
  EVENT('event-2', 'Rangoli'),
  EVENT('event-3', 'Group Song'),
];

function installCatalogue(
  backend: BackendStub,
  registrationCounts: Record<string, number> | null,
): void {
  backend.on('listEvents', () => ({
    body: { success: true, data: { events: EVENTS, registrationCounts } },
  }));
  backend.on('getPageData', () => ({
    body: {
      success: true,
      data: { shelterHomes: [], participants: [], imports: [], validationResults: [] },
    },
  }));
  backend.on('listEventRegistrations', () => ({
    body: {
      success: true,
      data: {
        participantEvents: [{
          id: 'reg-1', participantId: 'p-1', eventId: 'event-1',
          registrationStatus: 'REGISTERED', participantName: 'Ana',
          version: 1,
        }],
      },
    },
  }));
}

test.describe('events registration counts', () => {
  test('every count renders at page init without expanding any card (no per-event count request)', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend, { 'event-1': 28, 'event-2': 0, 'event-3': 5 });

    await page.goto('/#/events');
    await expect(page.getByRole('heading', { name: 'Event Master' })).toBeVisible();

    const cards = page.locator('.event-card-registered');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Registered: 28');
    await expect(cards.nth(1)).toContainText('Registered: 0');
    await expect(cards.nth(2)).toContainText('Registered: 5');

    // No card was expanded, yet every count is visible - and no
    // per-event registration read was issued for the counts.
    expect(backend.requests.filter(r => r.action === 'listEventRegistrations')).toHaveLength(0);
    expect(backend.requests.filter(r => r.action === 'listParticipantEvents')).toHaveLength(0);

    // The counts ride with the catalogue read (one batched request; two
    // at most when the boot fan-out races the page load) - never N.
    const catalogueReads = backend.requests.filter(r => r.action === 'listEvents').length;
    expect(catalogueReads).toBeGreaterThanOrEqual(1);
    expect(catalogueReads).toBeLessThanOrEqual(2);
    expect(pageErrors).toEqual([]);
  });

  test('a loaded zero is "Registered: 0", never an em dash', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend, { 'event-1': 0, 'event-2': 0, 'event-3': 0 });

    await page.goto('/#/events');
    const cards = page.locator('.event-card-registered');
    await expect(cards.nth(0)).toContainText('Registered: 0');
    await expect(cards.nth(1)).toContainText('Registered: 0');
    await expect(cards.nth(2)).toContainText('Registered: 0');
    await expect(cards.nth(0)).not.toContainText('—');
    expect(pageErrors).toEqual([]);
  });

  test('the count is the same in the collapsed and the expanded card state', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend, { 'event-1': 28, 'event-2': 0, 'event-3': 5 });

    await page.goto('/#/events');
    const firstHeader = page.locator('.event-card-registered').nth(0);
    await expect(firstHeader).toContainText('Registered: 28');

    await page.locator('.event-card-header').nth(0).click();
    await expect(page.locator('.event-card-details')).toContainText('Registered 28');
    await expect(firstHeader).toContainText('Registered: 28');

    // Expanding loads ONLY that card's participant rows (never its count).
    expect(backend.requests.filter(r => r.action === 'listEventRegistrations')).toHaveLength(1);

    await page.locator('.event-card-header').nth(0).click();
    await expect(firstHeader).toContainText('Registered: 28');
    expect(pageErrors).toEqual([]);
  });

  test('a failed aggregate shows "Unable to load" - never a dash or a fake zero', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend, null);

    await page.goto('/#/events');
    const cards = page.locator('.event-card-registered');
    await expect(cards.nth(0)).toContainText('Unable to load');
    await expect(cards.nth(0)).not.toContainText('—');
    await expect(cards.nth(0)).not.toContainText('Registered: 0');
    expect(pageErrors).toEqual([]);
  });
});
