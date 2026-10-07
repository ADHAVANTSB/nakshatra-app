import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import {
  Event,
  EventCategory,
  EventMode,
  Gender,
  Participant,
  ParticipantEvent,
  SourceWriteBackResult,
} from '../../core/models';
import { EventService } from '../../core/services/events/event.service';
import {
  ParticipantEventService,
  RegistrationResult,
} from '../../core/services/events/participant-event.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import {
  EditableParticipantFields,
  ParticipantService,
} from '../../core/services/participants/participant.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';

/** Category order used when grouping a participant's backend registrations. */
const REGISTRATION_CATEGORY_ORDER: readonly EventCategory[] = [
  'ARTS',
  'LITERARY',
  'CULTURAL',
];

/**
 * One resolved registration. Event display data is taken from the registration
 * row first, because the backend may inline it, and only then from the event
 * master. Nothing is invented when both are absent.
 */
interface RegistrationEntry {
  registration: ParticipantEvent;
  event?: Event;
  name: string;
  category?: EventCategory;
  mode?: EventMode;
  categoryKnown: boolean;
}

/** Registrations grouped under a single backend event category. */
interface RegistrationGroup {
  category: EventCategory;
  entries: RegistrationEntry[];
}

/**
 * Participant management view.
 *
 * Participant records are owned by the backend and produced by the Google Sheet
 * import. This page therefore resolves, filters and reports on backend
 * participant ids; it never creates a second frontend participant dataset.
 * Shelter home capacity is enforced by the backend import rules and reported
 * here for visibility.
 *
 * The detail panel reads and writes the same backend records: edits go through
 * `ParticipantService.updateParticipant` (optimistic concurrency on `version`)
 * and event participation goes through `ParticipantEventService`. Nothing here
 * fabricates a participant, an event or a saved version.
 */
