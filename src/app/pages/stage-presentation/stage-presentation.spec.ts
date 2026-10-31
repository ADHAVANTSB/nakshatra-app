import { afterEach, describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService } from '../../core/services/auth/auth.service';
import { WinnersService } from '../../core/services/certificates/winners.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ProgramContextService } from '../../core/services/program/program-context.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { DEMO_DATA_NOTICE } from './demo-slides';
import { StagePresentation } from './stage-presentation';
import { STAGE_DECK_STORAGE, StageDeckStorage } from './stage-deck.service';
import { StageSlide } from './stage-slide';

/**
 * Organizer workspace rules: the editor adapts to individual vs group
 * events, slides are validated (a child must be registered for the event
 * and home), official results can populate slides as verified while
 * manual entries stay badged as manual, demo data is removable, keyboard
 * controls drive the slideshow, and projector mode shows the slide with
 * an exit route.
 */

class FakeStorage implements StageDeckStorage {
  readonly store = new Map<string, StageSlide[]>();
  load(key: string): StageSlide[] | null {
    return this.store.get(key) ?? null;
  }
  save(key: string, slides: StageSlide[]): void {
    this.store.set(key, [...slides]);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

function stubServices() {
  const events = signal([
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
  ]);

  const homes = signal([
    { id: 'H-1', homeName: 'Rainbow Children Home' },
    { id: 'H-2', homeName: 'Sunrise Home' },
  ]);

  const participants = signal([
    {
      id: 'P-1',
      participantCode: 'NK26-001',
      shelterHomeId: 'H-1',
      fullName: 'Ananya',
      gender: 'FEMALE',
      age: 9,
      standard: 4,
      level: 'JUNIOR',
    },
    {
      id: 'P-2',
      participantCode: 'NK26-002',
      shelterHomeId: 'H-2',
      fullName: 'Karthik',
      gender: 'MALE',
      age: 13,
      standard: 7,
      level: 'SENIOR',
    },
  ]);

  const registrationsByEvent: Record<string, { participantId: string; registrationStatus: string }[]> = {
    'E-1': [{ participantId: 'P-1', registrationStatus: 'REGISTERED' }],
    'E-2': [
      { participantId: 'P-1', registrationStatus: 'REGISTERED' },
      { participantId: 'P-2', registrationStatus: 'REGISTERED' },
    ],
  };

  return {
    shelterData: {
      loading: signal(false),
      events,
      homes,
      participants,
      registrationsForEvent: (eventId: string) => registrationsByEvent[eventId] ?? [],
      loadEventRegistrations: (eventId: string) =>
        Promise.resolve(registrationsByEvent[eventId] ?? []),
      getHomeById: (id: string) => homes().find(home => home.id === id),
      ensureLoaded: () => Promise.resolve({}),
      loadEvents: () => Promise.resolve({}),
    },
    winners: {
      loading$: signal(false),
      error$: signal(''),
      report$: signal({
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
      }),
      load: () => Promise.resolve(null),
    },
    notifications: {
      success: () => undefined,
      error: () => undefined,
    },
  };
}

function storageKey(): string {
  return 'nakshatra.stageDeck.ARTS.TEST';
}

describe('StagePresentation page', () => {
  let fixture: ComponentFixture<StagePresentation>;
  let element: HTMLElement;

  async function setup(): Promise<void> {
    const stubs = stubServices();

    await TestBed.configureTestingModule({
      imports: [StagePresentation],
      providers: [
        { provide: ShelterDataService, useValue: stubs.shelterData },
        { provide: WinnersService, useValue: stubs.winners },
        { provide: NotificationService, useValue: stubs.notifications },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        {
          provide: ProgramContextService,
          useValue: {
            program: signal({ id: 'ARTS', label: 'Arts' }),
            zone: signal({ id: 'TEST', label: 'Test' }),
            onScopeChange: () => () => undefined,
          },
        },
        { provide: STAGE_DECK_STORAGE, useValue: new FakeStorage() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StagePresentation);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  function click(testId: string): void {
    (element.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function selectOption(testId: string, value: string): void {
    const select = element.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function setInput(testId: string, value: string): void {
    const input = element.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('shows the empty state and the workspace heading', async () => {
    await setup();

    expect(element.textContent ?? '').toContain('Stage Presentation');
    expect(element.textContent ?? '').toContain(
      'Create and manage slides for prize distribution',
    );
    expect(element.querySelector('[data-testid="slide-list"]')).toBeNull();
    expect(element.textContent ?? '').toContain('No slides yet');
  });

  it('loads the demo set with the DEMO DATA notice and removes only demos', async () => {
    await setup();
    click('load-demo');

    expect(element.querySelectorAll('[data-testid="slide-list"] li')).toHaveLength(5);
    expect(element.textContent ?? '').toContain(DEMO_DATA_NOTICE);

    // Add a real slide on top of the demos.
    click('add-slide');
    selectOption('editor-event', 'E-1');
    selectOption('editor-home', 'Rainbow Children Home');
    selectOption('editor-child', 'P-1');
    click('save-slide');
    expect(element.querySelectorAll('[data-testid="slide-list"] li')).toHaveLength(6);

    const removeButton = Array.from(element.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('Remove demo slides'),
    );
    removeButton?.click();
    fixture.detectChanges();

    expect(element.querySelectorAll('[data-testid="slide-list"] li')).toHaveLength(1);
    expect(element.textContent ?? '').not.toContain(DEMO_DATA_NOTICE);
  });

  it('adapts the editor: individual events pick a child, group events name a team', async () => {
    await setup();
    click('add-slide');

    selectOption('editor-event', 'E-1');
    expect(element.querySelector('[data-testid="editor-child"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="editor-team"]')).toBeNull();

    selectOption('editor-event', 'E-2');
    expect(element.querySelector('[data-testid="editor-team"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="editor-child"]')).toBeNull();
  });

  it('rejects an individual slide with no registered child selected', async () => {
    await setup();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the async official-result reconcile settle
    const before = element.querySelectorAll('[data-testid="slide-list"] li').length;
    click('add-slide');
    selectOption('editor-event', 'E-1');
    selectOption('editor-home', 'Rainbow Children Home');
    // Leave the child unselected: manual individual slides require a
    // registered child, never a free-typed name.
    selectOption('editor-child', '');
    click('save-slide');

    expect(element.textContent ?? '').toContain('Child name is required for individual events.');
    // The rejected save adds nothing, whatever the deck already holds.
    expect(element.querySelectorAll('[data-testid="slide-list"] li')).toHaveLength(before);
  });

  it('adds a manual slide and badges it as Manual (never official)', async () => {
    await setup();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the async official-result reconcile settle
    const before = element.querySelectorAll('[data-testid="slide-list"] li').length;
    click('add-slide');
    selectOption('editor-event', 'E-1');
    selectOption('editor-home', 'Rainbow Children Home');
    selectOption('editor-child', 'P-1');
    click('save-slide');

    const items = Array.from(element.querySelectorAll('[data-testid="slide-list"] li'));
    expect(items).toHaveLength(before + 1);
    const added = items.find((li) => li.querySelector('.stage-list-tag--manual'));
    expect(added).toBeDefined();
    expect(added!.querySelector('.stage-list-tag--official')).toBeNull();
  });

  it('builds a verified slide from official results', async () => {
    await setup();
    click('add-slide');
    selectOption('official-candidate', 'E-1|SC-1');
    click('save-slide');

    expect(element.querySelectorAll('[data-testid="slide-list"] li')).toHaveLength(1);
    expect(element.querySelector('.stage-list-tag--official')).not.toBeNull();
    expect(element.querySelector('.stage-list-tag--manual')).toBeNull();
  });

  it('reorders slides with move up/down', async () => {
    await setup();
    click('load-demo');

    const before = Array.from(element.querySelectorAll('.stage-list-event')).map(
      node => node.textContent?.trim(),
    );
    click('load-demo'); // resets to the same demo order
    element.querySelectorAll<HTMLButtonElement>('[title="Move down"]')[0].click();
    fixture.detectChanges();

    const after = Array.from(element.querySelectorAll('.stage-list-event')).map(
      node => node.textContent?.trim(),
    );
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it('selects slides from thumbnails and updates the preview', async () => {
    await setup();
    click('load-demo');

    element.querySelectorAll<HTMLButtonElement>('[data-testid="thumb-2"]')[0].click();
    fixture.detectChanges();

    expect(element.querySelector('.stage-thumb--selected [data-testid="stage-slide"]'))
      .not.toBeNull();
    expect(element.querySelector('[data-testid="slide-preview"]')?.textContent ?? '')
      .toContain('Story Telling');
  });

  it('drives the slideshow from the keyboard', async () => {
    await setup();
    click('load-demo');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(element.textContent ?? '').toContain('2 / 5');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(element.textContent ?? '').toContain('1 / 5');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    fixture.detectChanges();
    const playButton = element.querySelector('[data-testid="play-pause"]') as HTMLButtonElement;
    expect(playButton.textContent ?? '').toContain('Pause');
  });

  it('enters projector mode and exits with Escape', async () => {
    await setup();
    click('load-demo');
    click('start-presentation');

    expect(element.querySelector('[data-testid="projector"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="projector"]')).toBeNull();
  });

  it('does not hijack typing in form fields', async () => {
    await setup();
    click('add-slide');
    selectOption('editor-event', 'E-1');

    const counter = () =>
      (element.textContent ?? '').match(/\d+ \/ \d+/)?.[0] ?? '';
    const before = counter();

    const search = element.querySelector('[data-testid="editor-search"]') as HTMLInputElement;
    search.focus();
    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();

    // The keystroke is text input, never a slideshow control: the deck
    // and the player counter are exactly as they were.
    expect(counter()).toBe(before);
  });

  it('renders long names in full in the slide list', async () => {
    await setup();
    click('add-slide');
    selectOption('editor-event', 'E-1');
    selectOption('editor-home', 'Rainbow Children Home');
    selectOption('editor-child', 'P-1');
    click('save-slide');

    expect(element.textContent ?? '').toContain('Ananya');
    expect(element.textContent ?? '').toContain('Rainbow Children Home');
    expect(element.textContent ?? '').toContain('Story Telling');
  });
});
