import { expect, monitorPageErrors, signIn, test } from '../fixtures';
import { type BackendStub } from '../stubs/backend';

/**
 * GROUP events score at TEAM level — judging → scoring journey (MOCKED backend).
 *
 * HONEST SCOPE: this journey runs against the local Angular dev server and
 * the in-test backend stub — NOT the real Apps Script. The stub mirrors the
 * Code.gs semantics for team scoring (ONE judge entry per judge + team, a
 * team scoreable only with complete roster attendance) so the UI flow can be
 * exercised end to end. True scoring rules and attendance gates are enforced
 * and verified against the REAL backend in
 * `backend-verification/test-group-team-scoring.js` — never in this stub.
 */

const EVENT = {
  id: 'group-1',
  eventCode: 'LIT-005',
  name: 'Quiz (SJ + J)',
  category: 'LITERARY',
  mode: 'GROUP',
  eligibleLevels: ['JUNIOR'],
  status: 'ACTIVE',
  scoringMode: 'SINGLE',
  criteria: [],
};

const HOME = {
  id: 'home-1',
  homeCode: 'SH-001',
  homeName: 'Sunshine Childrens Home',
  address: '',
  contactName: '',
  contactPhone: '',
  status: 'ACTIVE',
  version: 1,
};

const TEAM_A = {
  id: 'team-a',
  teamCode: 'TM-000A',
  eventId: EVENT.id,
  name: 'Sunshine Quiz Team',
  status: 'READY',
  validationStatus: 'PASSED',
  shelterHomeId: 'home-1',
  version: 1,
  createdAt: '',
  createdBy: '',
  updatedAt: '',
  updatedBy: '',
};

const TEAM_B = {
  ...TEAM_A,
  id: 'team-b',
  teamCode: 'TM-000B',
  name: 'Sunshine Second Team',
};

function participant(id: string, name: string): Record<string, unknown> {
  return {
    id,
    participantCode: `P-${id}`,
    shelterHomeId: 'home-1',
    fullName: name,
    gender: 'FEMALE',
    age: 10,
    standard: 4,
    level: 'JUNIOR',
    eligibilityStatus: 'ELIGIBLE',
    validationStatus: 'PASSED',
    approvalStatus: 'APPROVED',
    lockStatus: 'UNLOCKED',
    version: 1,
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
  };
}

const PARTICIPANTS = [
  participant('p-1', 'Bhavana M'),
  participant('p-2', 'Deepa R'),
  participant('p-3', 'Chandru K'),
  participant('p-4', 'Asha P'),
  participant('p-5', 'Zoya S'),
];

interface StubJudgeScore {
  id: string;
  eventId: string;
  judgeId: string;
  participantId: string;
  scoringEntity: string;
  teamId: string;
  criteria: Array<{ name: string; score: number }>;
  score: number;
  status: 'DRAFT' | 'SUBMITTED';
  version: number;
  updatedAt: string;
  updatedBy: string;
}

interface GroupState {
  attendance: Record<string, string>;
  judgeScores: StubJudgeScore[];
  official: Array<{ id: string; teamId: string; value: number; status: string; version: number }>;
  finalized: boolean;
}

/**
 * Stateful group-scoring stub: roster attendance marks and judge team scores
 * persist across requests (and page reloads) within one test.
 *
 * Team A roster (p-1, p-2, p-3): p-1 + p-2 PRESENT, p-3 ABSENT → scoreable.
 * Team B roster (p-4, p-5): p-4 PRESENT, p-5 NOT marked → blocked until the
 * roster's attendance is completed through the bulk save.
 */
