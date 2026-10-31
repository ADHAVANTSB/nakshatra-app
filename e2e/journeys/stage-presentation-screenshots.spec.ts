import { expect, signIn, test } from '../fixtures';

/**
 * Visual evidence for the Stage Presentation feature: the organizer
 * workspace and the full-screen projector presentation. Saves PNGs into
 * docs/screenshots/ next to the app's existing screenshot set. Uses the
 * same mocked backend as the journeys, so no live data is involved.
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

test.describe('Stage Presentation - screenshots', () => {
  test('captures the organizer workspace and the projector presentation', async ({
    page,
    backend,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });

    backend.on('listEvents', () => ({
      body: { success: true, data: { events: EVENTS, totalEvents: EVENTS.length } },
    }));
    backend.on('listShelterHomes', () => ({
      body: {
        success: true,
        data: {
          shelterHomes: [
            { id: 'H-1', homeCode: 'H-01', homeName: 'Rainbow Children Home', status: 'ACTIVE', version: 1 },
            { id: 'H-2', homeCode: 'H-02', homeName: 'Sunrise Home', status: 'ACTIVE', version: 1 },
          ],
        },
      },
    }));
    backend.on('listParticipants', () => ({
      body: {
        success: true,
        data: {
          participants: [
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
          ],
        },
      },
    }));
    backend.on('listWinners', () => ({
      body: { success: true, data: { events: [], totalEvents: 0, totalWinners: 0 } },
    }));

    await signIn(page);
    await page.goto('/#/stage-presentation');
    await expect(page.getByTestId('slide-preview')).toBeVisible();

    // Organizer workspace: demo deck loaded, editor open. Viewport shot
    // (not fullPage) - the app shell's fixed footer overlaps in fullPage.
    await page.getByTestId('load-demo').click();
    await page.getByTestId('add-slide').click();
    await expect(page.getByTestId('slide-list').locator('li')).toHaveCount(5);
    // The 2 MB template PNG must finish decoding before the shot.
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('img.stage-slide-artwork')).every(
        (img) => (img as HTMLImageElement).complete,
      ),
    );
    await page.screenshot({
      path: 'docs/screenshots/stage-presentation-workspace.png',
    });

    // Projector presentation: the slide fills the screen.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('thumb-0').click();
    await page.getByTestId('start-presentation').click();
    await expect(page.getByTestId('projector')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/stage-presentation-projector.png' });

    // The PNG template must stay undistorted on the two projector sizes.
    // The window is in native fullscreen (the projector requested it), and
    // a fullscreen window cannot be resized - restore it first. The
    // projector overlay still fills the viewport either way.
    await page.evaluate(() => document.exitFullscreen?.());
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: 'docs/screenshots/stage-presentation-projector-1920x1080.png' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: 'docs/screenshots/stage-presentation-projector-1366x768.png' });

    await page.keyboard.press('Escape');
  });
});