@Component({
  selector: 'nk-participants',
  imports: [FormsModule],
  templateUrl: './participants.html',
  styleUrl: './participants.scss',
})
export class Participants implements OnInit {
  private readonly shelterData = inject(ShelterDataService);
  private readonly participantService = inject(ParticipantService);
  private readonly shelterHomeService = inject(ShelterHomeService);
  private readonly eventService = inject(EventService);
  private readonly participantEventService = inject(ParticipantEventService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  // ---------------------------------------------------------
  // STATE
  // ---------------------------------------------------------

  readonly selectedHomeId = signal<string | null>(null);
  readonly search = signal('');
  readonly levelFilter = signal<string>('');
  readonly validationFilter = signal<string>('');
  readonly successMessage = signal('');

  /** Backend editable-field bounds; they mirror the backend validation rules. */
  readonly minAge = this.participantService.MIN_AGE;
  readonly maxAge = this.participantService.MAX_AGE;
  readonly minStandard = this.participantService.MIN_STANDARD;
  readonly maxStandard = this.participantService.MAX_STANDARD;

  // ---------------------------------------------------------
  // DETAIL VIEW STATE
  // ---------------------------------------------------------

  readonly openParticipantId = signal<string | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');

  // ---------------------------------------------------------
  // EDIT STATE
  // ---------------------------------------------------------

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly saveErrorCode = signal('');
  readonly saveSuccess = signal('');
  /** Backend version of the last successful save. */
  readonly saveVersion = signal<number | null>(null);
  /** Non-blocking note about whether the source Google Sheet was written. */
  readonly saveWriteBackNote = signal('');
  /** Backend-supplied detail for the write-back note, when present. */
  readonly saveWriteBackDetail = signal('');
  /** Set when the post-save re-read of the participant failed. */
  readonly saveReadBackNote = signal('');

  /** Only the four backend-editable fields are ever held here. */
  readonly editName = signal('');
  readonly editGender = signal<Gender>('MALE');
  readonly editAge = signal(this.minAge);
  readonly editStandard = signal(this.minStandard);

  // ---------------------------------------------------------
  // REGISTRATION STATE
  // ---------------------------------------------------------

  /** `null` means "not read yet"; `[]` means the backend returned no rows. */
  readonly registrations = signal<ParticipantEvent[] | null>(null);
  readonly registrationsLoading = signal(false);
  readonly registrationsError = signal('');
  readonly registrationBusy = signal(false);
  readonly registrationError = signal('');
  readonly registrationSuccess = signal('');
  readonly pendingEventId = signal('');

  // ---------------------------------------------------------
  // DATA
  // ---------------------------------------------------------

  readonly loading = this.shelterData.loading;
  readonly homes = this.shelterHomeService.homes$;
  readonly homesError = this.shelterData.homesError;
  readonly maxPerHome = this.participantService.MAX_PARTICIPANTS_PER_HOME;

  readonly eventsLoading = this.eventService.loading;
  readonly eventsLoadError = this.eventService.loadError;

  readonly participants = computed<Participant[]>(() => {
    const homeId = this.selectedHomeId();
    const query = this.search().trim().toLowerCase();
    const level = this.levelFilter();
    const validation = this.validationFilter();

    return this.participantService
      .getParticipants()
      .filter(participant => !homeId || participant.shelterHomeId === homeId)
      .filter(participant => !level || participant.level === level)
      .filter(participant => !validation || participant.validationStatus === validation)
      .filter(participant =>
        !query ||
        [participant.fullName, participant.participantCode, this.homeName(participant.shelterHomeId)]
          .some(value => value.toLowerCase().includes(query))
      );
  });

  readonly totalCount = computed(() => this.participantService.getParticipants().length);

  readonly homeCapacity = computed(() => {
    const homeId = this.selectedHomeId();
    if (!homeId) {
      return null;
    }

    const used = this.participantService.getParticipantCount(homeId);

    return {
      used,
      max: this.maxPerHome,
      remaining: this.participantService.getRemainingSlots(homeId),
      full: used >= this.maxPerHome,
    };
  });

  readonly maleCount = computed(() => this.filteredGender('MALE'));
  readonly femaleCount = computed(() => this.filteredGender('FEMALE'));

  readonly levelsPresent = computed(() => {
    const levels = new Set<string>();

    for (const participant of this.participantService.getParticipants()) {
      if (participant.level) {
        levels.add(participant.level);
      }
    }

    return [...levels];
  });

  readonly validationStatesPresent = computed(() => {
    const states = new Set<string>();

    for (const participant of this.participantService.getParticipants()) {
      states.add(participant.validationStatus);
    }

    return [...states];
  });

  /** The open participant, always resolved from the shared backend cache. */
  readonly detailParticipant = computed<Participant | null>(() => {
    const participantId = this.openParticipantId();

    return participantId
      ? this.participantService.getParticipantById(participantId) ?? null
      : null;
  });

  /** A locked record is read-only in the UI; the backend lock is not bypassed. */
  readonly locked = computed(
    () => this.detailParticipant()?.lockStatus === 'LOCKED'
  );

  /** True only once the backend event master has been read at least once. */
  private readonly eventCatalogueReady = computed(
    () => this.eventService.loaded() && !this.eventsLoading()
  );

  /** Registrations grouped by backend event category, in catalogue order. */
  readonly eventGroups = computed<RegistrationGroup[]>(() => {
    const list = this.registrations();

    if (!list) {
      return [];
    }

    const groups: RegistrationGroup[] = [];

    for (const category of REGISTRATION_CATEGORY_ORDER) {
      const entries = list
        .map(registration => this.resolveEntry(registration))
        .filter(entry => entry.category === category);

      if (entries.length) {
        groups.push({ category, entries });
      }
    }

    return groups;
  });

  /**
   * Registrations that carry neither an inlined category nor a matching event
   * master entry. They are reported as-is; no category, name or mode is invented.
   */
  readonly unresolvedRegistrations = computed<RegistrationEntry[]>(() => {
    const list = this.registrations();

    if (!list) {
      return [];
    }

    return list
      .map(registration => this.resolveEntry(registration))
      .filter(entry => !entry.category);
  });

  private resolveEntry(registration: ParticipantEvent): RegistrationEntry {
    const event = this.eventService.getById(registration.eventId);

    return {
      registration,
      event,
      name: registration.eventName ?? event?.name ?? 'Event not in the current event list',
      category: registration.category ?? event?.category,
      mode: registration.mode ?? event?.mode,
      categoryKnown: !!(registration.category ?? event?.category),
    };
  }

  /** Active backend events this participant has no registration row for. */
  readonly availableEvents = computed<Event[]>(() => {
    const list = this.registrations();

    if (!this.detailParticipant()) {
      return [];
    }

    const taken = new Set<string>();

    for (const registration of list ?? []) {
      taken.add(registration.eventId);
    }

    return this.eventService.activeEvents().filter(event => !taken.has(event.id));
  });

  /**
   * The backend answered and there is no ACTIVE registration. Cancelled rows may
   * still exist (and stay listed for Reactivate), but they are not registrations.
   */
  readonly noRegisteredEvents = computed(() => {
    const list = this.registrations();

    return list !== null &&
      !list.some(registration => registration.registrationStatus === 'REGISTERED');
  });

  // ---------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------

  ngOnInit(): void {
    void this.shelterData.refresh();

    // The Homes module navigates here with shelterHomeId; keep that filter.
    this.route.queryParamMap.subscribe(params => {
      this.selectedHomeId.set(params.get('shelterHomeId') ?? params.get('homeId'));
    });
  }

  // ---------------------------------------------------------
  // FILTERS
  // ---------------------------------------------------------

  selectHome(homeId: string): void {
    this.selectedHomeId.set(homeId || null);
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  setLevel(value: string): void {
    this.levelFilter.set(value);
  }

  setValidation(value: string): void {
    this.validationFilter.set(value);
  }

  clearFilters(): void {
    this.search.set('');
    this.levelFilter.set('');
    this.validationFilter.set('');
    this.selectedHomeId.set(null);
    void this.router.navigate(['/participants']);
  }

  // ---------------------------------------------------------
  // DETAIL VIEW
  // ---------------------------------------------------------

  /**
   * Opens one participant and reads the two backend resources the panel needs:
   * the participant record itself and its registrations.
   */
  async openParticipant(participant: Participant): Promise<void> {
    if (this.detailLoading()) {
      return;
    }

    this.openParticipantId.set(participant.id);
    this.editing.set(false);
    this.registrations.set(null);
    this.resetFeedback();
    this.detailLoading.set(true);

    if (!this.eventService.loaded()) {
      void this.eventService.load();
    }

    await Promise.all([
      this.reloadParticipant(participant.id),
      this.reloadRegistrations(participant.id),
    ]);

    this.detailLoading.set(false);
  }

  closeDetail(): void {
    if (this.saving() || this.registrationBusy()) {
      return;
    }

    this.openParticipantId.set(null);
    this.editing.set(false);
    this.registrations.set(null);
    this.resetFeedback();
  }

  /** Re-reads the open participant so the displayed version is the stored one. */
  async refreshParticipantRecord(): Promise<void> {
    const participantId = this.openParticipantId();

    if (!participantId || this.detailLoading()) {
      return;
    }

    this.detailLoading.set(true);

    await this.reloadParticipant(participantId);

    this.detailLoading.set(false);
    this.saveError.set('');
    this.saveErrorCode.set('');
  }

  async reloadRegistrationsNow(): Promise<void> {
    const participantId = this.openParticipantId();

    if (!participantId || this.registrationsLoading() || this.registrationBusy()) {
      return;
    }

    await this.reloadRegistrations(participantId);
  }

  // ---------------------------------------------------------
  // EDIT
  // ---------------------------------------------------------

  openEdit(): void {
    const participant = this.detailParticipant();

    if (!participant || this.saving()) {
      return;
    }

    if (participant.lockStatus === 'LOCKED') {
      this.saveErrorCode.set('');
      this.saveError.set('This participant is locked and cannot be edited.');
      return;
    }

    this.editName.set(participant.fullName);
    this.editGender.set(participant.gender);
    this.editAge.set(participant.age);
    this.editStandard.set(participant.standard);
    this.saveError.set('');
    this.saveErrorCode.set('');
    this.clearSaveSuccess();
    this.editing.set(true);
  }

  cancelEdit(): void {
    if (this.saving()) {
      return;
    }

    this.editing.set(false);
    this.saveError.set('');
    this.saveErrorCode.set('');
  }

  setEditName(value: string): void {
    this.editName.set(value);
  }

  setEditGender(value: string): void {
    this.editGender.set(value === 'FEMALE' ? 'FEMALE' : 'MALE');
  }

  setEditAge(value: number | null): void {
    this.editAge.set(value ?? 0);
  }

  setEditStandard(value: number | null): void {
    this.editStandard.set(value ?? 0);
  }

  /**
   * Saves the four editable fields through the backend.
   *
   * `updateParticipant` sends the open participant's own `version` as
   * `expectedVersion`, so a stale write is rejected with VERSION_CONFLICT and
   * nothing is overwritten. Success is only ever reported when the backend
   * accepted the write, and the record is then re-read from the backend so the
   * version shown is the persisted one.
   */
  async saveParticipant(): Promise<void> {
    const participant = this.detailParticipant();

    if (!participant || this.saving()) {
      return;
    }

    if (participant.lockStatus === 'LOCKED') {
      this.saveErrorCode.set('');
      this.saveError.set('This participant is locked and cannot be edited.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    this.saveErrorCode.set('');
    this.clearSaveSuccess();

    const changes: EditableParticipantFields = {
      fullName: this.editName(),
      gender: this.editGender(),
      age: this.editAge(),
      standard: this.editStandard(),
    };

    const result = await this.participantService.updateParticipant(participant, changes);

    this.saving.set(false);

    if (!result.success) {
      const message = this.describeSaveFailure(result.errorCode, result.errors);

      this.saveErrorCode.set(result.errorCode ?? '');
      this.saveError.set(message);
      this.notifications.error(
        result.errorCode === 'SOURCE_ROW_IDENTITY_UNVERIFIED'
          ? 'Source identity could not be verified'
          : 'The participant could not be updated',
        message
      );
      return;
    }

    this.editing.set(false);

    // Re-read the stored record and its registrations so the panel shows the
    // backend version rather than the write response alone.
    const [persisted] = await Promise.all([
      this.participantService.loadParticipant(participant.id),
      this.reloadRegistrations(participant.id),
    ]);

    if (persisted) {
      this.participantService.replaceParticipant(persisted);
    }

    const version =
      persisted?.version ?? result.participant?.version ?? participant.version;

    const writeBack = this.describeSourceWriteBack(result.sourceWriteBack);

    this.saveSuccess.set('Updated in Nakshatra');
    this.saveVersion.set(version);
    this.saveWriteBackNote.set(writeBack.label);
    this.saveWriteBackDetail.set(writeBack.detail);
    this.saveReadBackNote.set(
      persisted ? '' : 'The saved record could not be read back; refresh to confirm.'
    );

    const toastDetail = [writeBack.label, writeBack.detail].filter(Boolean).join(' — ');

    if (writeBack.label && result.sourceWriteBack?.status !== 'UPDATED') {
      this.notifications.warning('Updated in Nakshatra', toastDetail);
    } else {
      this.notifications.success('Updated in Nakshatra', toastDetail || undefined);
    }
  }

  /**
   * Describes whether the backend also wrote a participant edit back to the
   * source Google Sheet. An absent report makes no claim either way.
   */
  private describeSourceWriteBack(
    writeBack: SourceWriteBackResult | undefined
  ): { label: string; detail: string } {
    if (!writeBack) {
      return { label: '', detail: '' };
    }

    switch (writeBack.status) {
      case 'UPDATED':
        return { label: 'Google Sheet updated', detail: '' };

      case 'SKIPPED':
      case 'FAILED':
        return { label: 'Google Sheet not updated', detail: writeBack.message ?? '' };

      case 'UNVERIFIED':
        return { label: 'Source identity could not be verified', detail: writeBack.message ?? '' };

      default:
        return { label: '', detail: '' };
    }
  }

  /**
   * Toasts the outcome of a successful registration write, including whether
   * the backend wrote the change back to the Google Sheet. An absent report
   * makes no sheet claim.
   */
  private notifyRegistrationSuccess(
    message: string,
    writeBack: SourceWriteBackResult | undefined
  ): void {
    if (!writeBack) {
      this.notifications.success(message);
      return;
    }

    switch (writeBack.status) {
      case 'UPDATED':
        this.notifications.success(message, 'Google Sheet updated.');
        return;

      case 'SKIPPED':
        this.notifications.success(
          message,
          'Registration updated in Nakshatra, but the Google Sheet was not changed.'
        );
        return;

      case 'FAILED':
        this.notifications.warning(
          message,
          writeBack.message
            ?? 'Registration updated in Nakshatra, but the Google Sheet write-back failed.'
        );
        return;

      case 'UNVERIFIED':
        this.notifications.warning(
          message,
          writeBack.message
            ?? 'Registration updated in Nakshatra, but the Google Sheet update could not be verified.'
        );
        return;

      default:
        this.notifications.success(message);
    }
  }

  // ---------------------------------------------------------
  // EVENT PARTICIPATION
  // ---------------------------------------------------------

  setPendingEvent(value: string): void {
    this.pendingEventId.set(value || '');
  }

  async addEvent(): Promise<void> {
    const participant = this.detailParticipant();
    const eventId = this.pendingEventId();

    if (!participant || !eventId || this.registrationBusy()) {
      return;
    }

    const event = this.eventService.getById(eventId);

    if (!event || event.status !== 'ACTIVE') {
      this.registrationError.set('The selected event is no longer available.');
      return;
    }

    if (this.participantEventService.isAlreadyRegistered(participant.id, event.id)) {
      this.registrationError.set('This participant is already registered for that event.');
      return;
    }

    this.registrationBusy.set(true);
    this.registrationError.set('');
    this.registrationSuccess.set('');

    const result = await this.participantEventService.registerParticipant(
      participant.id,
      event.id
    );

    if (await this.finishRegistrationWrite(participant.id, result, `Registered for ${event.name}.`)) {
      this.pendingEventId.set('');
    }
  }

  async cancelEvent(registration: ParticipantEvent): Promise<void> {
    const participant = this.detailParticipant();

    if (!participant || this.registrationBusy()) {
      return;
    }

    if (registration.participantId !== participant.id) {
      return;
    }

    const eventName = this.eventName(registration.eventId);

    this.registrationBusy.set(true);
    this.registrationError.set('');
    this.registrationSuccess.set('');

    const result = await this.participantEventService.cancelRegistration(
      participant.id,
      registration.eventId
    );

    await this.finishRegistrationWrite(
      participant.id,
      result,
      `Registration cancelled for ${eventName}.`
    );
  }

  async reactivateEvent(registration: ParticipantEvent): Promise<void> {
    const participant = this.detailParticipant();

    if (!participant || this.registrationBusy()) {
      return;
    }

    if (registration.participantId !== participant.id) {
      return;
    }

    const eventName = this.eventName(registration.eventId);

    this.registrationBusy.set(true);
    this.registrationError.set('');
    this.registrationSuccess.set('');

    const result = await this.participantEventService.reactivateRegistration(
      participant.id,
      registration.eventId
    );

    await this.finishRegistrationWrite(
      participant.id,
      result,
      `Registration restored for ${eventName}.`
    );
  }

  /**
   * Common tail of add / cancel / reactivate. On success the service has
   * already re-read this participant's registrations, so the list is rendered
   * from that refreshed cache (a fresh request is issued only if that refresh
   * did not land). Returns whether the backend accepted the write.
   */
  private async finishRegistrationWrite(
    participantId: string,
    result: RegistrationResult,
    successMessage: string
  ): Promise<boolean> {
    await this.reloadRegistrations(participantId, false);

    this.registrationBusy.set(false);

    if (!result.success) {
      const detail = this.describeFailure(result.errors);

      this.registrationError.set(detail);
      this.notifications.error('Event participation could not be changed.', detail);
      return false;
    }

    this.registrationSuccess.set(successMessage);
    this.notifyRegistrationSuccess(successMessage, result.sourceWriteBack);
    return true;
  }

  // ---------------------------------------------------------
  // LABELS
  // ---------------------------------------------------------

  homeName(homeId: string): string {
    return this.shelterHomeService.getHomeById(homeId)?.name ?? 'Unknown Home';
  }

  homeCode(homeId: string): string {
    return this.shelterHomeService.getHomeById(homeId)?.homeCode ?? '—';
  }

  levelLabel(participant: Participant): string {
    return this.participantService.levelLabel(participant.level);
  }

  genderLabel(gender: Participant['gender']): string {
    return gender === 'MALE' ? 'Male' : 'Female';
  }

  modeLabel(mode: EventMode): string {
    return mode === 'SOLO' ? 'Individual' : 'Group';
  }

  /** Human event name; never the raw event id. */
  eventName(eventId: string, registration?: ParticipantEvent): string {
    return registration?.eventName
      ?? this.eventService.getById(eventId)?.name
      ?? 'the event';
  }

  /** Source and import information the backend supplies for the record. */
  sourceLabel(participant: Participant): string {
    const source = participant.sourceVersionId ? 'Imported' : 'Manual';
    const row = participant.sourceRowNumber
      ? ` · Sheet row ${participant.sourceRowNumber}`
      : '';

    return `${source}${row}`;
  }

  /**
   * Import reference for the record. The import version id is an internal key,
   * so it is shown abbreviated rather than printed in full.
   */
  sourceVersionLabel(participant: Participant): string {
    const sourceVersionId = participant.sourceVersionId;

    if (!sourceVersionId) {
      return 'Not sheet imported';
    }

    return sourceVersionId.length > 14
      ? `${sourceVersionId.slice(0, 8)}…${sourceVersionId.slice(-4)}`
      : sourceVersionId;
  }

  sourceRowLabel(participant: Participant): string {
    return participant.sourceRowNumber
      ? `Sheet row ${participant.sourceRowNumber}`
      : 'Not tracked';
  }

  // ---------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------

  private filteredGender(gender: Participant['gender']): number {
    return this.participants().filter(item => item.gender === gender).length;
  }

  private resetFeedback(): void {
    this.detailError.set('');
    this.saveError.set('');
    this.saveErrorCode.set('');
    this.clearSaveSuccess();
    this.registrationError.set('');
    this.registrationSuccess.set('');
    this.pendingEventId.set('');
  }

  private clearSaveSuccess(): void {
    this.saveSuccess.set('');
    this.saveVersion.set(null);
    this.saveWriteBackNote.set('');
    this.saveWriteBackDetail.set('');
    this.saveReadBackNote.set('');
  }

  private async reloadParticipant(participantId: string): Promise<void> {
    this.detailError.set('');

    const fresh = await this.participantService.loadParticipant(participantId);

    if (!fresh) {
      this.detailError.set('The backend did not return this participant. Try refreshing.');
      return;
    }

    this.participantService.replaceParticipant(fresh);
  }

  private async reloadRegistrations(participantId: string, force = true): Promise<void> {
    this.registrationsLoading.set(true);
    this.registrationsError.set('');

    const result = await this.participantEventService.loadParticipantEvents(
      participantId,
      force
    );

    this.registrationsLoading.set(false);

    if (result === null) {
      this.registrations.set(null);
      this.registrationsError.set('Registered events could not be read from the backend.');
      return;
    }

    this.registrations.set(result);
  }

  private describeSaveFailure(errorCode: string | undefined, errors: string[]): string {
    if (errorCode === 'VERSION_CONFLICT') {
      return 'This participant was updated elsewhere. Refresh and try again.';
    }

    if (errorCode === 'SOURCE_ROW_IDENTITY_UNVERIFIED') {
      return 'The backend could not confirm the Google Sheet row this participant came from, so the sheet was not changed. Re-run the shelter home import, refresh and try again.';
    }

    return this.describeFailure(errors);
  }

  private describeFailure(errors: string[]): string {
    return errors.length
      ? errors.join(' ')
      : 'The backend did not accept the change.';
  }
}