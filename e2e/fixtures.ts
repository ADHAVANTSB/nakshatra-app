import { test as base, expect, type Page } from '@playwright/test';

import { BackendStub, adminUser, certificateTeamUser, makeCredential, type StubUser } from './stubs/backend';

const fourHoursFromNow = (): string => new Date(Date.now() + 4 * 3_600_000).toISOString();

/**
 * Fixtures for the mocked E2E suite. Every test gets a `backend` stub that
 * intercepts all Apps Script traffic before it leaves the browser and aborts
 * anything unmocked (see e2e/stubs/backend.ts).
 */
export const test = base.extend<{ backend: BackendStub }>({
  backend: [
    async ({ page }, use) => {
      const backend = new BackendStub();
      await backend.install(page);
      await use(backend);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Storage key the app's ProgramContextService persists the programme/zone
 * scope under (src/app/core/constants/program-context.config.ts). Duplicated
 * here because E2E transpiles without typechecking src imports.
 */
const PROGRAM_SCOPE_STORAGE_KEY = 'nakshatra.programScope';

export interface ScopeSeed {
  program: 'ARTS' | 'SPORTS';
  zone: 'ZONE_1' | 'ZONE_2' | 'TEST';
}

/**
 * Seeds the programme/zone scope into sessionStorage before the app boots.
 *
 * The seed only applies when the key is absent, so journeys that switch scope
 * mid-test are never clobbered by a later navigation.
 */
export function seedScope(page: Page, scope: ScopeSeed): Promise<void> {
  return page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, value);
      }
    },
    [PROGRAM_SCOPE_STORAGE_KEY, JSON.stringify({ programId: scope.program, zoneId: scope.zone })] as const,
  );
}

/**
 * Signs in through the real login UI with the stubbed Google Identity script
 * (MOCKED sign-in). The credential is crafted locally; no Google service is
 * contacted.
 *
 * By default the post-sign-in scope is pre-seeded as Arts → TEST so the
 * established sample-data workflow journeys keep exercising real page
 * content (live zones are data-gated until the backend enforces isolation).
 * Pass `scope: false` to exercise the real selection flow, or an explicit
 * `ScopeSeed` (e.g. `{ program: 'ARTS', zone: 'ZONE_1' }`) for journeys that
 * verify live-zone behaviour.
 */
export async function signIn(
  page: Page,
  options: { user?: StubUser; backend?: BackendStub; scope?: ScopeSeed | false } = {},
): Promise<void> {
  const user = options.user ?? adminUser;
  const scope = options.scope === false ? null : (options.scope ?? { program: 'ARTS', zone: 'TEST' });
  if (options.backend) {
    // The verification response must confirm the SAME identity as the
    // credential, or the test would silently sign in as the wrong role.
    options.backend.loginResponder = () => ({
      body: {
        success: true,
        access: 'APPROVED',
        user,
        data: { applicationSession: { id: 'e2e-session-1', expiresAt: fourHoursFromNow() } },
      },
    });
  }
  const credential = makeCredential(user.email, user.displayName);
  await page.addInitScript(
    ([stubCredential]) => {
      window.__stubCredential = stubCredential;
    },
    [credential],
  );
  if (scope) {
    await seedScope(page, scope);
  }

  await page.goto('/#/login');
  const googleButton = page.getByTestId('stub-google-signin');
  await googleButton.waitFor({ state: 'visible' });
  await googleButton.click();
  await page.waitForURL(scope ? '**/dashboard' : '**/select-program');
}

/**
 * Collects uncaught page exceptions so journeys can assert that no core flow
 * crashed the application. Console messages are not failures by themselves;
 * uncaught exceptions are.
 */
export function monitorPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

export { adminUser, certificateTeamUser };
