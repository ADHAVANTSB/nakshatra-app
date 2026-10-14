import { expect, monitorPageErrors, signIn, test } from '../fixtures';

/**
 * API error, network failure and reliability journeys (checklist areas
 * C-06, H-01…H-03) — MOCKED.
 */

test.describe('api errors and reliability', () => {
  test('a failed dashboard load offers Retry that issues a real new request', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    let summaryCalls = 0;
    let failSummary = true;

    await signIn(page);

    backend.on('getDashboardSummary', () => {
      summaryCalls += 1;
      if (failSummary) {
        return { body: { success: false, error: { code: 'SUMMARY_READ_FAILED', message: 'The summary read failed.' } } };
      }
      return {
        body: {
          success: true,
          data: {
            summary: {
              homes: 4, participants: 25, events: 6, activeEvents: 3, registrations: 30,
              teams: 5, attendance: { recorded: 20, present: 15, absent: 5 },
              finalizedScores: 2, certificates: { generated: 7, issued: 6 },
            },
          },
        },
      };
    });

    await page.reload();

    await expect(page.getByRole('alert').filter({ hasText: 'The summary read failed.' })).toBeVisible();

    const callsAfterFailure = summaryCalls;
    failSummary = false;
    await page.getByRole('button', { name: 'Retry reading the backend summary' }).click();

    await expect(
      page.locator('.stat-card').filter({ hasText: 'Participants' }).getByText('25', { exact: true }),
    ).toBeVisible();
    expect(summaryCalls).toBeGreaterThan(callsAfterFailure);
    expect(pageErrors).toEqual([]);
  });

  test('a failed dashboard refresh shows an error with retry and keeps the session', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    let failSummary = false;

    await signIn(page);

    backend.on('getDashboardSummary', () => {
      if (failSummary) {
        return { abort: true };
      }
      return {
        body: {
          success: true,
          data: {
            summary: {
              homes: 4, participants: 25, events: 6, activeEvents: 3, registrations: 30,
              teams: 5, attendance: { recorded: 20, present: 15, absent: 5 },
              finalizedScores: 2, certificates: { generated: 7, issued: 6 },
            },
          },
        },
      };
    });

    // Load real values first, then fail a refresh.
    await page.getByRole('button', { name: 'Refresh dashboard data from the backend' }).click();
    await expect(
      page.locator('.stat-card').filter({ hasText: 'Participants' }).getByText('25', { exact: true }),
    ).toBeVisible();

    failSummary = true;
    await page.getByRole('button', { name: 'Refresh dashboard data from the backend' }).click();

    // The app's established contract: a failed read is reported honestly with
    // a Retry, instead of presenting possibly-stale numbers as current.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry reading the backend summary' })).toBeVisible();
    // The unrelated read failure never destroyed the session.
    await expect(page.locator('aside.nk-sidebar')).toHaveCount(1);

    failSummary = false;
    await page.getByRole('button', { name: 'Retry reading the backend summary' }).click();
    await expect(
      page.locator('.stat-card').filter({ hasText: 'Participants' }).getByText('25', { exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('an HTTP 404 HTML page during connect is never reported as success', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await page.getByRole('button', { name: /add home/i }).first().click();

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          spreadsheetName: 'Unreachable Register',
          metadata: { homeName: 'Hope Home' },
          metadataContactSource: 'ABSENT',
          metadataEvidence: {},
          metadataMissing: ['address', 'contactName', 'contactPhone'],
          caretakers: [],
          caretakerCount: 0,
          participantCount: null,
          participantSheetDetected: false,
          eventWiseSheetDetected: false,
          workbookStructure: { sheetsInspected: 0, sheetsTotal: 0, sheets: [] },
          warnings: [],
          errors: [],
        },
      },
    }));
    // Apps Script-style outage: the endpoint answers with an HTML error page.
    backend.on('connectShelterSheet', () => ({
      status: 404,
      raw: '<html><title>Error 404 (Not Found)!!1</title></html>',
    }));
    // The verification re-read finds NO matching home (connection did not persist).
    backend.on('listShelterHomes', () => ({ body: { success: true, data: { shelterHomes: [] } } }));

    await page.locator('input[name="sheetUrl"]').fill('https://docs.google.com/spreadsheets/d/e2e-outage/edit');
    await page.getByRole('button', { name: 'Preview source metadata' }).click();
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    const outcome = page.locator('.connection-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText('could not be confirmed');
    await expect(outcome).toContainText('SERVER_RESPONSE_MALFORMED');
    const outcomeText = await outcome.innerText();
    expect(outcomeText).not.toMatch(/is connected|successfully connected/i);
    expect(pageErrors).toEqual([]);
  });

  test('an unmocked action is aborted at the network layer, never proxied', async ({ page, backend }) => {
    // Settings fires `listUsers`, which this suite never stubs. The stub must
    // abort the attempt (nothing reaches production) and the page must show
    // an honest load failure with no fabricated user data.
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/settings');

    await expect(page.getByText('Users could not be loaded.')).toBeVisible();
    expect(backend.requests.filter((request) => request.action === 'listUsers')).toHaveLength(1);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('praveen.e2e@example.com');
    // The session survived the aborted read.
    const persisted = await page.evaluate(() => window.sessionStorage.getItem('nakshatra.applicationSession'));
    expect(persisted).not.toBeNull();
    expect(pageErrors).toEqual([]);
  });
});
