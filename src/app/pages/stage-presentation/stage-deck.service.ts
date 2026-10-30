import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

import { ProgramContextService } from '../../core/services/program/program-context.service';
import { StageSlide } from './stage-slide';

/**
 * Stage deck persistence for the ceremony slides.
 *
 * The deck is operator-authored presentation content, NOT source data: it
 * never writes to participants, registrations, scores or results, and it
 * is stored per programme/environment scope so one zone's deck can never
 * leak into another's (the key includes both ids and a scope change
 * reloads the deck). localStorage is the storage today - safe, offline and
 * per-machine; the reviewed server-side equivalent (StageSlides sheet,
 * getStageDeck/saveStageDeck) is implemented and tested offline in
 * backend-verification\proposals\ and is deployed only after the sheet
 * schema is approved. No live spreadsheet is touched either way.
 */

/** Pluggable deck storage; tests inject a fake. */
export interface StageDeckStorage {
  load(key: string): StageSlide[] | null;
  save(key: string, slides: StageSlide[]): void;
  remove(key: string): void;
}

class LocalStorageDeckStorage implements StageDeckStorage {
  load(key: string): StageSlide[] | null {
    try {
      const raw = localStorage.getItem(key);

      if (raw === null) {
        return null;
      }

      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StageSlide[]) : null;
    } catch {
      // A corrupt or inaccessible store is treated as "no saved deck".
      return null;
    }
  }

  save(key: string, slides: StageSlide[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(slides));
    } catch {
      // Quota/blocked storage: the in-memory deck still works for the session.
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to recover - the deck is simply not persisted.
    }
  }
}

export const STAGE_DECK_STORAGE = new InjectionToken<StageDeckStorage>('STAGE_DECK_STORAGE', {
  providedIn: 'root',
  factory: () => new LocalStorageDeckStorage(),
});

@Injectable({ providedIn: 'root' })
export class StageDeckService {
  private readonly programContext = inject(ProgramContextService);
  private readonly storage = inject(STAGE_DECK_STORAGE);

  private readonly slidesState = signal<StageSlide[]>([]);
  private nextId = 1;

  /** The current deck, in presentation order. */
  readonly slides = this.slidesState.asReadonly();

  /** True when any slide came from the demo sample set. */
  readonly hasDemoSlides = computed(
    () => this.slidesState().some(slide => slide.source === 'DEMO'),
  );

  /** True when any slide is backed by real registration data. */
  readonly hasRealSlides = computed(
    () => this.slidesState().some(slide => slide.source !== 'DEMO'),
  );

  constructor() {
    // A scope switch must never show the previous scope's deck.
    this.programContext.onScopeChange(() => this.loadFromStorage());
    this.loadFromStorage();
  }

  /** Reads the persisted deck for the current programme/environment. */
  loadFromStorage(): void {
    const saved = this.storage.load(this.storageKey());
    this.slidesState.set(saved ?? []);
    this.nextId = (saved?.length ?? 0) + 1;
  }

  /** Replaces the deck (e.g. demo load) and persists it. */
  setSlides(slides: StageSlide[]): void {
    this.slidesState.set([...slides]);
    this.persist();
  }

  /** Appends one slide and persists the deck. */
  addSlide(slide: StageSlide): StageSlide {
    const stored: StageSlide = { ...slide, id: slide.id || this.createId() };
    this.slidesState.update(slides => [...slides, stored]);
    this.persist();
    return stored;
  }

  /** Updates an existing slide in place; unknown ids are ignored. */
  updateSlide(id: string, patch: Partial<Omit<StageSlide, 'id'>>): void {
    this.slidesState.update(slides =>
      slides.map(slide => (slide.id === id ? { ...slide, ...patch, id } : slide)),
    );
    this.persist();
  }

  deleteSlide(id: string): void {
    this.slidesState.update(slides => slides.filter(slide => slide.id !== id));
    this.persist();
  }

  /** Moves a slide from one index to another (drag reorder). */
  moveSlide(from: number, to: number): void {
    this.slidesState.update(slides => {
      if (
        from === to ||
        from < 0 || from >= slides.length ||
        to < 0 || to >= slides.length
      ) {
        return slides;
      }

      const reordered = [...slides];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return reordered;
    });
    this.persist();
  }

  moveUp(index: number): void {
    this.moveSlide(index, index - 1);
  }

  moveDown(index: number): void {
    this.moveSlide(index, index + 1);
  }

  clearDeck(): void {
    this.slidesState.set([]);
    this.storage.remove(this.storageKey());
    this.nextId = 1;
  }

  /** Per-scope storage key: decks are isolated by programme AND zone. */
  storageKey(): string {
    const programId = this.programContext.program()?.id ?? 'noprogram';
    const zoneId = this.programContext.zone()?.id ?? 'nozone';
    return `nakshatra.stageDeck.${programId}.${zoneId}`;
  }

  private persist(): void {
    this.storage.save(this.storageKey(), this.slidesState());
  }

  private createId(): string {
    const id = 'SL-' + String(this.nextId).padStart(4, '0');
    this.nextId += 1;
    return id;
  }
}
