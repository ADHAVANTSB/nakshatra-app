import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Shelter-home journeys (checklist areas B, C, D, E) — MOCKED.
 *
 * Metadata preview, connect/import outcomes, retry, archive and restore run
 * against intercepted Apps Script responses with disposable in-memory state.
 * Nothing here proves live Google Sheets behaviour (BLOCKED until a test
 * backend and disposable spreadsheet exist).
 */

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e2e-sheet-id/edit';

const homeCard = (page: Page, name: string) =>
  page.locator('.connected-home-card').filter({ hasText: name });

interface MutableHome {
  id: string;
  homeCode: string;
  homeName: string;
  address: string;
  contactName: string;
  contactPhone: string;
  status: string;
  version: number;
  spreadsheetName: string;
  sourceStatus: string;
  currentImportVersionId?: string;
}

function makeHome(overrides: Partial<MutableHome> = {}): MutableHome {
  return {
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
    ...overrides,
  };
}

const PREVIEW_BASE = {
  spreadsheetName: 'Sunshine Home Register',
  metadataEvidence: {},
  caretakers: [],
  caretakerCount: 0,
  participantSheetDetected: true,
  eventWiseSheetDetected: true,
  workbookStructure: { sheetsInspected: 3, sheetsTotal: 3, sheets: [] },
  warnings: [],
  errors: [],
};

async function openAddHomeForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: /add home/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Add Shelter Home' })).toBeVisible();
}

async function previewMetadata(page: Page): Promise<void> {
  await page.locator('input[name="sheetUrl"]').fill(SHEET_URL);
  await page.getByRole('button', { name: 'Preview source metadata' }).click();
}

