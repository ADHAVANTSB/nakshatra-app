import { Injectable, computed, inject } from '@angular/core';

import {
  EVENT_CATEGORY_LABELS,
  NAKSHATRA_EVENT_RULES,
  PARTICIPANT_LEVEL_LABELS,
} from '../../constants/nakshatra-rules';

import {
  Participant,
  Event,
  ParticipantEvent,
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
