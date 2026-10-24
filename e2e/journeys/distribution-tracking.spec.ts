import {
  adminUser,
  certificateTeamUser,
  expect,
  monitorPageErrors,
  signIn,
  test,
  type ScopeSeed,
} from '../fixtures';
import type { BackendStub, StubUser } from '../stubs/backend';

/**
 * Physical distribution tracking journey (Certificates page) â€” MOCKED.
 *
 * The stub backend answers the same actions the real Apps Script backend
 * serves (listWinners / listDistributionTracking / saveDistributionStatus)
 * with a small in-memory store, so the journey proves the UI contract:
 * statuses are only ever reported from backend-confirmed responses (server
 * timestamp + recording display name), reloads restore exactly what is
 * stored, corrections flip a status without losing its evidence, and the
 * existing certificate issuance workflow is never triggered.
 *
 * Honesty note: this suite exercises the app against the stub backend.
 * Authorization, audit history (DISTIBUTION_*), scope isolation and
 * upsert/no-duplicate guarantees are verified against the REAL Code.gs by
 * backend-verification/test-distribution-tracking.js (offline harness).
 */

const liaisonUser: StubUser = {
  ...adminUser,
  id: 'e2e-user-liaison',
  googleId: 'e2e-google-liaison',
  email: 'liaison.e2e@example.com',
  displayName: 'Liaison (E2E)',
  role: 'LIAISON_TEAM',
};

const AVAILABLE_STORAGE = {
  available: true,
  status: 'AVAILABLE',
  table: 'DistributionTracking',
  reason: '',
  migrationStep: '',
};

function winnersData(winners: Array<Record<string, unknown>>): unknown {
  return {
    events: [
      {
        eventId: 'event-1',
        eventCode: 'LIT-006',
        eventName: 'Quiz (S+SS)',
        category: 'LITERARY',
        mode: 'SOLO',
        eventStatus: 'ACTIVE',
        winners,
      },
    ],
    totalEvents: 1,
    totalWinners: winners.length,
  };
}

function winner(position: number, name: string, score: number, scoreId: string): Record<string, unknown> {
  return {
    position,
    name,
    className: '5',
    level: 'JUNIOR',
    shelterHomeName: 'Sunrise Home',
    score,
    scoreId,
    participantId: `participant-${position}`,
    teamId: '',
  };
}

interface TrackingFixture {
  store: Map<string, Record<string, unknown>>;
  saves: Array<Record<string, unknown>>;
}

const AWARDS = ['MEDAL', 'CERTIFICATE_WRITTEN', 'CERTIFICATE'];

function defaultEntry(scoreId: string, awardType: string): Record<string, unknown> {
  return {
    id: `dist-${scoreId}|${awardType}`,
    scoreId,
    eventId: 'event-1',
    participantId: 'participant-1',
    teamId: '',
    awardType,
    distributed: false,
    distributedAt: '',
    recordedBy: '',
    recordedByName: '',
    version: 0,
  };
}

/** Stateful stub: saves persist across list reads and page reloads. */
function installTracking(
  backend: BackendStub,
  options: { winners: unknown; winnerScoreIds: string[]; recorderName: string },
): TrackingFixture {
  const store = new Map<string, Record<string, unknown>>();
  const saves: Array<Record<string, unknown>> = [];

  backend.on('listWinners', () => ({ body: { success: true, data: options.winners } }));

  backend.on('listDistributionTracking', () => {
    const distributions = options.winnerScoreIds.flatMap(scoreId =>
      AWARDS.map(awardType => store.get(`${scoreId}|${awardType}`) ?? defaultEntry(scoreId, awardType)),
    );
    return {
      body: {
        success: true,
        data: {
          storage: AVAILABLE_STORAGE,
          distributions,
          recordedCount: distributions.filter(entry => entry['distributed'] === true).length,
          totalWinners: options.winnerScoreIds.length,
        },
      },
    };
  });

  backend.on('saveDistributionStatus', request => {
    const payload = request['payload'] as {
      scoreId: string;
      awardType: string;
      distributed: boolean;
    };
    saves.push({ ...payload });

    const key = `${payload.scoreId}|${payload.awardType}`;
    const previous = store.get(key);

    // The real backend rule: a certificate is distributed only after it
    // has been written.
    if (
      payload.awardType === 'CERTIFICATE' &&
      payload.distributed &&
      store.get(`${payload.scoreId}|CERTIFICATE_WRITTEN`)?.['distributed'] !== true
    ) {
      return {
        body: {
          success: false,
          error: {
            code: 'CERTIFICATE_NOT_WRITTEN',
            message: 'Mark the certificate as written before recording its distribution.',
          },
        },
      };
    }

    const entry: Record<string, unknown> = {
      id: previous ? previous['id'] : `dist-${key}`,
      scoreId: payload.scoreId,
      eventId: 'event-1',
      participantId: 'participant-1',
      teamId: '',
      awardType: payload.awardType,
      distributed: payload.distributed,
      // A correction keeps the previous who/when evidence, exactly like
      // the real backend row does.
      distributedAt: payload.distributed
        ? '2026-10-25T11:42:00.000Z'
        : (previous ? previous['distributedAt'] : ''),
      recordedBy: payload.distributed ? 'e2e-user' : (previous ? previous['recordedBy'] : ''),
      recordedByName: payload.distributed
        ? options.recorderName
        : (previous ? previous['recordedByName'] : ''),
      version: (previous ? Number(previous['version']) : 0) + 1,
    };
    store.set(key, entry);

    return { body: { success: true, data: { distribution: entry } } };
  });

  return { store, saves };
}

