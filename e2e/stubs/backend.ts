import type { Page, Route } from '@playwright/test';

/**
 * Network-layer backend stub for mocked E2E runs.
 *
 * Safety contract:
 * - ALL requests to the real Apps Script endpoint are intercepted before they
 *   leave the browser. Known, mocked actions get disposable test data.
 * - Any UNMOCKED action, any request with an unrecognized body, and any other
 *   non-localhost request is ABORTED. Nothing can reach production.
 *
 * The Google Identity Services script is replaced with a tiny stub that
 * renders a test button and replays a locally crafted credential, so no real
 * Google account, OAuth flow, or token is involved (tests are labeled MOCKED).
 */

export type StubRole = 'ADMIN' | 'SUPPORT' | 'EVENTS_TEAM' | 'LIAISON_TEAM' | 'CERTIFICATE_TEAM';

export interface StubUser {
  id: string;
  googleId: string;
  email: string;
  displayName: string;
  role: StubRole;
  accessStatus: 'APPROVED';
  version: number;
}

export const adminUser: StubUser = {
  id: 'e2e-user-admin',
  googleId: 'e2e-google-admin',
  email: 'praveen.e2e@example.com',
  displayName: 'Praveen (E2E)',
  role: 'ADMIN',
  accessStatus: 'APPROVED',
  version: 3,
};

export const certificateTeamUser: StubUser = {
  ...adminUser,
  id: 'e2e-user-certs',
  googleId: 'e2e-google-certs',
  email: 'certs.e2e@example.com',
  displayName: 'Certificate Team (E2E)',
  role: 'CERTIFICATE_TEAM',
};

export interface StubResponse {
  status?: number;
  body: unknown;
  /** Abort the request like a hard network failure (no response at all). */
  abort?: boolean;
  /** Serve a raw non-JSON body (Apps Script error pages, HTML gateways). */
  raw?: string;
  contentType?: string;
}

export type StubResponder = (request: Record<string, unknown>) => StubResponse | Promise<StubResponse>;

export interface RecordedRequest {
  action: string;
  payload: unknown;
}

