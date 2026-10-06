import { Injectable, computed, inject, signal } from '@angular/core';

import {
  ConnectedShelterHome,
  Event,
  ImportStatusEntry,
  Participant,
  ParticipantEvent,
  ValidationResult,
} from '../../models';

import { ApiClientService } from '../api/api-client.service';

/**
 * An import status entry projected into the frontend read model.
 * Only fields the backend actually returns are represented; nothing is inferred.
 */
export interface ShelterImportRecord {
  id: string;
  shelterHomeId: string;
  versionNumber: number | null;
  recordCount: number | null;
  validParticipantCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  status: string;
}

export type ShelterDataScope =
  | 'HOMES'
  | 'PARTICIPANTS'
  | 'EVENTS'
  | 'IMPORTS'
  | 'VALIDATIONS';

export interface ShelterDataError {
  scope: ShelterDataScope;
  shelterHomeId?: string;
  message: string;
}

export interface ShelterDataResult {
  success: boolean;
  errors: ShelterDataError[];
}

/**
 * Single source of truth for every backend-owned Nakshatra entity.
 *
 * Shelter homes and participants are created and maintained by the Apps Script
 * backend through the Google Sheet connection flow. This service caches those
 * records so that homes, participants, imports, registrations, teams,
 * attendance, scoring, results, certificates and reports all read the same
 * backend entities instead of maintaining separate frontend copies.
 */
@Injectable({ providedIn: 'root' })
export class ShelterDataService {
  private readonly apiClient = inject(ApiClientService);

  private readonly homesState = signal<ConnectedShelterHome[]>([]);
  private readonly participantsState = signal<Participant[]>([]);
  private readonly eventsState = signal<Event[]>([]);
  private readonly registrationsState = signal<ParticipantEvent[]>([]);
  private readonly importsState = signal<ShelterImportRecord[]>([]);
  private readonly validationsState = signal<ValidationResult[]>([]);
  private readonly errorsState = signal<ShelterDataError[]>([]);
  private readonly loadingState = signal(false);
  private readonly loadedState = signal(false);
  private readonly eventsLoadedState = signal(false);
  private readonly loadingEventsState = signal(false);
  private readonly loadingRegistrationsState = signal(false);
  private readonly registrationErrorsState = signal<Record<string, string>>({});

  /** Registrations already read from the backend, keyed by event or participant. */
  private readonly loadedEventRegistrations = new Set<string>();
  private readonly loadedParticipantRegistrations = new Set<string>();

  private pending: Promise<ShelterDataResult> | null = null;

  readonly homes = this.homesState.asReadonly();
  readonly participants = this.participantsState.asReadonly();
  readonly events = this.eventsState.asReadonly();
  readonly registrations = this.registrationsState.asReadonly();
  readonly imports = this.importsState.asReadonly();
  readonly validations = this.validationsState.asReadonly();
  readonly errors = this.errorsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  readonly eventsLoaded = this.eventsLoadedState.asReadonly();
  readonly loadingEvents = this.loadingEventsState.asReadonly();
  readonly loadingRegistrations = this.loadingRegistrationsState.asReadonly();
  readonly registrationErrors = this.registrationErrorsState.asReadonly();

  readonly hasHomes = computed(() => this.homesState().length > 0);
  readonly totalParticipants = computed(() => this.participantsState().length);
  readonly homesError = computed(() => this.errorFor('HOMES'));
  readonly eventsError = computed(() => this.errorFor('EVENTS'));

  /** Collapses parallel loads into one in-flight request. */
  refresh(): Promise<ShelterDataResult> {
    if (this.pending) {
      return this.pending;
    }

    this.pending = this.loadAll().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }

  /* ================================================================
     EVENTS
     ================================================================ */

  async loadEvents(): Promise<Event[] | null> {
    if (this.loadingEventsState()) {
      return this.eventsState();
    }

    this.loadingEventsState.set(true);

    const response = await this.apiClient.listEvents();

    this.loadingEventsState.set(false);

    if (!response.success) {
      this.recordError({ scope: 'EVENTS', message: response.error.message });
      return null;
    }

    this.eventsState.set(response.data.events);
    this.eventsLoadedState.set(true);
    this.clearErrors('EVENTS');
    return response.data.events;
  }

  getEventById(eventId: string): Event | undefined {
    return this.eventsState().find(event => event.id === eventId);
  }

  /* ================================================================
     REGISTRATIONS
     ================================================================ */