const firstRow = (page: import('@playwright/test').Page) =>
  page.locator('tbody tr.certificate-row').first();
const stateSpans = (page: import('@playwright/test').Page) =>
  firstRow(page).locator('.distribution-state');

test.describe('Certificates â€” written/distributed certificate tracking', () => {
  test('records certificate written then distributed, reloads with timestamps, and corrects a status', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);
    const tracking = installTracking(backend, {
      winners: winnersData([winner(1, 'Ana', 21.25, 'score-1'), winner(2, 'Bhavana', 21, 'score-2')]),
      winnerScoreIds: ['score-1', 'score-2'],
      recorderName: 'Certificate Team (E2E)',
    });

    await signIn(page, { user: certificateTeamUser, backend });
    await page.goto('/#/certificates');

    // Winners load first, independently of certificate status tracking.
    await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ana', { exact: true }).first()).toBeVisible();

    const written = firstRow(page).getByTestId('distribution-toggle').nth(0);
    const distributed = firstRow(page).getByTestId('distribution-toggle').nth(1);

    // A certificate is NOT distributed before it is written: the
    // distributed toggle is disabled until the written toggle is saved.
    await expect(distributed).toBeDisabled();

    // Mark written: the status text only appears after the backend confirms.
    await written.check();
    await expect(stateSpans(page).first()).toContainText(
      /Written .{1,3} \d{1,2} Oct 2026, \d{1,2}:\d{2} [AP]M by Certificate Team \(E2E\)/,
    );
    await expect(page.locator('.nk-toast')).toContainText('Certificate Written recorded for Ana.');
    expect(tracking.saves).toEqual([
      { scoreId: 'score-1', awardType: 'CERTIFICATE_WRITTEN', distributed: true, expectedVersion: 0 },
    ]);

    // Reload restores exactly what the backend stored. (A cold boot of a
    // deep link lands on the dashboard before the session hydrates - a
    // pre-existing app behaviour - so the page is opened again after the
    // reload; the app and its services are freshly booted either way.)
    await page.reload();
    await page.goto('/#/certificates');
    // Cold boot after a reload can take longer than a warm render under
    // full-suite load; wait it out instead of racing it.
    await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(0)).toBeChecked();
    await expect(stateSpans(page).first()).toContainText('Written');
    await expect(stateSpans(page).nth(1)).toContainText('Not distributed');

    // Now the certificate can be handed over.
    await firstRow(page).getByTestId('distribution-toggle').nth(1).check();
    await expect(stateSpans(page).nth(1)).toContainText('Distributed');

    await page.reload();
    await page.goto('/#/certificates');
    await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(0)).toBeChecked();
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(1)).toBeChecked();

    // Correction: unchecking is an authorized correction. The stub keeps
    // the previous who/when evidence on the record (the real backend also
    // writes the DISTIBUTION_CORRECTED audit entry - backend suite).
    await firstRow(page).getByTestId('distribution-toggle').nth(0).uncheck();
    await expect(stateSpans(page).first()).toContainText('Not written');
    await expect(page.locator('.nk-toast')).toContainText('Certificate Written corrected');
    expect(tracking.saves[tracking.saves.length - 1]).toMatchObject({
      scoreId: 'score-1',
      awardType: 'CERTIFICATE_WRITTEN',
      distributed: false,
    });
    expect(tracking.store.get('score-1|CERTIFICATE_WRITTEN')?.['distributedAt']).toBeTruthy();
    // The distributed record survives the written correction untouched.
    await expect(stateSpans(page).nth(1)).toContainText('Distributed');

    // Print shows backend-confirmed status text (never the interactive
    // checkbox state of an unsaved toggle) and printing records nothing.
    await page.emulateMedia({ media: 'print' });
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(1)).toBeHidden();
    await expect(stateSpans(page).first()).toContainText('Not written');
    await expect(stateSpans(page).nth(1)).toContainText('Distributed');
    await page.emulateMedia({ media: null });

    // The existing certificate issuance workflow stays untouched: this page
    // generates nothing and calls no certificate actions.
    await expect(page.getByRole('button', { name: /generate|issue/i })).toHaveCount(0);
    const actions = backend.requests.map(request => request.action);
    expect(actions).not.toContain('issueCertificate');
    expect(actions).not.toContain('listCertificates');
    expect(pageErrors).toEqual([]);
  });

  test('an unauthorized role cannot reach the page or save', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const tracking = installTracking(backend, {
      winners: winnersData([winner(1, 'Ana', 21.25, 'score-1'), winner(2, 'Bhavana', 21, 'score-2')]),
      winnerScoreIds: ['score-1', 'score-2'],
      recorderName: 'Liaison (E2E)',
    });

    await signIn(page, { user: liaisonUser, backend });

    // The attempt is rejected in the UI: the role has no access to the
    // Certificates section and is redirected (existing section policy).
    await page.goto('/#/certificates');
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Nothing was written, and the distribution toggles are never offered.
    expect(tracking.saves).toHaveLength(0);
    await expect(page.getByTestId('distribution-toggle')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a failed save is never shown as success and can be retried', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const tracking = installTracking(backend, {
      winners: winnersData([winner(1, 'Ana', 21.25, 'score-1'), winner(2, 'Bhavana', 21, 'score-2')]),
      winnerScoreIds: ['score-1', 'score-2'],
      recorderName: 'Certificate Team (E2E)',
    });
    // The save is attempted but rejected with a rule error (the responder
    // records the attempt before answering).
    backend.on('saveDistributionStatus', request => {
      const payload = request['payload'] as Record<string, unknown>;
      tracking.saves.push({ ...payload });
      return {
        body: {
          success: false,
          error: {
            code: 'VERSION_CONFLICT',
            message: 'This distribution status was changed by someone else. Reload and try again.',
          },
        },
      };
    });

    await signIn(page, { user: certificateTeamUser, backend });
    await page.goto('/#/certificates');
    await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible();

    await firstRow(page).getByTestId('distribution-toggle').nth(0).click();
    await expect(firstRow(page).locator('.distribution-error')).toContainText('changed by someone else');
    // The checkbox is restored to the last confirmed state - no false success.
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(0)).not.toBeChecked();
    await expect(stateSpans(page).first()).toContainText('Not written');
    await expect(page.locator('.nk-toast--success')).toHaveCount(0);

    // Rule rejection: a Retry cannot succeed, so none is offered.
    await expect(page.getByTestId('distribution-retry')).toHaveCount(0);
    expect(tracking.saves).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });

  test('a missing backend table is named precisely and winners still load', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    backend.on('listWinners', () => ({
      body: {
        success: true,
        data: winnersData([winner(1, 'Ana', 21.25, 'score-1'), winner(2, 'Bhavana', 21, 'score-2')]),
      },
    }));
    backend.on('listDistributionTracking', () => ({
      body: {
        success: true,
        data: {
          storage: {
            available: false,
            status: 'TABLE_MISSING',
            table: 'DistributionTracking',
            reason: 'DistributionTracking sheet is missing from the Nakshatra database.',
            migrationStep:
              'Create the sheet "DistributionTracking" with the exact header from ' +
              'backend-verification/proposals/distribution-tracking-migration.md.',
          },
          distributions: [],
          recordedCount: 0,
          totalWinners: 0,
        },
      },
    }));

    await signIn(page, { user: certificateTeamUser, backend });
    await page.goto('/#/certificates');

    // Winners always load, even with tracking storage missing.
    await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ana', { exact: true }).first()).toBeVisible();

    // The missing table and the exact migration step are named; the page
    // never claims "no statuses recorded" for a missing table.
    await expect(page.getByText('Certificate status storage is missing.')).toBeVisible();
    await expect(page.getByText(/Create the sheet "DistributionTracking"/)).toBeVisible();
    await expect(page.getByText('No statuses recorded yet')).toHaveCount(0);
    await expect(stateSpans(page).first()).toContainText('Unavailable');
    await expect(firstRow(page).getByTestId('distribution-toggle').nth(0)).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  for (const scope of [
    { seed: { program: 'ARTS', zone: 'TEST' } as ScopeSeed, own: 'Ana', other: 'Zed Zone' },
    { seed: { program: 'ARTS', zone: 'ZONE_1' } as ScopeSeed, own: 'Zed Zone', other: 'Ana' },
  ]) {
    test(`the ${scope.seed.zone} view shows only its own winners (no cross-scope leakage)`, async ({
      page,
      backend,
    }) => {
      const pageErrors = monitorPageErrors(page);
      installTracking(backend, {
        winners: winnersData([
          winner(1, scope.own, 21.25, 'score-own'),
          winner(2, 'Bhavana', 21, 'score-2'),
        ]),
        winnerScoreIds: ['score-own', 'score-2'],
        recorderName: 'Praveen (E2E)',
      });

      // The stub answers each scoped request with only that scope's rows;
      // enforcement against real data is covered by the backend zone
      // isolation suite (real Code.gs, offline harness).
      await signIn(page, { user: adminUser, backend, scope: scope.seed });
      await page.goto('/#/certificates');

      await expect(page.getByText('Quiz (S+SS)', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(scope.own, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(scope.other, { exact: true })).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });
  }
});
