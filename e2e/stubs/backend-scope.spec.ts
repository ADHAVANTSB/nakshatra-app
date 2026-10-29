import { test, expect, type Page, type Route } from '@playwright/test';

import { BackendStub } from './backend';

/**
 * Focused regression tests for the validateSession scope echo (Zone 2 Step 6).
 *
 * Drives the stub's Apps Script handler through the exact route wiring
 * install() registers, using a Route double - no browser and no dev server
 * content are needed. The precedence under test:
 *
 *   1. a later seedScope() supersedes an earlier one (no first-seed-wins);
 *   2. an explicit selectScope persistence wins over any seeded header;
 *   3. an explicit validateSession override wins over the echo entirely.
 */

type Handler = (route: Route) => Promise<void>;

/** Installs the stub on a Page double and returns its Apps Script handler. */
async function appsScriptHandler(backend: BackendStub): Promise<Handler> {
  const routes: Array<{ pattern: unknown; handler: Handler }> = [];
  const fakePage = {
    route: (pattern: unknown, handler: Handler) => {
      routes.push({ pattern, handler });
      return Promise.resolve();
    },
  };
  await backend.install(fakePage as unknown as Page);
  const match = routes.find(
    (r) => typeof r.pattern === 'string' && r.pattern.includes('script.google.com'),
  );
  if (!match) throw new Error('stub did not register an Apps Script route');
  return match.handler;
}

/** A Route double that captures the fulfilled JSON body (or a null on abort). */
function fakeRoute(
  body: unknown,
  headers: Record<string, string> = {},
): { route: Route; response: () => unknown } {
  let fulfilled: unknown = null;
  const route = {
    request: () => ({ postData: () => JSON.stringify(body), headers: () => headers }),
    fulfill: (r: { body: string }) => {
      fulfilled = JSON.parse(r.body);
    },
    abort: () => {
      fulfilled = null;
    },
  };
  return { route: route as unknown as Route, response: () => fulfilled };
}

/** The header seedScope() puts on every request (same shape as its storage seed). */
const seedHeader = (programId: string, zoneId: string): Record<string, string> => ({
  'x-e2e-scope': JSON.stringify({ programId, zoneId }),
});

/** Sends one validateSession action and returns its response body. */
async function validateSession(
  handler: Handler,
  headers: Record<string, string>,
): Promise<{ data: { session: { programId?: string; environmentId?: string } } }> {
  const { route, response } = fakeRoute({ action: 'validateSession', payload: {} }, headers);
  await handler(route);
  return response() as { data: { session: { programId?: string; environmentId?: string } } };
}

test.describe('BackendStub.validateSession scope echo (Zone 2 Step 6)', () => {
  test('a later seedScope supersedes an earlier one', async () => {
    const backend = new BackendStub();
    const handler = await appsScriptHandler(backend);

    // Seed A, then reseed B - the echo must reflect B.
    await validateSession(handler, seedHeader('ARTS', 'ZONE_1'));
    const echoed = await validateSession(handler, seedHeader('ARTS', 'ZONE_2'));

    expect(echoed.data.session.programId).toBe('ARTS');
    expect(echoed.data.session.environmentId).toBe('ZONE_2');
  });

  test('an explicit selectScope persistence wins over the seeded header', async () => {
    const backend = new BackendStub();
    const handler = await appsScriptHandler(backend);

    await validateSession(handler, seedHeader('ARTS', 'ZONE_1'));
    const select = fakeRoute(
      { action: 'selectScope', payload: { programId: 'SPORTS', environmentId: 'ZONE_2' } },
      seedHeader('ARTS', 'ZONE_2'),
    );
    await handler(select.route);

    // The header says ARTS/ZONE_2; the explicit selectScope must still win.
    const echoed = await validateSession(handler, seedHeader('ARTS', 'ZONE_2'));
    expect(echoed.data.session.programId).toBe('SPORTS');
    expect(echoed.data.session.environmentId).toBe('ZONE_2');
  });

  test('an explicit validateSession override wins over the echo', async () => {
    const backend = new BackendStub();
    const handler = await appsScriptHandler(backend);
    backend.on('validateSession', () => ({
      body: { success: true, data: { session: { programId: 'OVERRIDE', environmentId: 'ZONE_1' } } },
    }));

    // The echo must never touch an overridden response.
    const echoed = await validateSession(handler, seedHeader('ARTS', 'ZONE_2'));
    expect(echoed.data.session.programId).toBe('OVERRIDE');
    expect(echoed.data.session.environmentId).toBe('ZONE_1');
  });
});
