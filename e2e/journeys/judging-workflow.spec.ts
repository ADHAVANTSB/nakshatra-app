import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import { adminUser, type BackendStub, type StubUser } from '../stubs/backend';

/**
 * Judging → Scoring → Finalize → Results journey (MOCKED backend).
 *
 * HONEST SCOPE: this journey runs against the local Angular dev server and
 * the in-test backend stub (`e2e/stubs/backend.ts`) — NOT the real Apps
 * Script. The stub mirrors the Code.gs semantics for the judging workflow
 * (one judge-score row per judge + participant, official score = average of
 * submitted judge totals, finalize gated on complete submissions) so the UI
 * flow can be exercised end to end. True authorization, scope isolation and
 * scoring rules are enforced and verified against the REAL backend in
 * `backend-verification` (test-judging-flow / test-judge-aggregation /
 * test-legacy-scoring-gate / test-zone-isolation) — never in this stub.
 */

const EVENT = {
  id: 'event-1',
  eventCode: 'ART-001',
  name: 'Clay Modelling',
  category: 'ARTS',
  mode: 'SOLO',
  eligibleLevels: ['SUB_JUNIOR', 'JUNIOR', 'SENIOR', 'SUPER_SENIOR'],
  status: 'ACTIVE',
  scoringMode: 'CRITERIA',
  criteria: [
    { name: 'Creativity', max: 10 },
    { name: 'Relevance to topic', max: 10 },
    { name: 'Usage of materials', max: 10 },
    { name: 'Perfection', max: 10 },
  ],
};

const HOME = {
  id: 'home-1',
  homeCode: 'SH-001',
  homeName: 'Sunshine Childrens Home',
  address: '12 Lake Road',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
  sourceStatus: 'CONNECTED',
};

const PARTICIPANTS = [
  { id: 'p-1', participantCode: 'P-001', fullName: 'Bhavana M' },
  { id: 'p-2', participantCode: 'P-002', fullName: 'Deepa R' },
  { id: 'p-3', participantCode: 'P-003', fullName: 'Chandru K' },
].map(person => ({
  ...person,
  shelterHomeId: 'home-1',
  gender: 'FEMALE',
  age: 12,
  standard: 7,
  level: 'JUNIOR',
  eligibilityStatus: 'ELIGIBLE',
  validationStatus: 'PASSED',
  approvalStatus: 'APPROVED',
  lockStatus: 'UNLOCKED',
  version: 1,
  createdAt: '2026-09-02T08:00:00.000Z',
  createdBy: 'e2e-stub',
  updatedAt: '2026-09-02T08:00:00.000Z',
  updatedBy: 'e2e-stub',
}));

interface StubJudge {
  id: string;
  eventId: string;
  judgeNumber: number;
  name: string;
  status: string;
}

interface StubJudgeScore {
  id: string;
  eventId: string;
  judgeId: string;
  participantId: string;
  criteria: Array<{ name: string; score: number }>;
  score: number;
  status: 'DRAFT' | 'SUBMITTED';
  version: number;
  updatedAt: string;
  updatedBy: string;
}

