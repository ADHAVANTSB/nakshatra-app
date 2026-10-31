import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StageSlideView } from './stage-slide-view.component';
import { DEMO_DATA_NOTICE, DEMO_SLIDES } from './demo-slides';
import { HOME_FIT_FLOOR, StageSlide } from './stage-slide';

/**
 * Stage slide visual rules: individual slides show Child Name then the
 * combined Home / Team line, group slides show Home / Team ONLY (never an
 * individual child), the event category sits above the event name, the
 * prize position renders exactly once (the banner), and provenance badges
 * keep demo and manually entered slides from ever posing as official
 * results.
 */
describe('StageSlideView', () => {
  let fixture: ComponentFixture<StageSlideView>;

  const soloSlide: StageSlide = {
    id: 'S-1',
    eventId: 'E-1',
    eventCode: 'ART-011',
    eventName: 'Story Telling',
    mode: 'SOLO',
    position: 'THIRD',
    homeName: 'Rainbow Children Home',
    childName: 'Ananya',
    teamName: '',
    subtitle: '',
    source: 'OFFICIAL_RESULT',
  };

  const groupSlide: StageSlide = {
    id: 'S-2',
    eventId: 'E-2',
    eventCode: 'CUL-021',
    eventName: 'Group Dance',
    mode: 'GROUP',
    position: 'FIRST',
    homeName: 'Rainbow Children Home',
    childName: '',
    teamName: 'Rainbow Stars',
    subtitle: '',
    source: 'OFFICIAL_RESULT',
  };

  function render(slide: StageSlide, demoNotice = ''): HTMLElement {
    fixture = TestBed.createComponent(StageSlideView);
    fixture.componentRef.setInput('slide', slide);
    fixture.componentRef.setInput('demoNotice', demoNotice);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StageSlideView],
    }).compileComponents();
  });

  it('renders individual slides as Child Name then Home / Team', () => {
    const element = render(soloSlide);
    const text = element.textContent ?? '';

    expect(text).toContain('Story Telling');
    expect(text).toContain('Child Name');
    expect(text).toContain('Ananya');
    expect(text).toContain('Home / Team');
    expect(text).toContain('Rainbow Children Home');
    expect(text.indexOf('Ananya')).toBeLessThan(text.indexOf('Rainbow Children Home'));
  });

  it('keeps the individual (SOLO) home label as Home / Team, never SHELTER HOME', () => {
    // Requirement pin: SHELTER HOME is the GROUP single-name case only;
    // individual slides keep the committed Home / Team label (rendered
    // "HOME / TEAM" by the slide CSS text-transform).
    const element = render(soloSlide);
    // SOLO slides carry two labels ("Child Name" and the home line); pin
    // the home line's label, the last one.
    const labels = element.querySelectorAll('.stage-slide-label');
    const label = labels[labels.length - 1];

    expect(label?.textContent?.trim()).toBe('Home / Team');
    expect(label?.textContent?.trim().toUpperCase()).toBe('HOME / TEAM');
    expect(element.textContent ?? '').not.toContain('SHELTER HOME');
  });

  it('renders group slides as one Home / Team line (never a child)', () => {
    const element = render(groupSlide);
    const text = element.textContent ?? '';

    expect(text).toContain('Group Dance');
    expect(text).toContain('Rainbow Children Home');
    expect(text).toContain('Rainbow Stars');
    expect(text).not.toContain('Child Name');
  });

  it('never shows a child name on a group slide', () => {
    const element = render({ ...groupSlide, childName: '' });
    const text = element.textContent ?? '';

    expect(text).not.toContain('Ananya');
  });

  it('shows the home alone with no leftover separator when a group slide has no team', () => {
    const element = render({ ...groupSlide, teamName: '' });
    const home = element.querySelector('.stage-slide-home');

    expect(home?.textContent?.trim()).toBe('Rainbow Children Home');
    expect(home?.textContent ?? '').not.toContain('·');
    expect(element.querySelector('.stage-slide-label')?.textContent?.trim())
      .toBe('SHELTER HOME');
  });

  it('shows child name plus home/team for individuals, home/team only for groups', () => {
    const solo = render(soloSlide);
    expect(solo.querySelector('.stage-slide-winner')?.textContent?.trim()).toBe('Ananya');
    expect(solo.querySelector('.stage-slide-home')?.textContent?.trim())
      .toBe('Rainbow Children Home');

    const group = render(groupSlide);
    expect(group.querySelector('.stage-slide-winner')).toBeNull();
    expect(group.querySelector('.stage-slide-home')?.textContent?.trim())
      .toBe('Rainbow Children Home · Rainbow Stars');
    expect(group.textContent ?? '').not.toContain('Ananya');
  });

  it('joins home and team with a middot on one line when both exist', () => {
    const element = render(groupSlide);
    const home = element.querySelectorAll('.stage-slide-home');

    expect(home).toHaveLength(1);
    expect(home[0].textContent?.trim()).toBe('Rainbow Children Home · Rainbow Stars');
    expect(element.querySelector('.stage-slide-label')?.textContent?.trim())
      .toBe('HOME / TEAM');
  });

  it('renders the event category above the event name', () => {
    const element = render({ ...soloSlide, category: 'LITERARY' });
    const text = element.textContent ?? '';

    expect(element.querySelector('.stage-slide-category')?.textContent?.trim())
      .toBe('LITERARY');
    expect(text.indexOf('LITERARY')).toBeLessThan(text.indexOf('Story Telling'));
    expect(element.querySelector('.stage-slide-category--missing')).toBeNull();
  });

  it('shows a neutral Category unavailable indicator when the category is missing', () => {
    const element = render(soloSlide);
    const category = element.querySelector('.stage-slide-category');

    expect(category?.textContent?.trim()).toBe('Category unavailable');
    expect(category?.classList.contains('stage-slide-category--missing')).toBe(true);
  });

  it('shows the prize banner label prominently', () => {
    expect(render(groupSlide).textContent ?? '').toContain('FIRST PRIZE');
    expect(render(soloSlide).textContent ?? '').toContain('THIRD PRIZE');
    expect(render({ ...soloSlide, position: 'SPECIAL_MENTION' }).textContent ?? '')
      .toContain('SPECIAL MENTION');
    expect(render({ ...soloSlide, position: 'PARTICIPATION' }).textContent ?? '')
      .toContain('PARTICIPATION');
  });

  it('shows the prize position exactly once, on the banner row', () => {
    const element = render(soloSlide);

    expect(element.querySelector('.stage-slide-banner')?.textContent?.trim())
      .toBe('THIRD PRIZE');
    // The duplicate friendly-label row is gone: no second prize element.
    expect(element.querySelector('.stage-slide-position')).toBeNull();
    const prizeLabels = (element.textContent ?? '').match(/THIRD PRIZE|Third Prize/g) ?? [];
    expect(prizeLabels).toHaveLength(1);
  });

  it('keeps the event name visible on every slide', () => {
    expect(render(soloSlide).textContent ?? '').toContain('Story Telling');
    expect(render(groupSlide).textContent ?? '').toContain('Group Dance');
  });

  it('renders long child and home names in full', () => {
    const element = render({
      ...soloSlide,
      childName: 'Aishwarya Venkatesan Ramanathan Subramanian',
      homeName: 'St. Joseph\'s Charitable Shelter Home for Children, Chennai',
    });
    const text = element.textContent ?? '';

    expect(text).toContain('Aishwarya Venkatesan Ramanathan Subramanian');
    expect(text).toContain('St. Joseph\'s Charitable Shelter Home for Children, Chennai');
  });

  it('shows the DEMO DATA notice on demo slides only', () => {
    const demoElement = render(DEMO_SLIDES[0], DEMO_DATA_NOTICE);
    expect(demoElement.textContent ?? '').toContain(DEMO_DATA_NOTICE);
    expect(demoElement.querySelector('[data-testid="slide-demo-badge"]')).not.toBeNull();

    const officialElement = render(groupSlide, DEMO_DATA_NOTICE);
    expect(officialElement.querySelector('[data-testid="slide-demo-badge"]')).toBeNull();
  });

  it('marks manually entered slides as not official', () => {
    const element = render({ ...soloSlide, source: 'MANUAL_ADMIN' });

    expect(element.querySelector('[data-testid="slide-manual-badge"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="slide-official-badge"]')).toBeNull();
  });

  it('badges verified official results', () => {
    const element = render(groupSlide);

    expect(element.querySelector('[data-testid="slide-official-badge"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="slide-manual-badge"]')).toBeNull();
    expect(element.querySelector('[data-testid="slide-demo-badge"]')).toBeNull();
  });

  it('uses the approved PNG template as the actual slide background', () => {
    const root = render(soloSlide);
    const artwork = root.querySelector('img.stage-slide-artwork') as HTMLImageElement;

    expect(artwork).not.toBeNull();
    expect(artwork.getAttribute('src')).toBe('logo/adhavan - template for web page .png');
  });

  it('renders the optional subtitle when present', () => {
    expect(render({ ...soloSlide, subtitle: 'A round of applause!' }).textContent ?? '')
      .toContain('A round of applause!');
    expect(render(soloSlide).textContent ?? '').not.toContain('A round of applause!');
  });

  it('shows the home once (label SHELTER HOME) when home and team are the identical name', () => {
    const element = render({
      ...groupSlide,
      homeName: 'HOME FOR POOR BOYS',
      teamName: 'HOME FOR POOR BOYS',
    });
    const home = element.querySelector('.stage-slide-home');

    expect(home?.textContent?.trim()).toBe('HOME FOR POOR BOYS');
    expect(home?.textContent ?? '').not.toContain('·');
    // The home name appears exactly once on the whole slide.
    expect((element.textContent?.match(/HOME FOR POOR BOYS/g) ?? [])).toHaveLength(1);
    expect(element.querySelector('.stage-slide-label')?.textContent?.trim())
      .toBe('SHELTER HOME');
  });

  it('dedupes home and team names that differ only in case', () => {
    const element = render({ ...groupSlide, homeName: 'Rainbow Home', teamName: 'rainbow home' });
    const home = element.querySelector('.stage-slide-home');

    expect(home?.textContent?.trim()).toBe('Rainbow Home');
    expect(home?.textContent ?? '').not.toContain('·');
    expect(element.querySelector('.stage-slide-label')?.textContent?.trim())
      .toBe('SHELTER HOME');
  });

  it('dedupes home and team names that differ only in whitespace', () => {
    const element = render({
      ...groupSlide,
      homeName: '  Rainbow   Home ',
      teamName: 'rainbow home',
    });
    const home = element.querySelector('.stage-slide-home');

    expect(home?.textContent?.trim().replace(/\s+/g, ' ')).toBe('Rainbow Home');
    expect(home?.textContent ?? '').not.toContain('·');
    expect(element.querySelector('.stage-slide-label')?.textContent?.trim())
      .toBe('SHELTER HOME');
  });

  it('keeps a long home name on one line (nowrap + inline fit sizing)', () => {
    const name = 'St. Joseph\'s Charitable Shelter Home for Children, Chennai';
    const element = render({ ...soloSlide, homeName: name });
    const home = element.querySelector('.stage-slide-home') as HTMLElement;

    expect(home.textContent?.trim()).toBe(name);
    expect(getComputedStyle(home).whiteSpace).toBe('nowrap');
    // Inline sizing hook is applied (the fit scale rides on it).
    expect(home.style.getPropertyValue('--home-fit')).not.toBe('');
  });

  it('shrinks the home line for over-long text but never below the fit floor', () => {
    // jsdom has no layout: fake the content box (800px) and the text width.
    const clientWidth = vi
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockReturnValue(800);
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 4000 } as DOMRect);

    try {
      const element = render({ ...groupSlide, homeName: 'A'.repeat(80), teamName: '' });
      const home = element.querySelector('.stage-slide-home') as HTMLElement;
      const scale = Number(home.style.getPropertyValue('--home-fit'));

      // 800 / 4000 = 0.2 -> clamped up to the floor, still below 1.
      expect(scale).toBeLessThan(1);
      expect(scale).toBeGreaterThanOrEqual(HOME_FIT_FLOOR);
      expect(scale).toBe(HOME_FIT_FLOOR);

      rect.mockReturnValue({ width: 1000 } as DOMRect);
      const fitted = render({ ...groupSlide, homeName: 'A'.repeat(20), teamName: '' })
        .querySelector('.stage-slide-home') as HTMLElement;
      const fittedScale = Number(fitted.style.getPropertyValue('--home-fit'));

      expect(fittedScale).toBeLessThan(1);
      expect(fittedScale).toBeGreaterThanOrEqual(HOME_FIT_FLOOR);
      expect(fittedScale).toBeCloseTo(800 / 1000);
    } finally {
      clientWidth.mockRestore();
      rect.mockRestore();
    }
  });
});