test.describe('shelter homes: preview, connect, archive', () => {
  test('preview requires a sheet URL before it can be requested', async ({ page }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    await expect(page.getByRole('button', { name: 'Preview source metadata' })).toBeDisabled();

    await page.locator('input[name="sheetUrl"]').fill(SHEET_URL);
    await expect(page.getByRole('button', { name: 'Preview source metadata' })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test('preview shows detected values and prompts only for missing fields', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Sunshine Childrens Home', address: '12 Lake Road', contactPhone: '555-0100' },
          metadataContactSource: 'ABSENT',
          metadataMissing: ['contactName'],
          participantCount: 14,
        },
      },
    }));

    await previewMetadata(page);

    const panel = page.locator('.sheet-preview-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Sunshine Childrens Home');
    await expect(panel).toContainText('12 Lake Road');
    await expect(panel).toContainText('555-0100');
    await expect(panel).toContainText('14');
    // Only the genuinely missing field is prompted for.
    await expect(panel).toContainText('please enter: Contact name');
    // No spreadsheet identifier may appear anywhere in the UI.
    expect(await page.locator('body').innerText()).not.toContain('e2e-sheet-id');
    expect(pageErrors).toEqual([]);
  });

  test('a caretaker-derived contact is shown as a caretaker, never as the official contact', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Sunshine Childrens Home', address: '12 Lake Road', contactPhone: '555-0199' },
          metadataContactSource: 'CARETAKER_LABEL',
          metadataMissing: ['contactName'],
          caretakers: [{
            fullName: 'Meena Warden',
            contactNumber: '555-0199',
            alternateNumber: '',
            sourceRowNumber: 4,
            participantName: '',
          }],
          caretakerCount: 1,
          participantCount: null,
        },
      },
    }));

    await previewMetadata(page);

    const panel = page.locator('.sheet-preview-panel');
    await expect(panel).toBeVisible();
    // The caretaker appears under Caretakers…
    await expect(panel).toContainText('Meena Warden');
    // …with the honest warning, and the phone never enters the Contact Name field.
    await expect(panel).toContainText('was not filled in as the official contact');
    expect(await page.locator('input[name="contactName"]').inputValue()).toBe('');
    expect(pageErrors).toEqual([]);
  });

  test('a failed preview shows the backend error without inventing values', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.failWith('previewShelterSheet', 200, 'SPREADSHEET_ACCESS_FAILED', 'The spreadsheet is not shared with the signed-in account.');

    await previewMetadata(page);

    await expect(page.getByRole('alert').filter({ hasText: 'The spreadsheet is not shared' })).toBeVisible();
    await expect(page.locator('.sheet-preview-panel')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('connecting a new sheet reports a connected outcome and lists the home', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [];

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Sunshine Childrens Home', address: '12 Lake Road', contactName: 'Office Desk', contactPhone: '555-0100' },
          metadataContactSource: 'EXPLICIT_CONTACT_LABEL',
          metadataMissing: [],
          participantCount: 14,
        },
      },
    }));

    backend.on('connectShelterSheet', () => {
      homes.push(makeHome({ currentImportVersionId: 'iv-1' }));
      return {
        body: {
          success: true,
          data: {
            shelterHome: { id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home', status: 'ACTIVE' },
            sheetSource: { id: 'src-1', spreadsheetName: 'Sunshine Home Register', sourceStatus: 'CONNECTED' },
            connection: { status: 'CONNECTED' },
            initialImport: { attempted: true, status: 'SUCCEEDED', importVersionId: 'iv-1' },
          },
        },
      };
    });
    backend.on('listShelterHomes', (request) => ({
      body: {
        success: true,
        data: {
          shelterHomes: (request.payload as { includeArchived?: boolean } | undefined)?.includeArchived
            ? homes
            : homes.filter((home) => home.status !== 'ARCHIVED'),
        },
      },
    }));

    await previewMetadata(page);
    // B-04: an explicit contact label prefills the Contact Name input.
    await expect(page.locator('input[name="contactName"]')).toHaveValue('Office Desk');
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    await expect(page.locator('.connection-outcome')).toContainText(/connected/i);
    await expect(homeCard(page, 'Sunshine Childrens Home')).toBeVisible();
    expect(backend.requests.filter((request) => request.action === 'connectShelterSheet')).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });

  test('a connect whose initial import fails offers Retry sync that reuses the home', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [];
    let syncCalls = 0;

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Sunshine Childrens Home' },
          metadataContactSource: 'ABSENT',
          metadataMissing: ['address', 'contactName', 'contactPhone'],
          participantCount: 9,
        },
      },
    }));

    backend.on('connectShelterSheet', () => {
      homes.push(makeHome({ address: '', contactName: '', contactPhone: '', currentImportVersionId: 'iv-bad' }));
      return {
        body: {
          success: true,
          data: {
            shelterHome: { id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home', status: 'ACTIVE' },
            sheetSource: { id: 'src-1', spreadsheetName: 'Sunshine Home Register', sourceStatus: 'CONNECTED' },
            connection: { status: 'CONNECTED' },
            initialImport: {
              attempted: true,
              status: 'FAILED',
              errorCode: 'PARTICIPANT_IMPORT_FAILED',
              errorMessage: 'The participant tab could not be read.',
            },
          },
        },
      };
    });
    backend.on('syncShelterSheet', () => {
      syncCalls += 1;
      homes[0] = { ...homes[0], currentImportVersionId: 'iv-2' };
      return {
        body: {
          success: true,
          data: {
            shelterHomeId: 'home-1',
            shelterHomeName: 'Sunshine Childrens Home',
            spreadsheetName: 'Sunshine Home Register',
            importVersionId: 'iv-2',
            versionNumber: 2,
            status: 'COMPLETED',
            recordCount: 9,
            validParticipantCount: 9,
            errorCount: 0,
            warningCount: 0,
          },
        },
      };
    });
    backend.on('listShelterHomes', (request) => ({
      body: {
        success: true,
        data: {
          shelterHomes: (request.payload as { includeArchived?: boolean } | undefined)?.includeArchived
            ? homes
            : homes.filter((home) => home.status !== 'ARCHIVED'),
        },
      },
    }));

    await previewMetadata(page);
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    const outcome = page.locator('.connection-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText(/sync/i);
    await expect(outcome).toContainText('The participant tab could not be read.');

    await page.getByRole('button', { name: 'Retry sync' }).click();

    // Retry must reuse the existing home identity — no second connect — and
    // the completed pipeline brings the home into the connected list.
    expect(backend.requests.filter((request) => request.action === 'connectShelterSheet')).toHaveLength(1);
    expect(syncCalls).toBe(1);
    await expect(homeCard(page, 'Sunshine Childrens Home')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('reconnecting an already-connected source reports the existing home without duplicating it', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [makeHome()];

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('listShelterHomes', () => ({ body: { success: true, data: { shelterHomes: homes } } }));
    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Sunshine Childrens Home' },
          metadataContactSource: 'ABSENT',
          metadataMissing: ['address', 'contactName', 'contactPhone'],
          participantCount: 14,
        },
      },
    }));
    backend.on('connectShelterSheet', () => ({
      body: {
        success: true,
        data: {
          shelterHome: { id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home', status: 'ACTIVE' },
          sheetSource: { id: 'src-1', spreadsheetName: 'Sunshine Home Register', sourceStatus: 'CONNECTED' },
          connection: { status: 'ALREADY_CONNECTED' },
          alreadyConnected: true,
          code: 'ALREADY_CONNECTED',
          initialImport: { attempted: true, status: 'SUCCEEDED', importVersionId: 'iv-1' },
        },
      },
    }));

    await previewMetadata(page);
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    await expect(page.locator('.connection-outcome')).toContainText(/already connected/i);
    await expect(homeCard(page, 'Sunshine Childrens Home')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  });

  test('connecting an archived source points to the restore path', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          metadata: { homeName: 'Old Hope Home' },
          metadataContactSource: 'ABSENT',
          metadataMissing: ['address', 'contactName', 'contactPhone'],
          participantCount: 3,
        },
      },
    }));
    backend.failWith(
      'connectShelterSheet',
      200,
      'SHELTER_HOME_ARCHIVED',
      'This Google Sheet belongs to an archived shelter home. Restore the shelter home before connecting it again.',
    );

    await previewMetadata(page);
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    const outcome = page.locator('.connection-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText(/archived/i);
    await expect(outcome).toContainText(/restore/i);
    expect(pageErrors).toEqual([]);
  });

  test('an ambiguous connect failure re-checks the homes list and finds the persisted home', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [makeHome({ spreadsheetName: 'Unreachable Register' })];

    await signIn(page);
    await page.goto('/#/homes');
    await openAddHomeForm(page);

    backend.on('listShelterHomes', () => ({ body: { success: true, data: { shelterHomes: homes } } }));
    backend.on('previewShelterSheet', () => ({
      body: {
        success: true,
        data: {
          ...PREVIEW_BASE,
          spreadsheetName: 'Unreachable Register',
          metadata: { homeName: 'Hope Home' },
          metadataContactSource: 'ABSENT',
          metadataMissing: ['address', 'contactName', 'contactPhone'],
          participantCount: null,
        },
      },
    }));
    // The connect response is lost (timeout) — but the connection DID persist
    // backend-side, so the verification re-read must find the existing home.
    backend.on('connectShelterSheet', () => ({
      status: 504,
      raw: '<html>Gateway Timeout</html>',
    }));

    await page.locator('input[name="sheetUrl"]').fill('https://docs.google.com/spreadsheets/d/e2e-ambiguous/edit');
    await page.getByRole('button', { name: 'Preview source metadata' }).click();
    await page.getByRole('button', { name: 'Connect Google Sheet' }).click();

    await expect(page.locator('.connection-outcome')).toContainText(/already connected/i);
    await expect(homeCard(page, 'Sunshine Childrens Home')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  });

  test('home cards show friendly sync status labels, never raw codes', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    backend.on('listShelterHomes', () => ({
      body: { success: true, data: { shelterHomes: [makeHome({ currentImportVersionId: 'iv-1' })] } },
    }));
    backend.on('getImportStatus', () => ({
      body: {
        success: true,
        data: { imports: [{ shelterHomeId: 'home-1', status: 'COMPLETED', versionNumber: 3 }] },
      },
    }));

    await page.goto('/#/homes');

    await expect(homeCard(page, 'Sunshine Childrens Home')).toBeVisible();
    const status = homeCard(page, 'Sunshine Childrens Home').locator('dd').filter({ hasText: /Synced|Sync needed|Checking status|Syncing/ });
    await expect(status).toBeVisible();

    const cardText = await homeCard(page, 'Sunshine Childrens Home').innerText();
    expect(cardText).not.toMatch(/COMPLETED_WITH|IN_PROGRESS|PARTICIPANT_IMPORT_FAILED/);
    expect(pageErrors).toEqual([]);
  });

  test('archive previews real impact counts, then archives and lists the home as archived', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [makeHome()];

    await signIn(page);
    await page.goto('/#/homes');

    backend.on('listShelterHomes', (request) => ({
      body: {
        success: true,
        data: {
          shelterHomes: (request.payload as { includeArchived?: boolean } | undefined)?.includeArchived
            ? homes
            : homes.filter((home) => home.status !== 'ARCHIVED'),
        },
      },
    }));
    backend.on('previewShelterHomeArchive', () => ({
      body: {
        success: true,
        data: {
          shelterHome: { id: 'home-1', homeCode: 'SH-001', homeName: 'Sunshine Childrens Home', status: 'ACTIVE' },
          source: { spreadsheetName: 'Sunshine Home Register', sourceStatus: 'CONNECTED', spreadsheetOpenUrl: '' },
          impact: {
            participantCount: 12,
            activeRegistrationCount: 8,
            attendanceCount: 30,
            scoreCount: 6,
            certificateCount: 4,
            auditHistoryCount: 41,
          },
          triggerCleanupRequired: true,
        },
      },
    }));
    backend.on('archiveShelterHome', () => {
      homes[0] = { ...homes[0], status: 'ARCHIVED', version: 2 };
      return {
        body: {
          success: true,
          data: {
            shelterHomeId: 'home-1',
            status: 'ARCHIVED',
            version: 2,
            triggerRemoved: true,
            impact: {
              participantCount: 12,
              activeRegistrationCount: 8,
              attendanceCount: 30,
              scoreCount: 6,
              certificateCount: 4,
              auditHistoryCount: 41,
            },
          },
        },
      };
    });

    await homeCard(page, 'Sunshine Childrens Home').getByRole('button', { name: 'Archive…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Archive Sunshine Childrens Home');
    await expect(dialog).toContainText('12');
    await expect(dialog).toContainText('41');

    await dialog.getByRole('button', { name: 'Archive home' }).click();

    await expect(page.locator('.alert.success')).toContainText('Sunshine Childrens Home archived.');
    await expect(homeCard(page, 'Sunshine Childrens Home')).toHaveCount(0);
    await expect(page.locator('.archived-homes')).toContainText('Sunshine Childrens Home');
    expect(pageErrors).toEqual([]);
  });

  test('restoring an archived home returns it to the connected list', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const homes: MutableHome[] = [makeHome({ status: 'ARCHIVED', version: 2 })];

    await signIn(page);
    await page.goto('/#/homes');

    backend.on('listShelterHomes', (request) => ({
      body: {
        success: true,
        data: {
          shelterHomes: (request.payload as { includeArchived?: boolean } | undefined)?.includeArchived
            ? homes
            : homes.filter((home) => home.status !== 'ARCHIVED'),
        },
      },
    }));
    backend.on('restoreShelterHome', () => {
      homes[0] = { ...homes[0], status: 'ACTIVE', version: 3 };
      return {
        body: {
          success: true,
          data: { shelterHomeId: 'home-1', status: 'ACTIVE', version: 3, triggerReinstallRequired: true },
        },
      };
    });

    // No active cards, the archived section lists the home with Restore.
    await expect(page.locator('.archived-homes')).toBeVisible();
    await expect(page.locator('.archived-homes')).toContainText('Sunshine Childrens Home');
    await page.locator('.archived-homes').getByRole('button', { name: 'Restore' }).click();

    await expect(homeCard(page, 'Sunshine Childrens Home')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
