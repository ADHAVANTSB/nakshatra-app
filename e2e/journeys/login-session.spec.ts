import { expect, monitorPageErrors, signIn, test } from '../fixtures';

/**
 * Sign-in & session journeys (checklist area A) — MOCKED.
 *
 * The Google Identity script is replaced at the network boundary and the
 * verification POST is answered locally, so no real OAuth is performed.
 * Journeys exercised: login card without shell, successful sign-in, redirect
 * away from /login while authenticated, session restore on refresh, invalid
 * session handling, transient validation failure, unregistered account.
 */

test.describe('login and session', () => {
  test('shows the sign-in card without the app shell when unauthenticated', async ({ page }) => {
    const pageErrors = monitorPageErrors(page);

    await page.goto('/#/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('aside.nk-sidebar')).toHaveCount(0);
    await expect(page.locator('header.nk-header')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('signs in an approved user and lands on the dashboard', async ({ page }) => {
    const pageErrors = monitorPageErrors(page);

    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // The login card must be gone once the shell takes over (no wrapping).
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
    // The shell is present (on mobile it is an off-canvas drawer, so
    // visibility is asserted by the responsive sweep instead).
    await expect(page.locator('aside.nk-sidebar')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  });

  test('redirects an authenticated visitor who opens /login to the dashboard', async ({ page }) => {
    await signIn(page);

    await page.goto('/#/login');

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  });

  test('restores the session after a page refresh', async ({ page, backend }) => {
    await signIn(page);

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(backend.requests.filter((request) => request.action === 'validateSession').length)
      .toBeGreaterThanOrEqual(1);
  });

  test('refresh on #/login with a valid session lands on the dashboard', async ({ page }) => {
    await signIn(page);

    // A-06: an authenticated visitor refreshing on the sign-in route must be
    // recovered into the application by the startup validation, not left on
    // the login card.
    await page.goto('/#/login');
    await page.reload();

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  });

  test('returns to sign-in when the stored session is no longer valid', async ({ page, backend }) => {
    await signIn(page);

    backend.on('validateSession', () => ({
      body: { success: false, error: { code: 'SESSION_INVALID', message: 'Session is no longer valid.' } },
    }));

    await page.reload();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('keeps the saved session and warns when boot validation fails transiently', async ({ page, backend }) => {
    await signIn(page);

    // A gateway-style failure is transient — the saved session must survive
    // it (not be erased), with a recoverable warning instead of a fake error.
    backend.on('validateSession', () => ({
      status: 502,
      body: { success: false, error: { code: 'INVALID_SESSION_RESPONSE', message: 'Bad gateway' } },
    }));

    await page.reload();

    await expect(page.getByText('Sign-in status could not be verified')).toBeVisible();
    const persisted = await page.evaluate(() => window.sessionStorage.getItem('nakshatra.applicationSession'));
    expect(persisted).not.toBeNull();

    // Signing in again recovers: the next verification succeeds.
    await page.getByTestId('stub-google-signin').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('shows an honest panel for a Google account that is not registered', async ({ page, backend }) => {
    backend.loginResponder = () => ({
      body: {
        success: true,
        access: 'NOT_REGISTERED',
        user: {
          id: 'e2e-stranger',
          googleId: 'e2e-google-stranger',
          email: 'stranger.e2e@example.com',
          displayName: 'Stranger (E2E)',
          accessStatus: 'NOT_REGISTERED',
        },
      },
    });

    await page.addInitScript(() => {
      window.__stubCredential = 'e2e.stranger.credential';
    });
    await page.goto('/#/login');
    await page.getByTestId('stub-google-signin').click();

    await expect(page.getByText('Account not registered')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const persisted = await page.evaluate(() => window.sessionStorage.getItem('nakshatra.applicationSession'));
    expect(persisted).toBeNull();
  });
});