  /**
   * Reads persisted registrations for one event.
   *
   * Registrations are loaded per event or per participant on demand so that
   * opening a module never triggers requests for unrelated modules.
   */
  async loadEventRegistrations(
    eventId: string,
    force = false
  ): Promise<ParticipantEvent[] | null> {
    if (!force && this.loadedEventRegistrations.has(eventId)) {
      return this.registrationsForEvent(eventId);
    }

    this.loadingRegistrationsState.set(true);
    const response = await this.apiClient.listEventRegistrations(eventId);
    this.loadingRegistrationsState.set(false);

    if (!response.success) {
      this.setRegistrationError(eventId, response.error.message);
      return null;
    }

    this.registrationsState.update(current => [
      ...current.filter(item => item.eventId !== eventId),
      ...response.data.participantEvents,
    ]);
    this.loadedEventRegistrations.add(eventId);
    this.clearRegistrationError(eventId);
    return response.data.participantEvents;
  }

  async loadParticipantEvents(
    participantId: string,
    force = false
  ): Promise<ParticipantEvent[] | null> {
    if (!force && this.loadedParticipantRegistrations.has(participantId)) {
      return this.registrationsForParticipant(participantId);
    }

    this.loadingRegistrationsState.set(true);
    const response = await this.apiClient.listParticipantEvents(participantId);
    this.loadingRegistrationsState.set(false);

    if (!response.success) {
      this.setRegistrationError(participantId, response.error.message);
      return null;
    }

    this.registrationsState.update(current => [
      ...current.filter(item => item.participantId !== participantId),
      ...response.data.participantEvents,
    ]);
    this.loadedParticipantRegistrations.add(participantId);
    this.clearRegistrationError(participantId);
    return response.data.participantEvents;
  }

  registrationsForEvent(eventId: string): ParticipantEvent[] {
    return this.registrationsState().filter(item => item.eventId === eventId);
  }

  registrationsForParticipant(participantId: string): ParticipantEvent[] {
    return this.registrationsState().filter(
      item => item.participantId === participantId
    );
  }

  /** Drops cached registration reads so the next access re-hits the backend. */
  invalidateRegistrations(eventId?: string, participantId?: string): void {
    if (eventId) {
      this.loadedEventRegistrations.delete(eventId);
    }

    if (participantId) {
      this.loadedParticipantRegistrations.delete(participantId);
    }
  }

  registrationError(key: string): string {
    return this.registrationErrorsState()[key] ?? '';
  }

  private setRegistrationError(key: string, message: string): void {
    this.registrationErrorsState.update(current => ({ ...current, [key]: message }));
  }

