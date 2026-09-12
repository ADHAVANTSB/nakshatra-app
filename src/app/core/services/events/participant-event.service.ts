import { Injectable, computed, inject, signal } from '@angular/core';

import {
  Participant,
  Event,
  ParticipantEvent,
  RegistrationStatus
} from '../../models';

import { ParticipantService } from '../participants/participant.service';
import { EventService } from './event.service';

export interface RegistrationValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ParticipantEventService {

  private readonly participantService =
    inject(ParticipantService);

  private readonly eventService =
    inject(EventService);

  private readonly registrations =
    signal<ParticipantEvent[]>([]);

  readonly registrations$ =
    this.registrations.asReadonly();

  readonly registeredCount = computed(() =>
    this.registrations().filter(
      item => item.registrationStatus === 'REGISTERED'
    ).length
  );


  // ==========================================
  // BASIC GETTERS
  // ==========================================

  getAll(): ParticipantEvent[] {
    return this.registrations();
  }


  getById(id: string): ParticipantEvent | undefined {
    return this.registrations().find(
      item => item.id === id
    );
  }


  getParticipantRegistrations(
    participantId: string
  ): ParticipantEvent[] {

    return this.registrations().filter(
      item =>
        item.participantId === participantId &&
        item.registrationStatus === 'REGISTERED'
    );
  }


  getEventRegistrations(
    eventId: string
  ): ParticipantEvent[] {

    return this.registrations().filter(
      item =>
        item.eventId === eventId &&
        item.registrationStatus === 'REGISTERED'
    );
  }


  getParticipantEventCount(
    participantId: string
  ): number {

    return this.getParticipantRegistrations(
      participantId
    ).length;
  }


  getParticipantCategoryCount(
    participantId: string,
    category: Event['category']
  ): number {

    const registrations =
      this.getParticipantRegistrations(participantId);

    return registrations.filter(registration => {

      const event =
        this.eventService.getById(
          registration.eventId
        );

      return event?.category === category;

    }).length;
  }


  getParticipantIndividualCount(
    participantId: string
  ): number {

    const registrations =
      this.getParticipantRegistrations(participantId);

    return registrations.filter(registration => {

      const event =
        this.eventService.getById(
          registration.eventId
        );

      return event?.mode === 'SOLO';

    }).length;
  }


  // ==========================================
  // DUPLICATE CHECK
  // ==========================================

  isAlreadyRegistered(
    participantId: string,
    eventId: string
  ): boolean {

    return this.registrations().some(
      registration =>
        registration.participantId === participantId &&
        registration.eventId === eventId &&
        registration.registrationStatus === 'REGISTERED'
    );
  }


  // ==========================================
  // VALIDATION
  // ==========================================

  validateRegistration(
    participantId: string,
    eventId: string
  ): RegistrationValidation {

    const errors: string[] = [];
    const warnings: string[] = [];

    const participant =
      this.participantService.getParticipantById(
        participantId
      );

    const event =
      this.eventService.getById(eventId);


    // ------------------------------------------
    // Participant exists
    // ------------------------------------------

    if (!participant) {

      return {
        valid: false,
        errors: ['Participant not found.'],
        warnings: []
      };

    }


    // ------------------------------------------
    // Event exists
    // ------------------------------------------

    if (!event) {

      return {
        valid: false,
        errors: ['Event not found.'],
        warnings: []
      };

    }


    // ------------------------------------------
    // Event must be active
    // ------------------------------------------

    if (event.status !== 'ACTIVE') {

      errors.push(
        'This event is not currently active.'
      );

    }


    // ------------------------------------------
    // Participant eligibility
    // ------------------------------------------

    if (
      participant.eligibilityStatus ===
      'INELIGIBLE'
    ) {

      errors.push(
        'This participant is marked as ineligible.'
      );

    }


    // ------------------------------------------
    // Participant validation
    // ------------------------------------------

    if (
      participant.validationStatus ===
      'FAILED'
    ) {

      errors.push(
        'Participant validation has failed.'
      );

    }


    // ------------------------------------------
    // Level eligibility
    // ------------------------------------------

    if (
      participant.level &&
      !event.eligibleLevels.includes(
        participant.level
      )
    ) {

      errors.push(
        `Participant level (${this.levelLabel(participant.level)}) is not eligible for this event.`
      );

    }


    // ------------------------------------------
    // Duplicate registration
    // ------------------------------------------

    if (
      this.isAlreadyRegistered(
        participantId,
        eventId
      )
    ) {

      errors.push(
        'This participant is already registered for this event.'
      );

    }


    // ------------------------------------------
    // MAX 6 EVENTS
    // ------------------------------------------

    const totalEvents =
      this.getParticipantEventCount(
        participantId
      );

    if (totalEvents >= 6) {

      errors.push(
        'Maximum 6 events per participant has been reached.'
      );

    }


    // ------------------------------------------
    // MAX 2 EVENTS PER CATEGORY
    // ------------------------------------------

    const categoryCount =
      this.getParticipantCategoryCount(
        participantId,
        event.category
      );

    if (categoryCount >= 2) {

      errors.push(
        `Maximum 2 events in the ${this.categoryLabel(event.category)} category has been reached.`
      );

    }


    // ------------------------------------------
    // MAX 3 INDIVIDUAL EVENTS
    // ------------------------------------------

    const individualCount =
      this.getParticipantIndividualCount(
        participantId
      );

    if (
      event.mode === 'SOLO' &&
      individualCount >= 3
    ) {

      errors.push(
        'Maximum 3 individual events per participant has been reached.'
      );

    }


    // ------------------------------------------
    // Team information
    // ------------------------------------------

    if (
      event.mode === 'GROUP' &&
      !event.minimumTeamSize
    ) {

      warnings.push(
        'This group event does not have a minimum team size configured.'
      );

    }


    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }


  // ==========================================
  // REGISTER
  // ==========================================

  registerParticipant(
    participantId: string,
    eventId: string,
    registeredBy: string = 'ADMIN'
  ): {
    success: boolean;
    registration?: ParticipantEvent;
    validation: RegistrationValidation;
  } {

    const validation =
      this.validateRegistration(
        participantId,
        eventId
      );


    if (!validation.valid) {

      return {
        success: false,
        validation
      };

    }


    const participant =
      this.participantService.getParticipantById(
        participantId
      );

    if (!participant) {

      return {
        success: false,
        validation: {
          valid: false,
          errors: ['Participant not found.'],
          warnings: []
        }
      };

    }


    const now =
      new Date().toISOString();


    const registration: ParticipantEvent = {

      id: `PE-${Date.now()}`,

      participantId,

      eventId,

      registrationStatus: 'REGISTERED',

      source: 'NAKSHATRA',

      version: 1,

      createdAt: now,

      createdBy: registeredBy,

      updatedAt: now,

      updatedBy: registeredBy
    };


    this.registrations.update(
      current => [
        ...current,
        registration
      ]
    );


    return {
      success: true,
      registration,
      validation
    };
  }


  // ==========================================
  // CANCEL REGISTRATION
  // ==========================================

  cancelRegistration(
    registrationId: string,
    updatedBy: string = 'ADMIN'
  ): boolean {

    const existing =
      this.getById(registrationId);

    if (!existing) {
      return false;
    }


    this.registrations.update(
      current =>
        current.map(item =>
          item.id === registrationId
            ? {
                ...item,

                registrationStatus:
                  'CANCELLED' as RegistrationStatus,

                version:
                  item.version + 1,

                updatedAt:
                  new Date().toISOString(),

                updatedBy
              }
            : item
        )
    );


    return true;
  }


  // ==========================================
  // REACTIVATE REGISTRATION
  // ==========================================

  reactivateRegistration(
    registrationId: string,
    updatedBy: string = 'ADMIN'
  ): boolean {

    const existing =
      this.getById(registrationId);

    if (!existing) {
      return false;
    }


    const validation =
      this.validateRegistration(
        existing.participantId,
        existing.eventId
      );


    if (!validation.valid) {
      return false;
    }


    this.registrations.update(
      current =>
        current.map(item =>
          item.id === registrationId
            ? {
                ...item,

                registrationStatus:
                  'REGISTERED' as RegistrationStatus,

                version:
                  item.version + 1,

                updatedAt:
                  new Date().toISOString(),

                updatedBy
              }
            : item
        )
    );


    return true;
  }


  // ==========================================
  // HELPERS
  // ==========================================

  private categoryLabel(
    category: Event['category']
  ): string {

    const labels: Record<
      Event['category'],
      string
    > = {

      ARTS: 'Arts',

      LITERARY: 'Literary',

      CULTURAL: 'Cultural'

    };

    return labels[category];
  }


  private levelLabel(
    level: Participant['level']
  ): string {

    if (!level) {
      return 'Unknown';
    }


    const labels: Record<
      NonNullable<Participant['level']>,
      string
    > = {

      SUB_JUNIOR: 'Sub Juniors',

      JUNIOR: 'Juniors',

      SENIOR: 'Seniors',

      SUPER_SENIOR: 'Super Seniors'

    };

    return labels[level];
  }
}