/** Builds a minimal three-part JWT carrying only the claims the UI decodes. */
export function makeCredential(email: string, name: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ email, name })}.signature`;
}

const fourHoursFromNow = (): string => new Date(Date.now() + 4 * 3_600_000).toISOString();

/**
 * Empty-but-valid data per authenticated action. Journeys override the
 * actions they exercise with realistic fixture data; anything not listed and
 * not overridden is aborted (never proxied to production).
 */
const DEFAULT_DATA: Record<string, unknown> = {
  listShelterHomes: { shelterHomes: [] },
  listShelterSheets: { shelterSheets: [] },
  listEvents: { events: [] },
  listParticipants: { participants: [] },
  listParticipantEvents: { participantEvents: [] },
  listEventRegistrations: { participantEvents: [] },
  listEventDayRegistrations: { eventDayRegistrations: [] },
  listDistributionTracking: {
    storage: {
      available: true,
      status: 'AVAILABLE',
      table: 'DistributionTracking',
      reason: '',
      migrationStep: '',
    },
    distributions: [],
    recordedCount: 0,
    totalWinners: 0,
  },
  listAttendance: { attendance: [] },
  listTeams: { teams: [] },
  listScores: { scores: [] },
  listJudgeScores: { scores: [] },
  listEventJudges: { judges: [] },
  listResults: { results: [] },
  getImportStatus: { imports: [] },
  getValidationResults: { validationResults: [] },
  getDashboardSummary: {
    summary: {
      homes: 0,
      participants: 0,
      events: 0,
      activeEvents: 0,
      registrations: 0,
      teams: 0,
      attendance: { recorded: 0, present: 0, absent: 0 },
      finalizedScores: 0,
      certificates: { generated: 0, issued: 0 },
    },
  },
  getReports: {},
};

/** Envelope defaults for the session lifecycle actions. */
function sessionActionResponse(action: string, user: StubUser): StubResponse | null {
  if (action === 'validateSession') {
    return {
      body: {
        success: true,
        access: 'APPROVED',
        user,
        data: {
          session: {
            expiresAt: fourHoursFromNow(),
            // The stub backend has no real session storage; the scope the app
            // seeded into sessionStorage is authoritative for the journey.
          },
        },
      },
    };
  }
  if (action === 'selectScope') {
    return { body: { success: true, data: { scope: { programId: 'ARTS', environmentId: 'TEST' } } } };
  }
  if (action === 'listWinners') {
    return {
      body: {
        success: true,
        data: { events: [], totalEvents: 0, totalWinners: 0 },
      },
    };
  }
  if (action === 'getCurrentUser') {
    return { body: { success: true, user, data: { user } } };
  }
  if (action === 'logout') {
    return { body: { success: true, data: {} } };
  }
  return null;
}

export class BackendStub {
  /** Every authenticated action the app sent during the test, in order. */
  readonly requests: RecordedRequest[] = [];

  private readonly overrides = new Map<string, StubResponder>();

  /**
   * Response used for the sign-in credential verification POST (the request
   * whose body carries `{ credential }`). Defaults to an approved admin.
   */
  loginResponder: StubResponder = () => ({
    body: {
      success: true,
      access: 'APPROVED',
      user: adminUser,
      data: { applicationSession: { id: 'e2e-session-1', expiresAt: fourHoursFromNow() } },
    },
  });

  /** Overrides the default (or a previously set) response for one action. */
  on(action: string, responder: StubResponder): void {
    this.overrides.set(action, responder);
  }

  /** Convenience: the action always fails with a backend error envelope. */
  failWith(action: string, status: number, code: string, message: string): void {
    this.on(action, () => ({ status, body: { success: false, error: { code, message } } }));
  }

  async install(page: Page): Promise<void> {
    // Registered FIRST: Playwright gives the most recently registered handler
    // priority, so this catch-all only sees requests no specific rule matched.
    await page.route((url) => !url.href.startsWith('http://localhost'), (route) => route.abort());

    await page.route('**/accounts.google.com/gsi/client', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_CLIENT_STUB }),
    );

    await page.route('**/script.google.com/**', (route) => this.handleAppsScript(route));
  }

  private async handleAppsScript(route: Route): Promise<void> {
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    } catch {
      await route.abort();
      return;
    }

    // Sign-in verification POST: body carries a raw `{ credential }`.
    if (typeof request['credential'] === 'string') {
      await respondWith(route, await this.loginResponder(request));
      return;
    }

    const action = request['action'];
    if (typeof action !== 'string') {
      await route.abort();
      return;
    }
    this.requests.push({ action, payload: request['payload'] });

    // The store's batched snapshot read: composed from the same per-action
    // fixtures journeys install (listShelterHomes / listParticipants /
    // getImportStatus / getValidationResults) so journeys keep working.
    if (action === 'getPageData') {
      await respondWith(route, await this.pageDataResponse(request));
      return;
    }

    const resolved = await this.resolveAction(action, request);
    if (resolved) {
      await respondWith(route, resolved);
      return;
    }
    // Unmocked authenticated action: abort — never reach the real endpoint.
    await route.abort();
  }

  /** Resolves one action to its stub response (override, session or default). */
  private async resolveAction(action: string, request: Record<string, unknown>): Promise<StubResponse | null> {
    const override = this.overrides.get(action);
    if (override) {
      return await override(request);
    }
    const sessionResponse = sessionActionResponse(action, adminUser);
    if (sessionResponse) {
      return sessionResponse;
    }
    if (action in DEFAULT_DATA) {
      return { body: { success: true, data: DEFAULT_DATA[action] } };
    }
    return null;
  }

  /** Composes the `getPageData` snapshot from the per-action fixtures. */
  private async pageDataResponse(request: Record<string, unknown>): Promise<StubResponse> {
    const [homes, participants, imports, validations] = await Promise.all([
      this.resolveAction('listShelterHomes', request),
      this.resolveAction('listParticipants', request),
      this.resolveAction('getImportStatus', request),
      this.resolveAction('getValidationResults', request),
    ]);

    const collection = (response: StubResponse | null, key: string): unknown[] => {
      const body = response?.body as { success?: boolean; data?: Record<string, unknown> } | undefined;
      const rows = body?.data?.[key];
      return body?.success !== false && Array.isArray(rows) ? rows : [];
    };

    return {
      body: {
        success: true,
        data: {
          shelterHomes: collection(homes, 'shelterHomes'),
          participants: collection(participants, 'participants'),
          imports: collection(imports, 'imports'),
          validationResults: collection(validations, 'validationResults'),
        },
      },
    };
  }
}

async function respondWith(route: Route, response: StubResponse | undefined): Promise<void> {
  if (!response || response.abort) {
    await route.abort();
    return;
  }
  if (typeof response.raw === 'string') {
    await route.fulfill({
      status: response.status ?? 200,
      contentType: response.contentType ?? 'text/html',
      body: response.raw,
    });
    return;
  }
  await route.fulfill({
    status: response.status ?? 200,
    contentType: 'application/json',
    body: JSON.stringify(response.body),
  });
}

/**
 * Google Identity Services replacement. Records the page's credential
 * callback and renders a normal button that replays the locally crafted
 * credential — no script from accounts.google.com is ever downloaded.
 */
const GSI_CLIENT_STUB = `
(() => {
  window.google = window.google || {};
  window.google.accounts = {
    id: {
      initialize: function (options) { window.__gsiCallback = options.callback; },
      renderButton: function (parent) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-testid', 'stub-google-signin');
        button.textContent = 'Sign in with Google (stub)';
        button.addEventListener('click', function () {
          window.__gsiCallback({ credential: window.__stubCredential });
        });
        parent.appendChild(button);
      },
      prompt: function () {},
      disableAutoSelect: function () {},
    },
  };
})();
`;