  private clearRegistrationError(key: string): void {
    this.registrationErrorsState.update(current => {
      if (!(key in current)) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async loadConnectedHomes(): Promise<boolean> {
    const response = await this.apiClient.listShelterHomes();

    if (!response.success) {
      this.recordError({ scope: 'HOMES', message: response.error.message });
      return false;
    }

    this.homesState.set(response.data.shelterHomes);
    this.clearErrors('HOMES');
    return true;
  }

  /** Replaces one cached participant with the version the backend returned. */
  replaceParticipant(participant: Participant): void {
    this.participantsState.update(current => {
      const index = current.findIndex(item => item.id === participant.id);

      return index === -1
        ? [...current, participant]
        : current.map(item => (item.id === participant.id ? participant : item));
    });
  }

  /** Replaces the cached participants of one home with a fresh backend read. */
  async loadParticipants(shelterHomeId: string): Promise<Participant[] | null> {
    const response = await this.apiClient.listParticipants(shelterHomeId);

    if (!response.success) {
      this.recordError({
        scope: 'PARTICIPANTS',
        shelterHomeId,
        message: response.error.message,
      });
      return null;
    }

    this.participantsState.update(current => [
      ...current.filter(item => item.shelterHomeId !== shelterHomeId),
      ...response.data.participants,
    ]);
    this.clearErrors('PARTICIPANTS', shelterHomeId);
    return response.data.participants;
  }

  /** Reads import status from the backend `data.imports` collection. */
  async loadImportStatus(
    shelterHomeId: string,
    importVersionId?: string
  ): Promise<ImportStatusEntry[] | null> {
    const response = await this.apiClient.getImportStatus({
      shelterHomeId,
      importVersionId,
    });

    if (!response.success) {
      this.recordError({
        scope: 'IMPORTS',
        shelterHomeId,
        message: response.error.message,
      });
      return null;
    }

    const entries = response.data.imports.filter(
      entry => entry.shelterHomeId === shelterHomeId
    );

    this.importsState.update(current => [
      ...current.filter(item => item.shelterHomeId !== shelterHomeId),
      ...entries
        .map(entry => this.toImportRecord(entry))
        .filter((record): record is ShelterImportRecord => record !== null),
    ]);
    this.clearErrors('IMPORTS', shelterHomeId);
    return entries;
  }

  async loadValidationResults(
    shelterHomeId: string,
    importVersionId?: string
  ): Promise<ValidationResult[] | null> {
    const response = await this.apiClient.getValidationResults({
      shelterHomeId,
      importVersionId,
    });

    if (!response.success) {
      this.recordError({
        scope: 'VALIDATIONS',
        shelterHomeId,
        message: response.error.message,
      });
      return null;
    }

    const incoming = response.data.validationResults.map(result => ({
      ...result,
      importVersionId: result.importVersionId ?? importVersionId,
    }));

    // Replace every cached result belonging to a version we just received, so
    // that repeated refreshes cannot accumulate duplicates. Results the backend
    // leaves unscoped are appended, because there is no key to replace them by.
    const replacedVersions = new Set<string>([
      ...(importVersionId ? [importVersionId] : []),
      ...incoming.flatMap(result =>
        result.importVersionId ? [result.importVersionId] : []
      ),
    ]);

    this.validationsState.update(current => [
      ...current.filter(
        result =>
          !result.importVersionId ||
          !replacedVersions.has(result.importVersionId)
      ),
      ...incoming,
    ]);
    this.clearErrors('VALIDATIONS', shelterHomeId);
    return response.data.validationResults;
  }

  getHomeById(shelterHomeId: string): ConnectedShelterHome | undefined {
    return this.homesState().find(home => home.id === shelterHomeId);
  }

  getParticipantsByHomeId(shelterHomeId: string): Participant[] {
    return this.participantsState().filter(
      participant => participant.shelterHomeId === shelterHomeId
    );
  }

  getParticipantCount(shelterHomeId: string): number {
    return this.getParticipantsByHomeId(shelterHomeId).length;
  }

  getImportStatusForHome(shelterHomeId: string): ShelterImportRecord | undefined {
    return this.importsState()
      .filter(item => item.shelterHomeId === shelterHomeId)
      .sort((a, b) => (b.versionNumber ?? -1) - (a.versionNumber ?? -1))[0];
  }

  getValidationResultsForHome(shelterHomeId: string): ValidationResult[] {
    const home = this.getHomeById(shelterHomeId);
    const versionId = home?.currentImportVersionId;

    return this.validationsState().filter(result =>
      result.importVersionId === versionId ||
      result.entityId?.startsWith(shelterHomeId)
    );
  }

  errorFor(scope: ShelterDataScope, shelterHomeId?: string): string {
    return (
      this.errorsState().find(
        error =>
          error.scope === scope &&
          (shelterHomeId === undefined || error.shelterHomeId === shelterHomeId)
      )?.message ?? ''
    );
  }

  private async loadAll(): Promise<ShelterDataResult> {
    this.loadingState.set(true);
    this.errorsState.set([]);

    try {
      if (!await this.loadConnectedHomes()) {
        return { success: false, errors: this.errorsState() };
      }

      await this.loadEvents();

      const homes = this.homesState();

      await Promise.all(
        homes.map(async home => {
          await this.loadImportStatus(home.id, home.currentImportVersionId);
          await this.loadValidationResults(
            home.id,
            home.currentImportVersionId
          );
          await this.loadParticipants(home.id);
        })
      );

      const errors = this.errorsState();

      return { success: errors.length === 0, errors };
    } finally {
      this.loadingState.set(false);
      this.loadedState.set(true);
    }
  }

  private toImportRecord(entry: ImportStatusEntry): ShelterImportRecord | null {
    const id = entry.importVersionId ?? entry.id;

    if (!id) {
      return null;
    }

    return {
      id,
      shelterHomeId: entry.shelterHomeId,
      versionNumber: entry.versionNumber ?? null,
      recordCount: entry.recordCount ?? null,
      validParticipantCount: entry.validParticipantCount ?? null,
      errorCount: entry.errorCount ?? null,
      warningCount: entry.warningCount ?? null,
      status: entry.status ?? 'UNKNOWN',
    };
  }

  private recordError(error: ShelterDataError): void {
    this.errorsState.update(current => [
      ...current.filter(
        item =>
          !(item.scope === error.scope && item.shelterHomeId === error.shelterHomeId)
      ),
      error,
    ]);
  }

  private clearErrors(
    scope: ShelterDataScope,
    shelterHomeId?: string
  ): void {
    this.errorsState.update(current =>
      current.filter(
        error =>
          !(
            error.scope === scope &&
            (shelterHomeId === undefined ||
              error.shelterHomeId === shelterHomeId)
          )
      )
    );
  }
}