function installGroupScoring(backend: BackendStub): GroupState {
  const state: GroupState = {
    attendance: { 'p-1': 'PRESENT', 'p-2': 'PRESENT', 'p-3': 'ABSENT', 'p-4': 'PRESENT' },
    judgeScores: [],
    official: [],
    finalized: false,
  };

  const json = (data: unknown) => ({ body: { success: true, data } });
  const reject = (code: string, message: string) => ({ body: { success: false, error: { code, message } } });

  const members = [
    { id: 'm-1', teamId: TEAM_A.id, participantId: 'p-1', status: 'ACTIVE', joinedAt: '', joinedBy: '' },
    { id: 'm-2', teamId: TEAM_A.id, participantId: 'p-2', status: 'ACTIVE', joinedAt: '', joinedBy: '' },
    { id: 'm-3', teamId: TEAM_A.id, participantId: 'p-3', status: 'ACTIVE', joinedAt: '', joinedBy: '' },
    { id: 'm-4', teamId: TEAM_B.id, participantId: 'p-4', status: 'ACTIVE', joinedAt: '', joinedBy: '' },
    { id: 'm-5', teamId: TEAM_B.id, participantId: 'p-5', status: 'ACTIVE', joinedAt: '', joinedBy: '' },
  ];

  const rosterOf = (teamId: string): string[] =>
    members.filter(member => member.teamId === teamId).map(member => member.participantId);

  /** Mirrors the backend gate: full explicit attendance and >= 1 PRESENT. */
  const scoreable = (teamId: string): boolean => {
    const roster = rosterOf(teamId);
    return roster.length > 0 &&
      roster.every(participantId => state.attendance[participantId]) &&
      roster.some(participantId => state.attendance[participantId] === 'PRESENT');
  };

  /** Mirrors writeOfficialScoreAverages: official = average of submitted totals. */
  const recomputeOfficial = (): void => {
    for (const team of [TEAM_A, TEAM_B]) {
      const totals = state.judgeScores
        .filter(row => row.teamId === team.id && row.status === 'SUBMITTED')
        .map(row => row.score);
      if (!totals.length) continue;
      const average = totals.reduce((a, b) => a + b, 0) / totals.length;
      const existing = state.official.find(row => row.teamId === team.id);
      if (existing) {
        if (existing.status !== 'FINALIZED' && existing.value !== average) {
          existing.value = average;
          existing.version += 1;
        }
      } else {
        state.official.push({ id: `sc-${team.id}`, teamId: team.id, value: average, status: 'DRAFT', version: 1 });
      }
    }
  };

  backend.on('listEvents', () => json({ events: [EVENT] }));
  backend.on('listShelterHomes', () => json({ shelterHomes: [HOME] }));
  backend.on('listParticipants', () => json({ participants: PARTICIPANTS }));
  backend.on('listTeams', () => json({ teams: [TEAM_A, TEAM_B], members }));
  backend.on('listEventRegistrations', () => json({
    participantEvents: PARTICIPANTS.map((person, index) => ({
      id: `reg-${index + 1}`,
      participantId: person['id'],
      eventId: EVENT.id,
      registrationStatus: 'REGISTERED',
      version: 1,
    })),
  }));
  backend.on('listAttendance', () => json({
    attendance: Object.entries(state.attendance).map(([participantId, status], index) => ({
      id: `att-${index + 1}`,
      eventId: EVENT.id,
      participantId,
      teamId: '',
      status,
      version: 1,
      createdAt: '',
      createdBy: 'e2e-stub',
      updatedAt: '',
      updatedBy: 'e2e-stub',
    })),
  }));
  backend.on('listEventJudges', () => json({
    judges: [{ id: 'judge-1', eventId: EVENT.id, judgeNumber: 1, name: 'Judge One', status: 'ACTIVE' }],
  }));
  backend.on('listJudgeScores', () => json({ scores: state.judgeScores }));
  backend.on('listScores', () => json({
    scores: state.official.map(row => ({
      id: row.id,
      eventId: EVENT.id,
      participantId: '',
      teamId: row.teamId,
      scoringEntity: 'TEAM',
      value: row.value,
      status: row.status,
      version: row.version,
      updatedAt: '',
      updatedBy: '',
    })),
  }));

  backend.on('saveJudgeScores', request => {
    const payload = request['payload'] as {
      judgeId: string;
      entries: Array<{ teamId?: string; participantId?: string; score?: number }>;
      status?: 'DRAFT' | 'SUBMITTED';
    };

    for (const entry of payload.entries ?? []) {
      // Team-level only: a participant entry would be a per-member row.
      if (!entry.teamId || entry.participantId) {
        return reject('TEAM_SCORE_REQUIRED', 'This is a GROUP event: entries must carry a teamId.');
      }
      if (!scoreable(entry.teamId)) {
        return reject('TEAM_ATTENDANCE_INCOMPLETE', 'This team cannot be scored: attendance is incomplete.');
      }
      const key = `${payload.judgeId}|${entry.teamId}`;
      const existing = state.judgeScores.find(row => `${row.judgeId}|${row.teamId}` === key);
      const status = payload.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
      if (existing) {
        existing.score = entry.score ?? existing.score;
        existing.status = status;
        existing.version += 1;
      } else {
        state.judgeScores.push({
          id: `jsc-${key}`,
          eventId: EVENT.id,
          judgeId: payload.judgeId,
          participantId: '',
          scoringEntity: 'TEAM',
          teamId: entry.teamId,
          criteria: [],
          score: entry.score ?? 0,
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

  backend.on('saveAttendanceBatch', request => {
    const payload = request['payload'] as { items: Array<{ participantId: string; status: string }> };
    const results = payload.items.map(item => {
      const before = state.attendance[item.participantId];
      state.attendance[item.participantId] = item.status;
      return {
        participantId: item.participantId,
        outcome: before ? 'UPDATED' : 'CREATED',
        status: item.status,
        version: before ? 2 : 1,
      };
    });
    return json({
      results,
      summary: { total: results.length, created: 0, updated: results.length, unchanged: 0, versionConflicts: 0, invalid: 0 },
    });
  });

  backend.on('finalizeEvent', () => {
    const missing = [TEAM_A, TEAM_B].filter(team => scoreable(team.id)).flatMap(team =>
      state.judgeScores.some(row => row.teamId === team.id && row.status === 'SUBMITTED')
        ? [] : [team.id]);
    if (missing.length) {
      return reject('JUDGE_SCORES_INCOMPLETE', `Missing team submissions: ${missing.join(', ')}`);
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

  return state;
}

test.describe('group team-scoring journey', () => {
  test('one entry per judge per team; missing attendance blocks the team until saved', async ({ page, backend }) => {
    const pageErrors = monitorPageErrors(page);
    const state = installGroupScoring(backend);
    await signIn(page);

    await page.goto('/#/scoring?eventId=group-1');
    await expect(page.getByRole('heading', { level: 1, name: 'Scoring' })).toBeVisible();

    // ---- one scoring row per team, with roster counts ----
    const teamARow = page.locator('[data-testid="team-score-row-team-a"]');
    const teamBRow = page.locator('[data-testid="team-score-row-team-b"]');
    await expect(teamARow).toBeVisible();
    await expect(teamBRow).toBeVisible();
    await expect(teamARow).toContainText('Sunshine Quiz Team');
    await expect(teamARow).toContainText('3 registered · 2 present · 1 absent');

    // ---- the team with unmarked attendance is blocked; its inputs are disabled ----
    await expect(page.locator('[data-testid="team-attendance-incomplete"]')).toBeVisible();
    await expect(teamBRow).toContainText('Team scoring is disabled — attendance incomplete.');
    await expect(teamBRow).toContainText('Attendance is not marked for: Zoya S.');
    await expect(teamBRow.locator('input.score-input')).toBeDisabled();

    // ---- the scoreable team's input is enabled and saves ONE team entry ----
    // LIT-005 Quiz (SJ + J) is SINGLE: exactly one overall input per team.
    await expect(teamARow.locator('input.score-input')).toHaveCount(1);
    await expect(teamARow.locator('input.score-input')).toBeEnabled();
    await teamARow.locator('input.score-input').fill('8');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('body')).toContainText('Draft scores saved.');

    expect(state.judgeScores).toHaveLength(1);
    expect(state.judgeScores[0].teamId).toBe('team-a');
    expect(state.judgeScores[0].participantId).toBe('');

    // ---- reload: the team draft comes back (survives refresh) ----
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/#/scoring?eventId=group-1');
    await expect(page.locator('[data-testid="team-score-row-team-a"] input.score-input')).toHaveValue('8');

    // ---- expand the roster: members + explicit attendance state ----
    const rosterSummary = page.locator('[data-testid="team-score-row-team-b"] summary');
    await rosterSummary.scrollIntoViewIfNeeded();
    await rosterSummary.click();
    await expect(teamBRow).toContainText('Zoya S');
    await expect(teamBRow).toContainText('Not marked');

    // ---- complete the roster attendance in ONE batch; the team unblocks ----
    await teamBRow.getByRole('button', { name: 'Present', exact: true }).last().click();
    await expect(page.locator('[data-testid="save-attendance-batch"]')).toBeVisible();
    await page.locator('[data-testid="save-attendance-batch"]').click();
    await expect(page.locator('body')).toContainText('Attendance saved.');

    await expect(teamBRow.locator('[data-testid="team-attendance-incomplete"]')).toHaveCount(0);
    await expect(teamBRow.locator('input.score-input')).toBeEnabled();

    // ---- judge two? no second judge configured: submit the single judge ----
    await teamBRow.locator('input.score-input').fill('6.5');
    await page.getByRole('button', { name: 'Submit final scores' }).click();
    await expect(page.locator('body')).toContainText('Final scores submitted.');

    expect(state.judgeScores.filter(row => row.status === 'SUBMITTED')).toHaveLength(2);
    expect(state.judgeScores.every(row => row.participantId === '')).toBe(true);

    // ---- finalize commits the official TEAM results ----
    await page.getByRole('button', { name: 'Finalize Event' }).click();
    await expect(page.locator('body')).toContainText('Event finalized.');
    expect(state.finalized).toBe(true);

    expect(pageErrors).toEqual([]);
  });
});
