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
 * Signs in through the real login UI with the stubbed Google Identity script
 * (MOCKED sign-in). The credential is crafted locally; no Google service is
 * contacted.
 */
export async function signIn(
  page: Page,
  options: { user?: StubUser; backend?: BackendStub } = {},
): Promise<void> {
  const user = options.user ?? adminUser;
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

  await page.goto('/#/login');
  const googleButton = page.getByTestId('stub-google-signin');
  await googleButton.waitFor({ state: 'visible' });
  await googleButton.click();
  await page.waitForURL('**/dashboard');
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
