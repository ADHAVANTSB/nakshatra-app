import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ProgramContextService } from '../../core/services/program/program-context.service';
import { DEMO_SLIDES } from './demo-slides';
import {
  STAGE_DECK_STORAGE,
  StageDeckService,
  StageDeckStorage,
} from './stage-deck.service';
import { StageSlide } from './stage-slide';

/**
 * Deck store rules: one row per slide in presentation order, CRUD + drag
 * reorder persist per programme/environment scope, demo slides are
 * removable without touching real slides, and a scope switch must never
 * show the previous scope's deck.
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

function manualSlide(id: string, eventName: string): StageSlide {
  return {
    id,
    eventId: 'E-1',
    eventCode: 'ART-001',
    eventName,
    mode: 'SOLO',
    position: 'FIRST',
    homeName: 'Rainbow Children Home',
    childName: 'Ananya',
    teamName: '',
    subtitle: '',
    source: 'MANUAL_ADMIN',
  };
}

function setup(storage: StageDeckStorage = new FakeStorage()): {
  service: StageDeckService;
  storage: StageDeckStorage;
  program: ReturnType<typeof signal<{ id: string; label: string } | null>>;
  zone: ReturnType<typeof signal<{ id: string; label: string } | null>>;
  fireScopeChange: () => void;
} {
  const program = signal<{ id: string; label: string } | null>({ id: 'ARTS', label: 'Arts' });
  const zone = signal<{ id: string; label: string } | null>({ id: 'TEST', label: 'Test' });
  const listeners: (() => void)[] = [];

  TestBed.configureTestingModule({
    providers: [
      {
        provide: ProgramContextService,
        useValue: {
          program,
          zone,
          onScopeChange: (listener: () => void) => {
            listeners.push(listener);
            return () => undefined;
          },
        },
      },
      { provide: STAGE_DECK_STORAGE, useValue: storage },
    ],
  });

  return {
    service: TestBed.inject(StageDeckService),
    storage,
    program,
    zone,
    fireScopeChange: () => listeners.forEach(listener => listener()),
  };
}

describe('StageDeckService', () => {
  it('adds slides in order and assigns unique ids', () => {
    const { service } = setup();

    const first = service.addSlide(manualSlide('', 'Story Telling'));
    const second = service.addSlide(manualSlide('', 'Group Dance'));

    expect(first.id).not.toBe('');
    expect(second.id).not.toBe(first.id);
    expect(service.slides().map(slide => slide.eventName))
      .toEqual(['Story Telling', 'Group Dance']);
  });

  it('updates a slide without changing its id or position', () => {
    const { service } = setup();
    const slide = service.addSlide(manualSlide('', 'Story Telling'));
    service.addSlide(manualSlide('', 'Group Dance'));

    service.updateSlide(slide.id, { childName: 'Karthik', position: 'SECOND' });

    expect(service.slides()[0].id).toBe(slide.id);
    expect(service.slides()[0].childName).toBe('Karthik');
    expect(service.slides()[0].position).toBe('SECOND');
  });

  it('deletes a slide and keeps the rest', () => {
    const { service } = setup();
    const slide = service.addSlide(manualSlide('', 'Story Telling'));
    service.addSlide(manualSlide('', 'Group Dance'));

    service.deleteSlide(slide.id);

    expect(service.slides().map(item => item.eventName)).toEqual(['Group Dance']);
  });

  it('reorders with moveSlide and persists the new order', () => {
    const { service, storage } = setup();
    service.addSlide(manualSlide('', 'One'));
    service.addSlide(manualSlide('', 'Two'));
    service.addSlide(manualSlide('', 'Three'));

    service.moveSlide(2, 0);

    expect(service.slides().map(slide => slide.eventName))
      .toEqual(['Three', 'One', 'Two']);
    expect((storage as FakeStorage).store.get(service.storageKey())?.map(slide => slide.eventName))
      .toEqual(['Three', 'One', 'Two']);
  });

  it('moveUp/moveDown clamp at the ends without corrupting order', () => {
    const { service } = setup();
    service.addSlide(manualSlide('', 'One'));
    service.addSlide(manualSlide('', 'Two'));

    service.moveUp(0);
    service.moveDown(1);

    expect(service.slides().map(slide => slide.eventName)).toEqual(['One', 'Two']);
  });

  it('persists the deck and restores it on reload', () => {
    const storage = new FakeStorage();
    const { service } = setup(storage);
    service.addSlide(manualSlide('', 'Story Telling'));

    // A fresh service over the same storage restores the saved deck.
    TestBed.resetTestingModule();
    const again = setup(storage);

    expect(again.service.slides().map(slide => slide.eventName)).toEqual(['Story Telling']);
  });

  it('keys the deck storage by programme AND zone', () => {
    const { service } = setup();

    service.addSlide(manualSlide('', 'X'));
    expect(service.storageKey()).toBe('nakshatra.stageDeck.ARTS.TEST');
  });

  it('never shows one scope deck in another scope', () => {
    const { service, zone, fireScopeChange } = setup();
    zone.set({ id: 'ZONE_1', label: 'Zone 1' });
    fireScopeChange();
    service.addSlide(manualSlide('', 'Zone 1 event'));

    // Operator switches to ZONE 2: same machine, different storage key.
    zone.set({ id: 'ZONE_2', label: 'Zone 2' });
    fireScopeChange();

    expect(service.storageKey()).toBe('nakshatra.stageDeck.ARTS.ZONE_2');
    expect(service.slides()).toEqual([]);

    service.addSlide(manualSlide('', 'Zone 2 event'));

    // Back to ZONE 1: its deck reappears untouched.
    zone.set({ id: 'ZONE_1', label: 'Zone 1' });
    fireScopeChange();

    expect(service.storageKey()).toBe('nakshatra.stageDeck.ARTS.ZONE_1');
    expect(service.slides().map(slide => slide.eventName)).toEqual(['Zone 1 event']);
  });

  it('flags demo and real slides separately and removes only demos', () => {
    const { service } = setup();
    service.setSlides([...DEMO_SLIDES]);
    const real = service.addSlide(manualSlide('', 'Real event'));

    expect(service.hasDemoSlides()).toBe(true);
    expect(service.hasRealSlides()).toBe(true);

    service.setSlides(service.slides().filter(slide => slide.source !== 'DEMO'));

    expect(service.hasDemoSlides()).toBe(false);
    expect(service.slides().map(slide => slide.id)).toEqual([real.id]);
  });

  it('clears the deck and its persisted copy', () => {
    const { service, storage } = setup();
    service.addSlide(manualSlide('', 'Story Telling'));

    service.clearDeck();

    expect(service.slides()).toEqual([]);
    expect((storage as FakeStorage).store.has(service.storageKey())).toBe(false);
  });

  it('tolerates corrupt persisted storage by starting with an empty deck', () => {
    localStorage.setItem('nakshatra.stageDeck.ARTS.TEST', 'not-json{{{');

    // No STAGE_DECK_STORAGE override: the real localStorage store must
    // swallow the corruption instead of breaking the page.
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProgramContextService,
          useValue: {
            program: signal({ id: 'ARTS', label: 'Arts' }),
            zone: signal({ id: 'TEST', label: 'Test' }),
            onScopeChange: () => () => undefined,
          },
        },
      ],
    });

    const service = TestBed.inject(StageDeckService);
    expect(service.slides()).toEqual([]);
  });
});
