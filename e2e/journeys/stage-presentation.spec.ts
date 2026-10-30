import {
  adminUser,
  certificateTeamUser,
  expect,
  monitorPageErrors,
  signIn,
  test,
} from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Stage Presentation ceremony journey: sign in, open Certificates, then
 * the Stage Presentation workspace - load demo slides, preview, add a
 * slide from official results, reorder, run the slideshow with keyboard
 * navigation, enter fullscreen and exit. The second journey proves the
 * winner-honesty rules end to end: manual slides come from registered
 * participants and group slides never show a child.
 */

const EVENTS = [
  {
    id: 'E-1',
    eventCode: 'ART-011',
    name: 'Story Telling',
    category: 'ARTS',
    mode: 'SOLO',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR'],
  },
  {
    id: 'E-2',
    eventCode: 'CUL-021',
    name: 'Group Dance',
    category: 'CULTURAL',
    mode: 'GROUP',
    status: 'ACTIVE',
    eligibleLevels: ['JUNIOR', 'SENIOR'],
  },
];

const SHELTER_HOMES = [
  { id: 'H-1', homeCode: 'H-01', homeName: 'Rainbow Children Home', status: 'ACTIVE', version: 1 },
  { id: 'H-2', homeCode: 'H-02', homeName: 'Sunrise Home', status: 'ACTIVE', version: 1 },
];

const PARTICIPANTS = [
  {
    id: 'P-1',
    participantCode: 'NK26-001',
    shelterHomeId: 'H-1',
    fullName: 'Ananya',
    gender: 'FEMALE',
    age: 9,
    standard: 4,
    level: 'JUNIOR',
    eligibilityStatus: 'ELIGIBLE',
    validationStatus: 'VALID',
    approvalStatus: 'APPROVED',
    lockStatus: 'UNLOCKED',
    version: 1,
  },
];

const EVENT_REGISTRATIONS = [
  {
    id: 'R-1',
    participantId: 'P-1',
    eventId: 'E-1',
    registrationStatus: 'REGISTERED',
    version: 1,
  },
];

const WINNERS = {
  events: [
    {
      eventId: 'E-1',
      eventCode: 'ART-011',
      eventName: 'Story Telling',
      category: 'ARTS',
      mode: 'SOLO',
      eventStatus: 'ACTIVE',
      winners: [
        {
          position: 1,
          name: 'Ananya',
          age: '9',
          className: '4',
          level: 'JUNIOR',
          shelterHomeName: 'Rainbow Children Home',
          score: 88,
          scoreId: 'SC-1',
          participantId: 'P-1',
          teamId: '',
          members: [],
        },
      ],
    },
  ],
  totalEvents: 1,
  totalWinners: 1,
};

function stubStageData(backend: import('../stubs/backend').BackendStub): void {
  backend.on('listEvents', () => ({
    body: { success: true, data: { events: EVENTS, totalEvents: EVENTS.length } },
  }));
  backend.on('listShelterHomes', () => ({
    body: { success: true, data: { shelterHomes: SHELTER_HOMES } },
  }));
  backend.on('listParticipants', () => ({
    body: { success: true, data: { participants: PARTICIPANTS } },
  }));
  backend.on('listEventRegistrations', () => ({
    body: { success: true, data: { participantEvents: EVENT_REGISTRATIONS } },
  }));
  backend.on('listParticipantEvents', () => ({
    body: { success: true, data: { participantEvents: EVENT_REGISTRATIONS } },
  }));
}

/** The nav lives in a drawer on mobile emulation (see navigation.spec). */
function navRoot(page: Page) {
  return test.info().project.name === 'mobile-chromium'
    ? page.locator('aside.nk-mobile-drawer')
    : page.locator('aside.nk-sidebar');
}

async function openNav(page: Page): Promise<void> {
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('aside.nk-mobile-drawer')).toBeVisible();
  }
}

