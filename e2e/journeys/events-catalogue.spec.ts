import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { BackendStub } from '../stubs/backend';

/**
 * The official 29-event catalogue on the Events page — MOCKED.
 *
 * Proves: every backend record renders as its own card (nothing is
 * consolidated or seeded locally); category totals are LITERARY 11 /
 * CULTURAL 7 / ARTS 11; same-name level-split records show their level
 * prominently and never look merged; quizzes show their own bands; the
 * category badge shows on the cards; and the truthful "catalogue
 * migration pending" banner appears exactly when the backend reports it.
 */

const ALL = ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'];

/** The official 29 records exactly as the backend serves them. */
const CATALOGUE: Array<[string, string, string, string, string[]]> = [
  ['LIT-001', 'Group Discussion', 'LITERARY', 'SOLO', ['SENIOR']],
  ['LIT-001-SS', 'Group Discussion', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
  ['LIT-002', 'Story Telling (Tamil/English)', 'LITERARY', 'SOLO', ['SUB_JUNIOR']],
  ['LIT-002-J', 'Story Telling (Tamil/English)', 'LITERARY', 'SOLO', ['JUNIOR']],
  ['LIT-003', 'Story Writing (Tamil/English)', 'LITERARY', 'SOLO', ['SENIOR']],
  ['LIT-003-SS', 'Story Writing (Tamil/English)', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
  ['LIT-004', 'Potpurri (Words Play)', 'LITERARY', 'GROUP', ALL],
  ['LIT-005', 'Quiz (SJ + J)', 'LITERARY', 'GROUP', ['SUB_JUNIOR', 'JUNIOR']],
  ['LIT-006', 'Quiz (S + SS)', 'LITERARY', 'GROUP', ['SENIOR', 'SUPER_SENIOR']],
  ['LIT-007', 'Block and Tackle', 'LITERARY', 'SOLO', ['SENIOR']],
  ['LIT-007-SS', 'Block and Tackle', 'LITERARY', 'SOLO', ['SUPER_SENIOR']],
  ['CUL-001', 'Group Song', 'CULTURAL', 'GROUP', ALL],
  ['CUL-002', 'Skit (Tamil)', 'CULTURAL', 'GROUP', ALL],
  ['CUL-003', 'Group Dance', 'CULTURAL', 'GROUP', ALL],
  ['CUL-004', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SUB_JUNIOR']],
  ['CUL-004-J', 'Adapt Tune', 'CULTURAL', 'SOLO', ['JUNIOR']],
  ['CUL-004-S', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SENIOR']],
  ['CUL-004-SS', 'Adapt Tune', 'CULTURAL', 'SOLO', ['SUPER_SENIOR']],
  ['ART-001', 'Clay Modelling', 'ARTS', 'SOLO', ['SUB_JUNIOR']],
  ['ART-001-J', 'Clay Modelling', 'ARTS', 'SOLO', ['JUNIOR']],
  ['ART-001-S', 'Clay Modelling', 'ARTS', 'SOLO', ['SENIOR']],
  ['ART-001-SS', 'Clay Modelling', 'ARTS', 'SOLO', ['SUPER_SENIOR']],
  ['ART-002', 'Rangoli', 'ARTS', 'GROUP', ALL],
  ['ART-003', 'Greeting Card making', 'ARTS', 'SOLO', ['SUB_JUNIOR']],
  ['ART-003-J', 'Greeting Card making', 'ARTS', 'SOLO', ['JUNIOR']],
  ['ART-003-S', 'Greeting Card making', 'ARTS', 'SOLO', ['SENIOR']],
  ['ART-003-SS', 'Greeting Card making', 'ARTS', 'SOLO', ['SUPER_SENIOR']],
  ['ART-004', 'Waste to wealth', 'ARTS', 'GROUP', ALL],
  ['ART-005', 'String Art', 'ARTS', 'GROUP', ALL],
];

const events = CATALOGUE.map(([eventCode, name, category, mode, eligibleLevels], index) => ({
  id: 'EVT-' + String(index + 1).padStart(4, '0'),
  eventCode,
  name,
  category,
  mode,
  eligibleLevels,
  status: 'ACTIVE',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
}));

function installCatalogue(
  backend: BackendStub,
  catalogueMigration?: {
    pending: boolean;
    missingRecordCodes: string[];
    levelBandPendingCodes: string[];
    blockedRecordCodes: string[];
  } | null,
): void {
  backend.on('listEvents', () => ({
    body: {
      success: true,
      data: {
        events,
        registrationCounts: Object.fromEntries(events.map(e => [e.id, 0])),
        catalogueMigration: catalogueMigration ?? null,
      },
    },
  }));
  backend.on('getPageData', () => ({
    body: {
      success: true,
      data: { shelterHomes: [], participants: [], imports: [], validationResults: [] },
    },
  }));
  backend.on('listEventDayRegistrations', () => ({
    body: { success: true, data: { eventDayRegistrations: [] } },
  }));
  backend.on('listEventRegistrations', () => ({
    body: { success: true, data: { participantEvents: [] } },
  }));
}

test.describe('events catalogue — the 29 official records', () => {
  test('renders all 29 backend records grouped 11/7/11 with codes and category badges', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/events');
    await expect(page.locator('article.event-card')).toHaveCount(29);

    await expect(page.locator('h3.event-category-heading')).toHaveText([
      /ARTS\s*11 events/,
      /LITERARY\s*11 events/,
      /CULTURAL\s*7 events/,
    ]);

    // Stable code + category badge render per card (identity never by name).
    const firstArtsCard = page.locator('article.event-card').first();
    await expect(firstArtsCard).toContainText('ART-001');
    await expect(firstArtsCard).toContainText('ARTS');

    expect(pageErrors).toEqual([]);
  });

  test('same-name records show their level prominently and never look merged', async ({ page, backend }) => {
    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/events');
    const list = page.locator('.events-card-list');

    await expect(list).toContainText('Clay Modelling — Sub Junior (SJ)');
    await expect(list).toContainText('Clay Modelling — Junior (J)');
    await expect(list).toContainText('Clay Modelling — Senior (S)');
    await expect(list).toContainText('Clay Modelling — Super Senior (SS)');

    // Four separate Clay Modelling cards, each with its own code.
    const clayCards = page.locator('article.event-card').filter({ hasText: 'Clay Modelling' });
    await expect(clayCards).toHaveCount(4);
    await expect(clayCards.nth(0)).toContainText('ART-001');
    await expect(clayCards.nth(1)).toContainText('ART-001-J');

    // Display normalization of the official names is display-only.
    await expect(list).toContainText('Greeting Card Making — Junior (J)');
    await expect(list).toContainText('Waste to Wealth');
  });

  test('quizzes and COMMON records show their actual allowed levels', async ({ page, backend }) => {
    await signIn(page);
    installCatalogue(backend);

    await page.goto('/#/events');
    const list = page.locator('.events-card-list');

    await expect(list).toContainText('Quiz (SJ + J)');
    await expect(list).toContainText('Quiz (S + SS)');

    const quizSJ = page.locator('article.event-card').filter({ hasText: 'Quiz (SJ + J)' }).first();
    await quizSJ.locator('.event-card-header').click();
    await expect(quizSJ).toContainText('Sub Juniors');
    await expect(quizSJ).toContainText('Juniors');
    await expect(quizSJ).not.toContainText('Seniors');

    const common = page.locator('article.event-card').filter({ hasText: 'Rangoli' }).first();
    await expect(common).toContainText('COMMON');
    await expect(common).toContainText('all levels');
  });

  test('the catalogue migration banner is truthful and only shows while pending', async ({ page, backend }) => {
    await signIn(page);
    installCatalogue(backend, {
      pending: true,
      missingRecordCodes: ['ART-001-J', 'ART-001-S', 'ART-001-SS'],
      levelBandPendingCodes: ['ART-001'],
      blockedRecordCodes: [],
    });

    await page.goto('/#/events');
    const banner = page.getByTestId('catalogue-migration-pending');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Catalogue migration pending');
    await expect(banner).toContainText('3 record(s) are not yet projected');
    await expect(banner).toContainText('1 record(s) still carry merged level bands');

    // The 29 records are still served while the migration is pending.
    await expect(page.locator('article.event-card')).toHaveCount(29);
  });

  test('no migration banner outside a pending migration', async ({ page, backend }) => {
    await signIn(page);
    installCatalogue(backend, {
      pending: false,
      missingRecordCodes: [],
      levelBandPendingCodes: [],
      blockedRecordCodes: [],
    });

    await page.goto('/#/events');
    await expect(page.getByTestId('catalogue-migration-pending')).toHaveCount(0);
    await expect(page.locator('article.event-card')).toHaveCount(29);
  });
});
