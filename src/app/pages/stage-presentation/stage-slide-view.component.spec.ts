import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StageSlideView } from './stage-slide-view.component';
import { DEMO_DATA_NOTICE, DEMO_SLIDES } from './demo-slides';
import { StageSlide } from './stage-slide';

/**
 * Stage slide visual rules: individual slides show Child Name + Home Name,
 * group slides show Home/Team ONLY (never an individual child), the prize
 * banner and event name are prominent, and provenance badges keep demo and
 * manually entered slides from ever posing as official results.
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

  it('renders individual slides as Child Name then Home Name', () => {
    const element = render(soloSlide);
    const text = element.textContent ?? '';

    expect(text).toContain('Story Telling');
    expect(text).toContain('Child Name');
    expect(text).toContain('Ananya');
    expect(text).toContain('Home Name');
    expect(text).toContain('Rainbow Children Home');
    expect(text.indexOf('Ananya')).toBeLessThan(text.indexOf('Rainbow Children Home'));
  });

  it('renders group slides as Home Name plus Team Name', () => {
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

  it('omits the Team Name block when a group slide has no team', () => {
    const element = render({ ...groupSlide, teamName: '' });

    expect(element.textContent ?? '').not.toContain('Team Name');
    expect(element.textContent ?? '').toContain('Rainbow Children Home');
  });

  it('shows the prize banner label prominently', () => {
    expect(render(groupSlide).textContent ?? '').toContain('FIRST PRIZE');
    expect(render(soloSlide).textContent ?? '').toContain('THIRD PRIZE');
    expect(render({ ...soloSlide, position: 'SPECIAL_MENTION' }).textContent ?? '')
      .toContain('SPECIAL MENTION');
    expect(render({ ...soloSlide, position: 'PARTICIPATION' }).textContent ?? '')
      .toContain('PARTICIPATION');
  });

  it('shows the friendly position label beside the winner', () => {
    expect(render(soloSlide).textContent ?? '').toContain('Third Prize');
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
});
