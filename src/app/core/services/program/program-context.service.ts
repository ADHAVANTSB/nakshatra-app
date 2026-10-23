import { Injectable, computed, signal } from '@angular/core';

import {
  PROGRAMS,
  PROGRAM_SCOPE_STORAGE_KEY,
  ZONES,
} from '../../constants/program-context.config';
import {
  type ProgramDefinition,
  type ProgramId,
  type ProgramScope,
  type ZoneDefinition,
  type ZoneId,
} from '../../models/program-context.model';

interface StoredScope {
  programId: string;
  zoneId?: string;
}

/**
 * Holds the program/zone scope chosen after sign-in.
 *
 * - Persisted to sessionStorage so refreshes and deep links keep the scope in
 *   the same tab; a fresh tab intentionally starts the selection flow again.
 * - Changing the program clears the zone: a zone belongs to the program that
 *   was active when it was picked, so a switch can never silently reuse the
 *   previous zone.
 * - `scopeVersion` increments on every scope change so scope-aware consumers
 *   can drop cached state.
 * - `onScopeChange` notifies cache owners SYNCHRONOUSLY on every scope
 *   change, so no old-scope record can survive a zone/programme switch (or
 *   be repopulated by an in-flight response from the previous scope).
 */
@Injectable({ providedIn: 'root' })
export class ProgramContextService {
  private readonly programId = signal<ProgramId | null>(null);
  private readonly zoneId = signal<ZoneId | null>(null);

  /** Increments whenever the stored scope changes. */
  readonly scopeVersion = signal(0);

  private readonly scopeChangeListeners = new Set<() => void>();

  /**
   * Registers a synchronous scope-change hook (cache invalidation).
   * Returns the unsubscribe function.
   */
  onScopeChange(listener: () => void): () => void {
    this.scopeChangeListeners.add(listener);
    return () => this.scopeChangeListeners.delete(listener);
  }

  /** Bumps the scope version and notifies every cache owner at once. */
  private notifyScopeChange(): void {
    this.scopeVersion.update((version) => version + 1);
    this.scopeChangeListeners.forEach((listener) => listener());
  }

  /** Server-side scope persistence state for the selection flow. */
  readonly scopeSaving = signal(false);
  readonly scopeSaveError = signal('');

  beginScopeSave(): void {
    this.scopeSaving.set(true);
    this.scopeSaveError.set('');
  }

  confirmScopeSave(): void {
    this.scopeSaving.set(false);
    this.scopeSaveError.set('');
  }

  failScopeSave(message: string): void {
    this.scopeSaving.set(false);
    this.scopeSaveError.set(message);
  }

  readonly program = computed<ProgramDefinition | null>(
    () => PROGRAMS.find((program) => program.id === this.programId()) ?? null,
  );

  readonly zone = computed<ZoneDefinition | null>(
    () => ZONES.find((zone) => zone.id === this.zoneId()) ?? null,
  );

  readonly scope = computed<ProgramScope | null>(() => {
    const program = this.program();
    const zone = this.zone();
    return program && zone ? { program, zone } : null;
  });

  readonly hasCompleteScope = computed(() => this.scope() !== null);

  constructor() {
    this.restore();
  }

  selectProgram(programId: ProgramId): void {
    const changed = this.programId() !== programId;
    this.programId.set(programId);
    // A zone was chosen for the previous program; force a fresh zone choice.
    this.zoneId.set(null);
    if (changed) {
      this.notifyScopeChange();
    }
    this.persist();
  }

  selectZone(zoneId: ZoneId): void {
    const changed = this.zoneId() !== zoneId;
    this.zoneId.set(zoneId);
    if (changed) {
      this.notifyScopeChange();
    }
    this.persist();
  }

  /** Keeps the program but requires a fresh zone choice. */
  clearZone(): void {
    this.zoneId.set(null);
    this.notifyScopeChange();
    this.persist();
  }

  /** Resets the whole scope (sign-out, or a fresh selection flow). */
  clear(): void {
    this.programId.set(null);
    this.zoneId.set(null);
    this.notifyScopeChange();
    sessionStorage.removeItem(PROGRAM_SCOPE_STORAGE_KEY);
  }

  /**
   * Restores a scope that the backend validated (session refresh /
   * deep link). Unknown values are ignored so a corrupted or stale
   * backend scope falls back to the selection flow instead of rendering
   * an invalid scope.
   */
  restoreFromBackend(programId: string, environmentId: string): void {
    const program = PROGRAMS.find((candidate) => candidate.id === programId);
    const zone = ZONES.find((candidate) => candidate.id === environmentId);
    if (!program || !zone) {
      return;
    }

    const changed =
      this.programId() !== program.id || this.zoneId() !== zone.id;

    this.programId.set(program.id);
    this.zoneId.set(zone.id);
    if (changed) {
      this.notifyScopeChange();
    }
    this.persist();
  }

  private restore(): void {
    const raw = sessionStorage.getItem(PROGRAM_SCOPE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const stored = JSON.parse(raw) as Partial<StoredScope>;
      const program = PROGRAMS.find((candidate) => candidate.id === stored.programId);
      if (!program) {
        return;
      }
      this.programId.set(program.id);

      const zone = ZONES.find((candidate) => candidate.id === stored.zoneId);
      if (zone) {
        this.zoneId.set(zone.id);
      }
    } catch {
      // Corrupted storage behaves as if nothing was selected.
      this.programId.set(null);
      this.zoneId.set(null);
    }
  }

  private persist(): void {
    const programId = this.programId();
    if (!programId) {
      sessionStorage.removeItem(PROGRAM_SCOPE_STORAGE_KEY);
      return;
    }

    const stored: StoredScope = { programId };
    const zoneId = this.zoneId();
    if (zoneId) {
      stored.zoneId = zoneId;
    }
    sessionStorage.setItem(PROGRAM_SCOPE_STORAGE_KEY, JSON.stringify(stored));
  }
}