test.describe('Stage Presentation - ceremony slide deck', () => {
  test('signs in, reaches the workspace from Certificates and runs the full journey', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);
    stubStageData(backend);
    backend.on('listWinners', () => ({ body: { success: true, data: WINNERS } }));

    // 1-2. Sign in and open Certificates first (the feature's sibling page).
    await signIn(page, { user: certificateTeamUser, backend });
    await page.goto('/#/certificates');
    await expect(page.locator('.certificates-page')).toBeVisible();

    // 3. Stage Presentation appears immediately after Certificates.
    await openNav(page);
    const navLabels = (await navRoot(page).locator('.nk-nav-text').allTextContents()).map(
      label => label.trim(),
    );
    expect(navLabels.indexOf('Stage Presentation')).toBe(
      navLabels.indexOf('Certificates') + 1,
    );
    await navRoot(page).getByRole('link', { name: /Stage Presentation/ }).click();
    await expect(page.getByTestId('slide-preview')).toBeVisible();

    // 4. Create demo slides and see the DEMO DATA notice.
    await page.getByTestId('load-demo').click();
    await expect(page.getByTestId('slide-list').locator('li')).toHaveCount(5);
    await expect(page.getByText('DEMO DATA').first()).toBeVisible();

    // 5. Preview a slide from the thumbnail strip.
    await page.getByTestId('thumb-2').click();
    await expect(page.getByTestId('slide-preview')).toContainText('Story Telling');

    // 6. Add another slide from the official results picker.
    await page.getByTestId('add-slide').click();
    await page.getByTestId('official-candidate').selectOption({ index: 1 });
    await page.getByTestId('save-slide').click();
    await expect(page.getByTestId('slide-list').locator('li')).toHaveCount(6);

    // 7. Reorder: move slide 1 down and confirm the order changed.
    const firstBefore = await page
      .getByTestId('slide-list')
      .locator('.stage-list-event')
      .first()
      .textContent();
    await page.locator('[title="Move down"]').first().click();
    await expect
      .poll(async () =>
        page.getByTestId('slide-list').locator('.stage-list-event').first().textContent(),
      )
      .not.toBe(firstBefore);

    // 8. Start the slideshow from a known slide (projector mode).
    await page.getByTestId('thumb-0').click();
    await page.getByTestId('start-presentation').click();
    await expect(page.getByTestId('projector')).toBeVisible();
    await expect(page.getByTestId('projector')).toContainText('1 / 6');

    // 9. Navigate with the keyboard.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('projector')).toContainText('2 / 6');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('projector')).toContainText('1 / 6');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('projector')).toBeVisible();

    // 10. Fullscreen is best-effort (headless may deny); the click must
    //     never break the projector.
    await page.locator('.stage-projector-bar button', { hasText: '⛶' }).click();
    await expect(page.getByTestId('projector')).toBeVisible();

    // 11. Exit presentation with Escape.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('projector')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('manual slide from registered participants, group slides carry no child', async ({
    page,
    backend,
  }) => {
    const pageErrors = monitorPageErrors(page);
    stubStageData(backend);
    backend.on('listWinners', () => ({
      body: { success: true, data: { events: [], totalEvents: 0, totalWinners: 0 } },
    }));

    await signIn(page, { user: adminUser, backend });
    await page.goto('/#/stage-presentation');
    await page.getByTestId('add-slide').click();

    // No official results: the editor says manual slides are never
    // presented as verified winners.
    await expect(page.getByText('No official finalized results yet')).toBeVisible();

    // Individual slide: child picked from the event's registered participants.
    await page.getByTestId('editor-event').selectOption('E-1');
    await page.getByTestId('editor-home').selectOption('Rainbow Children Home');
    await page.getByTestId('editor-child').selectOption('P-1');
    await page.getByTestId('save-slide').click();
    await expect(page.getByTestId('slide-list').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('slide-list')).toContainText('Ananya');

    // Group slide: team name, never a child.
    await page.getByTestId('add-slide').click();
    await page.getByTestId('editor-event').selectOption('E-2');
    await page.getByTestId('editor-home').selectOption('Sunrise Home');
    await page.getByTestId('editor-team').fill('Sunrise Stars');
    await page.getByTestId('save-slide').click();
    await expect(page.getByTestId('slide-list').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('slide-list')).toContainText('Sunrise Stars');

    // The group slide preview shows Home/Team only - no participant names.
    await page.getByTestId('thumb-1').click();
    await expect(page.getByTestId('slide-preview')).toContainText('Sunrise Home');
    await expect(page.getByTestId('slide-preview')).toContainText('Sunrise Stars');
    await expect(page.getByTestId('slide-preview')).not.toContainText('Ananya');

    expect(pageErrors).toEqual([]);
  });
});
