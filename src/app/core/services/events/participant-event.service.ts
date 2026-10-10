import { Injectable, computed, inject, signal } from '@angular/core';

import {
  EVENT_CATEGORY_LABELS,
  NAKSHATRA_EVENT_RULES,
  PARTICIPANT_LEVEL_LABELS,
} from '../../constants/nakshatra-rules';

import {
  Participant,
  Event,
  ParticipantEvent,
  ParticipantEventSummaryEntry,
  ParticipantEventSummaryIssue,
  SourceWriteBackResult,
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { ParticipantService } from '../participants/participant.service';
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
    this.summaryHomeStates.update(states => ({ ...states, [homeId]: 'LOADING' }));

    try {
      const response = await this.apiClient.getParticipantEventSummaries({ shelterHomeId: homeId });

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
    ]);
  }

  private categoryLabel(category: Event['category']): string {
    return EVENT_CATEGORY_LABELS[category];
  }

  private levelLabel(level: Participant['level']): string {
    return level ? PARTICIPANT_LEVEL_LABELS[level] : 'Unknown';
  }
}