interface StubOfficialScore {
  id: string;
  eventId: string;
  participantId: string;
  value: number;
  status: 'DRAFT' | 'FINALIZED';
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** Persisted ResultApprovals row exactly as the backend stores/returns it. */
interface StubApproval {
  id: string;
  eventId: string;
  decision: string;
  comments: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

interface JudgeWorkflowState {
  judges: StubJudge[];
  judgeScores: StubJudgeScore[];
  official: StubOfficialScore[];
  finalized: boolean;
  approvals: StubApproval[];
}

const CRITERIA_NAMES = EVENT.criteria.map(criterion => criterion.name);
const sumOf = (criteria: Array<{ score: number }>): number =>
  criteria.reduce((total, criterion) => total + criterion.score, 0);

/**
 * Stateful judging-workflow stub: judges and judge scores persist across
 * requests (and page reloads) within one test, and the official Scores rows
 * are recomputed exactly like Code.gs `writeOfficialScoreAverages` (average
 * of the SUBMITTED totals of active judges, DRAFT until finalizeEvent).
 */
function installJudgeWorkflow(backend: BackendStub): JudgeWorkflowState {
  const state: JudgeWorkflowState = {
    judges: [],
    judgeScores: [],
    official: [],
    finalized: false,
    approvals: [],
  };

  const json = (data: unknown) => ({ body: { success: true, data } });
  const reject = (code: string, message: string) => ({
    body: { success: false, error: { code, message } },
  });

  /** Mirrors the backend aggregation: official = average of submitted totals. */
  const recomputeOfficial = (): void => {
    for (const participant of PARTICIPANTS) {
      const totals = state.judgeScores
        .filter(row =>
          row.participantId === participant.id &&
          row.status === 'SUBMITTED' &&
          state.judges.some(judge => judge.id === row.judgeId && judge.status !== 'REMOVED') &&
          row.criteria.length === CRITERIA_NAMES.length)
        .map(row => sumOf(row.criteria));
      if (!totals.length) continue;
      const average = totals.reduce((a, b) => a + b, 0) / totals.length;
      const existing = state.official.find(row => row.participantId === participant.id);
      if (existing) {
        if (existing.status === 'FINALIZED') continue;
        if (existing.value !== average) {
          existing.value = average;
          existing.version += 1;
        }
      } else {
        state.official.push({
          id: `sc-${participant.id}`,
          eventId: EVENT.id,
          participantId: participant.id,
          value: average,
          status: 'DRAFT',
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'e2e-stub',
        });
      }
    }
  };

  backend.on('listEvents', () => json({ events: [EVENT] }));
  backend.on('listShelterHomes', () => json({ shelterHomes: [HOME] }));
  backend.on('listParticipants', () => json({ participants: PARTICIPANTS }));
  backend.on('listEventRegistrations', () => json({
    participantEvents: PARTICIPANTS.map((person, index) => ({
      id: `reg-${index + 1}`,
      participantId: person.id,
      eventId: EVENT.id,
      registrationStatus: 'REGISTERED',
      version: 1,
    })),
  }));
  backend.on('listAttendance', () => json({
    attendance: PARTICIPANTS.map((person, index) => ({
      id: `att-${index + 1}`,
      eventId: EVENT.id,
      participantId: person.id,
      teamId: '',
      status: 'PRESENT',
      version: 1,
      createdAt: '',
      createdBy: 'e2e-stub',
      updatedAt: '',
      updatedBy: 'e2e-stub',
    })),
  }));

  backend.on('listEventJudges', () => json({ judges: state.judges }));
  backend.on('listJudgeScores', () => json({ scores: state.judgeScores }));

  backend.on('saveEventJudges', request => {
    const payload = request['payload'] as { judges?: Array<{ name: string }> };
    const names = (payload?.judges ?? []).map(judge => judge.name.trim());
    // Same upsert semantics as Code.gs: a saved name keeps its judge (and
    // scores); missing names are removed; new names are added. Re-sending
    // the same list can never duplicate judges.
    const next: StubJudge[] = names.map((name, index) => {
      const existing = state.judges.find(judge => judge.name === name);
      return existing
        ? { ...existing, judgeNumber: index + 1, name }
        : { id: `judge-${state.judges.length + index + 1}`, eventId: EVENT.id, judgeNumber: index + 1, name, status: 'ACTIVE' };
    });
    state.judges = next;
    return json({ judges: state.judges });
  });

  backend.on('saveJudgeScores', request => {
    const payload = request['payload'] as {
      judgeId: string;
      entries: Array<{ participantId: string; criteria?: Array<{ name: string; score: number }> }>;
      status?: 'DRAFT' | 'SUBMITTED';
    };
    for (const entry of payload.entries ?? []) {
      const criteria = (entry.criteria ?? [])
        .slice()
        .sort((a, b) => CRITERIA_NAMES.indexOf(a.name) - CRITERIA_NAMES.indexOf(b.name));
      const key = `${payload.judgeId}|${entry.participantId}`;
      const existing = state.judgeScores.find(row => `${row.judgeId}|${row.participantId}` === key);
      const status = payload.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
      if (existing) {
        existing.criteria = criteria;
        existing.score = sumOf(criteria);
        existing.status = status;
        existing.version += 1;
      } else {
        state.judgeScores.push({
          id: `jsc-${key}`,
          eventId: EVENT.id,
          judgeId: payload.judgeId,
          participantId: entry.participantId,
          criteria,
          score: sumOf(criteria),
          status,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'e2e-stub',
        });
      }
    }
    recomputeOfficial();
    return json({ scores: state.judgeScores });
  });

  backend.on('listScores', () => json({
    scores: state.official.map(row => ({ ...row })),
  }));

  backend.on('finalizeEvent', () => {
    // Complete-set gate first: every active judge must have a SUBMITTED row
    // for every participant. A refused finalize writes NOTHING.
    const missing = PARTICIPANTS.flatMap(participant =>
      state.judges
        .filter(judge => judge.status !== 'REMOVED')
        .filter(judge => !state.judgeScores.some(row =>
          row.judgeId === judge.id &&
          row.participantId === participant.id &&
          row.status === 'SUBMITTED'))
        .map(judge => `${judge.name} → ${participant.fullName}`));
    if (missing.length) {
      return reject('JUDGE_SCORES_INCOMPLETE', `Missing judge submissions: ${missing.join(', ')}`);
    }
    recomputeOfficial();
    for (const row of state.official) row.status = 'FINALIZED';
    state.finalized = true;
    return json({
      eventId: EVENT.id,
      operationId: 'op-1',
      alreadyFinalized: false,
      finalizedCount: state.official.length,
      totalScores: state.official.length,
      scores: [],
    });
  });

  backend.on('listResults', () => json({
    results: state.official
      .filter(row => row.status === 'FINALIZED')
      .map(row => ({
        scoreId: row.id,
        eventId: EVENT.id,
        eventCode: EVENT.eventCode,
        eventName: EVENT.name,
        category: EVENT.category,
        mode: EVENT.mode,
        participantId: row.participantId,
        participantCode: PARTICIPANTS.find(person => person.id === row.participantId)?.participantCode,
        fullName: PARTICIPANTS.find(person => person.id === row.participantId)?.fullName,
        shelterHomeId: 'home-1',
        shelterHomeName: HOME.homeName,
        score: row.value,
        finalizedAt: row.updatedAt,
      })),
    // The persisted reviewer decisions, so a reload re-reads the accepted
    // state exactly like Code.gs `listResults`.
    resultApprovals: state.approvals.map(row => ({ ...row })),
  }));

  backend.on('saveResultApproval', request => {
    const payload = request['payload'] as { eventId: string; decision: string; comments?: string };
    // Code.gs semantics: exactly one persisted approval row per event
    // (upsert) and the response returns the stored record.
    const index = state.approvals.findIndex(row => row.eventId === payload.eventId);
    const now = new Date().toISOString();
    const record: StubApproval = index === -1
      ? {
          id: `ap-${state.approvals.length + 1}`,
          eventId: payload.eventId,
          decision: payload.decision,
          comments: payload.comments ?? '',
          version: 1,
          createdAt: now,
          createdBy: 'e2e-stub',
          updatedAt: now,
          updatedBy: 'e2e-stub',
        }
      : {
          ...state.approvals[index],
          decision: payload.decision,
          comments: payload.comments ?? '',
          version: state.approvals[index].version + 1,
          updatedAt: now,
          updatedBy: 'e2e-stub',
        };
    if (index === -1) state.approvals.push(record);
    else state.approvals[index] = record;
    return json({ resultApproval: record });
  });

  return state;
}

/** One judge's per-criterion values for all three participants. */
async function fillJudgeGrid(page: import('@playwright/test').Page, values: number[]): Promise<void> {
  const inputs = page.locator('input.score-input');
  await expect(inputs).toHaveCount(values.length * CRITERIA_NAMES.length);
  for (let participant = 0; participant < values.length; participant++) {
    for (let criterion = 0; criterion < CRITERIA_NAMES.length; criterion++) {
      await inputs.nth(participant * CRITERIA_NAMES.length + criterion).fill(String(values[participant]));
    }
  }
}

test.describe('judging workflow journey', () => {
  test('judges configure, score, and finalize into official ranked results', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state = installJudgeWorkflow(backend);
    await signIn(page);

    // ---- /judging: two named judges, confirmed and saved ----
    await page.goto('/#/judging?eventId=event-1');
    await expect(page.getByRole('heading', { level: 1, name: 'Judging' })).toBeVisible();

    await page.getByRole('button', { name: '+ Add judge' }).click();
    await page.getByRole('button', { name: '+ Add judge' }).click();
    await page.getByLabel('Judge 1 name').fill('Ram');
    await page.getByLabel('Judge 2 name').fill('Shyam');
    await page.getByRole('button', { name: 'Confirm & Save Judges' }).click();

    // Backend-confirmed success (the stub stored the list), not just a toast.
    await expect(page.locator('body')).toContainText('Judges confirmed and saved.');
    expect(state.judges.map(judge => judge.name)).toEqual(['Ram', 'Shyam']);
    expect(backend.requests.filter(request => request.action === 'saveEventJudges')).toHaveLength(1);

    // ---- reload: the judges persist (the app re-enters at /dashboard after a
    // refresh by design, so we return to /judging against fresh client state) ----
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/#/judging?eventId=event-1');
    await expect(page.locator('body')).toContainText('Judge 1 — Ram');
    await expect(page.locator('body')).toContainText('Judge 2 — Shyam');

    // ---- /scoring: both judges appear WITHOUT reconfiguration ----
    await page.goto('/#/scoring?eventId=event-1');
    await expect(page.getByRole('button', { name: /Judge 1 — Ram/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Judge 2 — Shyam/ })).toBeVisible();

    // ---- the criteria panel shows the exact official ART-001 set ----
    const criteriaChips = page.locator('.criteria-chip');
    await expect(criteriaChips).toHaveCount(CRITERIA_NAMES.length);
    for (const name of CRITERIA_NAMES) {
      await expect(criteriaChips.filter({ hasText: name })).toHaveCount(1);
    }

    // ---- Judge 1 scores the PRESENT participants and saves a DRAFT ----
    await fillJudgeGrid(page, [8, 7, 6]);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('body')).toContainText('Draft scores saved.');

    const draftRows = state.judgeScores.filter(row => row.status === 'DRAFT');
    expect(draftRows).toHaveLength(3);
    expect(draftRows.every(row => row.score === 32 || row.score === 28 || row.score === 24)).toBe(true);

    // ---- reload: the draft values persist ----
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/#/scoring?eventId=event-1');
    await expect(page.locator('input.score-input').first()).toHaveValue('8');

    // ---- Judge 2 scores and SUBMITS ----
    await page.getByRole('button', { name: /Judge 2 — Shyam/ }).click();
    await fillJudgeGrid(page, [6, 7, 5]);
    await page.getByRole('button', { name: 'Submit final scores' }).click();
    await expect(page.locator('body')).toContainText('Final scores submitted.');

    // ---- reload: values + statuses are what the backend holds ----
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/#/scoring?eventId=event-1');
    await expect(page.locator('body')).toContainText('Draft saved');
    await expect(page.locator('body')).toContainText('Submitted');

    // ---- finalize attempt with a missing submission: REJECTED, zero writes ----
    const finalizeButton = page.getByRole('button', { name: 'Finalize Event' });
    await expect(finalizeButton).toBeDisabled();
    await expect(page.locator('body')).toContainText('Finalization is not available yet.');
    await expect(page.locator('body')).toContainText('Still missing: Ram → Bhavana M');
    expect(backend.requests.some(request => request.action === 'finalizeEvent')).toBe(false);
    expect(state.finalized).toBe(false);
    expect(state.official.every(row => row.status === 'DRAFT')).toBe(true);

    // ---- Judge 1 completes the submission; finalize now succeeds ----
    await page.getByRole('button', { name: /Judge 1 — Ram/ }).click();
    await fillJudgeGrid(page, [8, 7, 6]);
    await page.getByRole('button', { name: 'Submit final scores' }).click();
    await expect(page.locator('body')).toContainText('Final scores submitted.');

    await page.getByRole('button', { name: 'Finalize Event' }).click();
    await expect(page.locator('body')).toContainText('Event finalized.');
    expect(state.finalized).toBe(true);
    expect(state.official.every(row => row.status === 'FINALIZED')).toBe(true);

    // The finalize routes to /results: official averages + DENSE_RANK ties.
    await expect(page).toHaveURL(/\/#\/results/);
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible();
    await page.getByRole('button', { name: /Open full results/ }).click();
    await expect(page.locator('body')).toContainText('Official results');
    // Averages: (32+24)/2 = 28, (28+28)/2 = 28, (24+20)/2 = 22 → 1, 1, 2.
    await expect(page.getByText('🥇 1st')).toHaveCount(2);
    await expect(page.getByText('🥈 2nd')).toHaveCount(1);

    // ---- approval + certificate eligibility ----
    await expect(page.locator('body')).toContainText('Certificate eligibility');
    await expect(page.locator('body')).toContainText('eligible for certificates');
    await page.getByRole('button', { name: 'Accept Results' }).first().click();
    await page.getByRole('button', { name: 'Accept Results' }).last().click();
    await expect(page.locator('body')).toContainText('Results accepted.');
    expect(state.approvals).toHaveLength(1);

    // The acceptance is terminal: BOTH action buttons are replaced by the
    // read-only completion state …
    await expect(page.locator('body')).toContainText('Results Accepted');
    await expect(page.locator('body')).toContainText('Completed');
    await expect(page.getByRole('button', { name: 'Accept Results' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline / Return for Correction' })).toHaveCount(0);

    // … and the accepted state survives a reload (re-read from the backend).
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/#/results');
    await page.getByRole('button', { name: /Open full results/ }).click();
    await expect(page.locator('body')).toContainText('Results Accepted');
    await expect(page.getByRole('button', { name: 'Accept Results' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline / Return for Correction' })).toHaveCount(0);
    expect(state.approvals).toHaveLength(1);

    // ---- finalized scores are not editable on /scoring ----
    await page.goto('/#/scoring?eventId=event-1');
    await expect(page.locator('body')).toContainText('This event has been finalized. Attendance and scores are locked.');
    const lockedInputs = page.locator('input.score-input');
    for (let index = 0; index < await lockedInputs.count(); index++) {
      await expect(lockedInputs.nth(index)).toBeDisabled();
    }

    expect(pageErrors).toEqual([]);
  });

  test('no legacy score entry can bypass the judging workflow', async ({ page, backend }) => {
    const state = installJudgeWorkflow(backend);
    await signIn(page);

    await page.goto('/#/judging?eventId=event-1');
    await page.goto('/#/scoring?eventId=event-1');
    await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible();

    // The legacy manual controls are gone from the page…
    await expect(page.getByRole('button', { name: 'Save scores' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    // …and no legacy score action was ever sent for any page visited.
    const legacyActions = new Set(['saveScore', 'updateScore', 'finalizeScore', 'saveEventScores']);
    expect(backend.requests.filter(request => legacyActions.has(request.action))).toEqual([]);
    expect(state.official).toEqual([]);
  });

  for (const role of ['LIAISON_TEAM', 'CERTIFICATE_TEAM'] as const) {
    test(`${role.replace('_', ' ').toLowerCase()} cannot reach score entry`, async ({ page, backend }) => {
      const user: StubUser = {
        ...adminUser,
        id: `e2e-user-${role.toLowerCase()}`,
        googleId: `e2e-google-${role.toLowerCase()}`,
        email: `${role.toLowerCase()}@e2e.example.com`,
        displayName: `${role} (E2E)`,
        role,
      };
      await signIn(page, { user, backend });
      await page.goto('/#/scoring?eventId=event-1');
      // The SCORING section is not in these roles' matrix: the guard keeps
      // them off the page entirely (the backend remains the real boundary).
      await expect(page).not.toHaveURL(/scoring/);
      await expect(page.getByRole('button', { name: 'Submit final scores' })).toHaveCount(0);
      await page.goto('/#/judging?eventId=event-1');
      await expect(page).not.toHaveURL(/judging/);
      await expect(page.getByRole('button', { name: 'Confirm & Save Judges' })).toHaveCount(0);
    });
  }

  test('an out-of-scope zone never sees another scope’s judging records', async ({ page, backend }) => {
    const state = installJudgeWorkflow(backend);
    await signIn(page, { scope: { program: 'ARTS', zone: 'ZONE_1' } });

    // Seed judges through an in-scope call first (the same stub state).
    await page.goto('/#/judging?eventId=event-1');
    await page.getByRole('button', { name: '+ Add judge' }).click();
    await page.getByLabel('Judge 1 name').fill('Ram');
    await page.getByRole('button', { name: 'Confirm & Save Judges' }).click();
    expect(state.judges.map(judge => judge.name)).toEqual(['Ram']);

    // Now the backend answers like Code.gs for an out-of-scope read: the UI
    // must show the refusal and NO judging data. (Scope enforcement itself is
    // verified against the real backend in test-zone-isolation.)
    backend.on('listEventJudges', () => ({
      body: {
        success: false,
        error: { code: 'SCOPE_MISMATCH', message: 'This record belongs to a different programme/environment scope.' },
      },
    }));
    await page.goto('/#/dashboard');
    await page.goto('/#/judging?eventId=event-1');
    await expect(page.locator('body')).toContainText('Judges could not be loaded.');
    await expect(page.locator('body')).toContainText('code: SCOPE_MISMATCH');
    await expect(page.locator('body')).not.toContainText('Judge 1 — Ram');
  });
});
