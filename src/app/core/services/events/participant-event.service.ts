import { Injectable, computed, inject, signal } from '@angular/core';

import {
  EVENT_CATEGORY_LABELS,
  NAKSHATRA_EVENT_RULES,
  PARTICIPANT_LEVEL_LABELS,
} from '../../constants/nakshatra-rules';

import {
  Participant,
  Event,
  EventDayCheckInStatus,
  EventDayRegistrationEntry,
  ParticipantEvent,
  ParticipantEventSummaryEntry,
  ParticipantEventSummaryIssue,
  SaveEventDayAttendanceBatchItem,
  SaveEventDayAttendanceBatchResult,
  SaveEventDayAttendanceBatchSummary,
  SourceWriteBackResult,
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { ParticipantService } from '../participants/participant.service';
import { ProgramContextService } from '../program/program-context.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';
import { EventService } from './event.service';

export interface RegistrationValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RegistrationResult {
  success: boolean;
  registration?: ParticipantEvent;
  errors: string[];
  /** Present when the backend reported whether the Event wise sheet was written. */
  sourceWriteBack?: SourceWriteBackResult;
}

export interface EventDayBatchSaveResult {
  success: boolean;
  errors: string[];
  /** Per-record backend results (empty on a batch-level failure). */
  results: SaveEventDayAttendanceBatchResult[];
  summary: SaveEventDayAttendanceBatchSummary | null;
}

/**
 * Registrations (ParticipantEvents).
 *
 * Reads resolve to the persisted registrations held in the shared backend store
 * (`listEventRegistrations` / `listParticipantEvents`). Writes always go through
 * the backend and the local cache is refreshed from the backend response, so
 * this service never becomes a second source of truth.
 */
@Injectable({
  providedIn: 'root'
})
export class ParticipantEventService {
  private readonly shelterData = inject(ShelterDataService);
  private readonly participantService = inject(ParticipantService);
  private readonly eventService = inject(EventService);
  private readonly apiClient = inject(ApiClientService);
  private readonly programContext = inject(ProgramContextService);

  /** Every registration the store currently holds. */
  readonly registrations$ = this.shelterData.registrations;
  readonly loading = this.shelterData.loadingRegistrations;

  readonly registeredCount = computed(() =>
    this.registrations$().filter(item => item.registrationStatus === 'REGISTERED').length
  );

  // ==========================================
  // BACKEND READS
  // ==========================================

  /** Reads persisted registrations for one event from the backend. */
  loadEventRegistrations(eventId: string, force = false): Promise<ParticipantEvent[] | null> {
    return this.shelterData.loadEventRegistrations(eventId, force);
  }

  /** Reads persisted registrations for one participant from the backend. */
  loadParticipantEvents(participantId: string, force = false): Promise<ParticipantEvent[] | null> {
    return this.shelterData.loadParticipantEvents(participantId, force);
  }

  // ==========================================
  // BATCH EVENT SUMMARIES (backend round 2)
  // ==========================================

  /** Backend-returned summaries, keyed by stable participantId. */
  private readonly summaryEntriesState = signal<Record<string, ParticipantEventSummaryEntry>>({});

  /** Backend-reported duplicate/missing-reference issues. */
  private readonly summaryIssuesState = signal<ParticipantEventSummaryIssue[]>([]);

  /** Per-home load state; a home stays FAILED until a retry succeeds. */
  private readonly summaryHomeStates = signal<Record<string, 'LOADING' | 'LOADED' | 'FAILED'>>({});

  /** In-flight summary read per home: concurrent callers share one request. */
  private pendingSummaries = new Map<string, Promise<boolean>>();

  constructor() {
    // Every cached registration/summary/event-day row belongs to exactly
    // one programme/zone scope and is dropped the moment that scope
    // changes; in-flight responses are discarded (see the scopeVersion
    // guards) instead of repopulating the cache.
    this.programContext.onScopeChange(() => {
      this.summaryEntriesState.set({});
      this.summaryIssuesState.set([]);
      this.summaryHomeStates.set({});
      this.pendingSummaries.clear();
      this.eventDayEntriesState.set([]);
      this.eventDayLoadingState.set(false);
      this.eventDayScopeVersion = -1;
    });
  }

  readonly summaryIssues = this.summaryIssuesState.asReadonly();

  /**
   * Batch read of participant event summaries — exactly one backend request
   * per home. Loaded homes are never re-requested unless `force`; concurrent
   * and repeated navigation share the same request. A failed home read never
   * marks that home loaded, and the already-loaded homes stay usable.
   *
   * Returns true only when every requested home read succeeded.
   */
  loadSummariesForHomes(homeIds: string[], force = false): Promise<boolean> {
    const requested = [...new Set(homeIds.filter(id => id))];

    const reads = requested
      .filter(homeId => force || this.summaryHomeStates()[homeId] !== 'LOADED')
      .map(homeId => this.requestSummariesForHome(homeId, force));

    if (!reads.length) {
      return Promise.resolve(true);
    }

    return Promise.all(reads).then(results => results.every(Boolean));
  }

  private requestSummariesForHome(homeId: string, force: boolean): Promise<boolean> {
    const pending = this.pendingSummaries.get(homeId);

    if (pending && !force) {
      return pending;
    }

    const request = this.readSummariesForHome(homeId)
      .finally(() => this.pendingSummaries.delete(homeId));
    this.pendingSummaries.set(homeId, request);
    return request;
  }

  private async readSummariesForHome(homeId: string): Promise<boolean> {
    const scopeVersion = this.programContext.scopeVersion();
    this.summaryHomeStates.update(states => ({ ...states, [homeId]: 'LOADING' }));

    try {
      const response = await this.apiClient.getParticipantEventSummaries({ shelterHomeId: homeId });

      if (this.programContext.scopeVersion() !== scopeVersion) {
        // The programme/zone changed while this read was in flight: the
        // payload belongs to the previous scope and must never land.
        return false;
      }

      if (!response.success) {
        this.summaryHomeStates.update(states => ({ ...states, [homeId]: 'FAILED' }));
        return false;
      }

      this.summaryEntriesState.update(entries => {
        const next = { ...entries };

        for (const summary of response.data.summaries) {
          next[summary.participantId] = summary;
        }

        return next;
      });

      // Issues are read-only facts reported by the backend; they are shown,
      // never repaired silently and never fabricated.
      this.summaryIssuesState.update(current => [
        ...current.filter(issue => !response.data.issues.some(
          fresh => fresh.participantId === issue.participantId &&
            fresh.eventId === issue.eventId && fresh.code === issue.code
        )),
        ...response.data.issues,
      ]);

      this.summaryHomeStates.update(states => ({ ...states, [homeId]: 'LOADED' }));
      return true;
    } catch {
      // Terminal-state guarantee: the api client resolves every failure, so
      // this only guards truly unexpected throws.
      this.summaryHomeStates.update(states => ({ ...states, [homeId]: 'FAILED' }));
      return false;
    }
  }

  /** The backend summary for a participant, or null before it has loaded. */
  summaryFor(participantId: string): ParticipantEventSummaryEntry | null {
    return this.summaryEntriesState()[participantId] ?? null;
  }

  /** Whether a home's summary read is currently outstanding. */
  summariesLoadingForHome(homeId: string): boolean {
    return this.summaryHomeStates()[homeId] === 'LOADING';
  }

  /** Backend-reported issues for one participant (empty when none). */
  issuesFor(participantId: string): ParticipantEventSummaryIssue[] {
    return this.summaryIssuesState().filter(issue => issue.participantId === participantId);
  }

  getAll(): ParticipantEvent[] {
    return this.registrations$();
  }

  getById(id: string): ParticipantEvent | undefined {
    return this.registrations$().find(item => item.id === id);
  }

  getEventRegistrations(eventId: string): ParticipantEvent[] {
    return this.shelterData.registrationsForEvent(eventId);
  }

  getParticipantRegistrations(participantId: string): ParticipantEvent[] {
    return this.shelterData.registrationsForParticipant(participantId);
  }

  isAlreadyRegistered(participantId: string, eventId: string): boolean {
    return this.registrations$().some(
      registration =>
        registration.participantId === participantId &&
        registration.eventId === eventId &&
        registration.registrationStatus === 'REGISTERED'
    );
  }

  getParticipantEventCount(participantId: string): number {
    return this.getParticipantRegistrations(participantId)
      .filter(item => item.registrationStatus === 'REGISTERED').length;
  }

  getParticipantCategoryCount(
    participantId: string,
    category: Event['category']
  ): number {
    return this.getParticipantRegistrations(participantId)
      .filter(item => item.registrationStatus === 'REGISTERED')
      .filter(registration =>
        // The row's own denormalized category is the fallback when the event
        // is missing from the cached master; the backend sent both.
        (this.eventService.getById(registration.eventId)?.category
          ?? registration.category) === category
      ).length;
  }

  getParticipantIndividualCount(participantId: string): number {
    return this.getParticipantRegistrations(participantId)
      .filter(item => item.registrationStatus === 'REGISTERED')
      .filter(registration =>
        (this.eventService.getById(registration.eventId)?.mode
          ?? registration.mode) === 'SOLO'
      ).length;
  }

  // ==========================================
  // EVENT-DAY REGISTRATION (check-in)
  // ==========================================

  /**
   * The event-day check-in queue as last read from the backend. Rows only
   * ever exist for LOCKED home sheets (the backend excludes every other
   * home), so a row here IS the backend's confirmation that the home is
   * locked and the participant may be checked in.
   */
  private readonly eventDayEntriesState = signal<EventDayRegistrationEntry[]>([]);

  /** True while the event-day queue is being read. */
  private readonly eventDayLoadingState = signal(false);

  /**
   * The scopeVersion the event-day queue was read under. A scope switch
   * bumps it, so a cached queue from TEST/ZONE_1/ZONE_2 is dropped and
   * re-read instead of leaking across the switch.
   */
  private eventDayScopeVersion = -1;

  readonly eventDayEntries = this.eventDayEntriesState.asReadonly();
  readonly eventDayLoading = this.eventDayLoadingState.asReadonly();

  /**
   * Reads the event-day check-in queue. `shelterHomeId` narrows the read;
   * without it the whole scope is returned. State is re-read from the
   * backend so a page refresh restores exactly what is persisted.
   */
  async loadEventDayRegistrations(
    shelterHomeId?: string,
    force = false
  ): Promise<EventDayRegistrationEntry[] | null> {
    const scopeVersion = this.programContext.scopeVersion();

    if (this.eventDayScopeVersion !== scopeVersion) {
      // Cross-scope guard: never serve the previous scope's queue.
      this.eventDayEntriesState.set([]);
      this.eventDayScopeVersion = scopeVersion;
      force = true;
    }

    if (!force && this.eventDayEntriesState().length && !shelterHomeId) {
      return this.eventDayEntriesState();
    }

    this.eventDayLoadingState.set(true);

    try {
      const response = await this.apiClient.listEventDayRegistrations(
        shelterHomeId ? { shelterHomeId } : undefined
      );

      if (this.programContext.scopeVersion() !== scopeVersion) {
        // Scope changed while this read was in flight: never land rows
        // read for the previous programme/zone.
        return null;
      }

      if (!response.success) {
        return null;
      }

      const entries = response.data.eventDayRegistrations;

      this.eventDayEntriesState.update(current => {
        if (shelterHomeId) {
          const next = current.filter(entry => entry.shelterHomeId !== shelterHomeId);
          return [...next, ...entries];
        }
        return entries;
      });

      this.eventDayScopeVersion = scopeVersion;

      return entries;
    } finally {
      this.eventDayLoadingState.set(false);
    }
  }

  /** The persisted event-day check-in row for a participant (or null). */
  eventDayEntryFor(participantId: string): EventDayRegistrationEntry | null {
    return this.eventDayEntriesState().find(
      entry => entry.participantId === participantId
    ) ?? null;
  }

  /** Whether the participant has completed the event-day check-in. */
  isCheckedInForEventDay(participantId: string): boolean {
    return this.eventDayEntryFor(participantId)?.checkInStatus === 'CHECKED_IN';
  }

  /**
   * Whether the participant's home sheet is confirmed and LOCKED, read
   * from the authoritative home-sheet state the backend returned.
   */
  isHomeSheetLocked(shelterHomeId: string): boolean {
    return this.shelterData.getHomeById(shelterHomeId)?.sheetStatus === 'LOCKED';
  }

  /**
   * Competition-registration eligibility on top of every existing rule:
   * the home sheet must be LOCKED and the participant checked in for the
   * event day. The backend enforces the same gate and stays authoritative.
   */
  isRegistrableForEvents(participantId: string): boolean {
    const participant = this.participantService.getParticipantById(participantId);
    if (!participant) return false;
    return this.isHomeSheetLocked(participant.shelterHomeId)
      && this.isCheckedInForEventDay(participantId);
  }

  /**
   * Upserts one participant's event-day check-in through the backend and
   * refreshes the queue from the persisted state. The backend upsert is
   * idempotent, so a retry can never create a duplicate row.
   */
  async markEventDayRegistration(
    participantId: string,
    shelterHomeId: string,
    status: EventDayCheckInStatus = 'CHECKED_IN'
  ): Promise<{ success: boolean; errors: string[] }> {
    const entry = this.eventDayEntryFor(participantId);

    const response = await this.apiClient.markEventDayRegistration({
      participantId,
      shelterHomeId,
      status,
      expectedVersion: entry ? entry.version : 0,
    });

    if (!response.success) {
      return { success: false, errors: [response.error.message] };
    }

    await this.loadEventDayRegistrations(shelterHomeId, true);

    return { success: true, errors: [] };
  }

  /**
   * Saves MANY event-day check-in states in ONE batch request.
   *
   * The persisted state is updated ONLY from the backend-confirmed
   * per-record results; afterwards ONLY the event-day list is re-read in
   * the background (never the app shell, session, homes or events). A
   * failed record leaves no state change here — the caller keeps its
   * staged choice and may retry just the failed records. The backend
   * upsert is keyed on participantId, so a retry never duplicates.
   */
  async saveEventDayAttendanceBatch(
    items: SaveEventDayAttendanceBatchItem[]
  ): Promise<EventDayBatchSaveResult> {
    const response = await this.apiClient.saveEventDayAttendanceBatch({ items });

    if (!response.success) {
      // Batch-level failure: nothing was written, every staged record
      // is still unsaved and stays retryable.
      return { success: false, errors: [response.error.message], results: [], summary: null };
    }

    const results = response.data.results;
    const summary = response.data.summary;

    // Server-confirmed state only: a record is settled (and its state
    // applied) when the backend CONFIRMED the write (created/updated/
    // unchanged). A VERSION_CONFLICT result reports the real current
    // state, so the entry is rebased and a retry can re-submit the
    // staged choice against the fresh version. INVALID results change
    // nothing.
    this.eventDayEntriesState.update(current => current.map(entry => {
      const result = results.find(candidate => candidate.participantId === entry.participantId);

      if (!result || result.outcome === 'INVALID') {
        return entry;
      }

      return {
        ...entry,
        checkInStatus: result.status,
        version: result.version,
      };
    }));

    // Background refresh of ONLY this list. Unsaved local edits are
    // staged outside this state, so they survive the refresh untouched.
    void this.loadEventDayRegistrations(undefined, true);

    return { success: true, errors: [], results, summary };
  }

  // ==========================================
  // LOCAL RULE VALIDATION
  // ==========================================

  /**
   * Frontend-side admissibility check run before a registration request.
   * The backend remains authoritative and may still reject the request.
   */
  validateRegistration(participantId: string, eventId: string): RegistrationValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    const participant = this.participantService.getParticipantById(participantId);
    const event = this.eventService.getById(eventId);

    if (!participant) {
      return { valid: false, errors: ['Participant not found.'], warnings: [] };
    }

    if (!event) {
      return { valid: false, errors: ['Event not found.'], warnings: [] };
    }

    if (event.status !== 'ACTIVE') {
      errors.push('This event is not currently active.');
    }

    if (participant.eligibilityStatus === 'INELIGIBLE') {
      errors.push('This participant is marked as ineligible.');
    }

    if (participant.validationStatus === 'FAILED') {
      errors.push('Participant validation has failed.');
    }

    // Event-day eligibility (the backend enforces the same gate):
    // home sheet confirmed + LOCKED first, then the event-day check-in.
    if (!this.isHomeSheetLocked(participant.shelterHomeId)) {
      errors.push(
        'Confirm and lock this home’s sheet before registering its participants for the event day.'
      );
    } else if (!this.isCheckedInForEventDay(participantId)) {
      errors.push(
        'Check this participant in for the event day before registering them for a competition.'
      );
    }

    if (participant.level && !event.eligibleLevels.includes(participant.level)) {
      errors.push(
        `Participant level (${this.levelLabel(participant.level)}) is not eligible for this event.`
      );
    }

    if (this.isAlreadyRegistered(participantId, eventId)) {
      errors.push('This participant is already registered for this event.');
    }

    const totalEvents = this.getParticipantEventCount(participantId);

    if (totalEvents >= NAKSHATRA_EVENT_RULES.maxTotalEventsPerParticipant) {
      errors.push(
        `Maximum ${NAKSHATRA_EVENT_RULES.maxTotalEventsPerParticipant} events per participant has been reached.`
      );
    }

    const categoryCount = this.getParticipantCategoryCount(participantId, event.category);

    if (categoryCount >= NAKSHATRA_EVENT_RULES.maxEventsPerCategory) {
      errors.push(
        `Maximum ${NAKSHATRA_EVENT_RULES.maxEventsPerCategory} events in the ${this.categoryLabel(event.category)} category has been reached.`
      );
    }

    const individualCount = this.getParticipantIndividualCount(participantId);

    if (event.mode === 'SOLO' && individualCount >= NAKSHATRA_EVENT_RULES.maxIndividualEvents) {
      errors.push(
        `Maximum ${NAKSHATRA_EVENT_RULES.maxIndividualEvents} individual events per participant has been reached.`
      );
    }

    if (event.mode === 'GROUP' && !event.minimumTeamSize) {
      warnings.push('This group event does not have a minimum team size configured.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ==========================================
  // BACKEND WRITES
  // ==========================================

  /**
   * Registers a participant through the backend, then re-reads the affected
   * registrations so the UI reflects persisted state rather than a local guess.
   */
  async registerParticipant(
    participantId: string,
    eventId: string
  ): Promise<RegistrationResult> {
    const validation = this.validateRegistration(participantId, eventId);

    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    const response = await this.apiClient.registerParticipant({ participantId, eventId });

    if (!response.success) {
      return { success: false, errors: [response.error.message] };
    }

    await this.refreshAfterWrite(eventId, participantId);

    return {
      success: true,
      registration: response.data.participantEvent,
      sourceWriteBack: response.data.sourceWriteBack,
      errors: [],
    };
  }

  async cancelRegistration(
    participantId: string,
    eventId: string
  ): Promise<RegistrationResult> {
    const response = await this.apiClient.cancelRegistration({ participantId, eventId });

    if (!response.success) {
      return { success: false, errors: [response.error.message] };
    }

    await this.refreshAfterWrite(eventId, participantId);

    return {
      success: true,
      registration: response.data.participantEvent,
      sourceWriteBack: response.data.sourceWriteBack,
      errors: [],
    };
  }

  async reactivateRegistration(
    participantId: string,
    eventId: string
  ): Promise<RegistrationResult> {
    const response = await this.apiClient.reactivateRegistration({ participantId, eventId });

    if (!response.success) {
      return { success: false, errors: [response.error.message] };
    }

    await this.refreshAfterWrite(eventId, participantId);

    return {
      success: true,
      registration: response.data.participantEvent,
      sourceWriteBack: response.data.sourceWriteBack,
      errors: [],
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private async refreshAfterWrite(eventId: string, participantId: string): Promise<void> {
    this.shelterData.invalidateRegistrations(eventId, participantId);
    await Promise.all([
      this.shelterData.loadEventRegistrations(eventId, true),
      this.shelterData.loadParticipantEvents(participantId, true),
      // The batched registration-count aggregate is refetched (ONE
      // request) so every page showing counts reflects this write.
      this.shelterData.refreshRegistrationCounts(),
    ]);
  }

  private categoryLabel(category: Event['category']): string {
    return EVENT_CATEGORY_LABELS[category];
  }

  private levelLabel(level: Participant['level']): string {
    return level ? PARTICIPANT_LEVEL_LABELS[level] : 'Unknown';
  }
}
