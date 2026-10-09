import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import {
  Event,
  EventCategory,
  EventMode,
  EventStatus,
  Participant,
  ParticipantLevel,
  ParticipantEvent,
  RegistrationStatus,
  SourceWriteBackResult,
  Team,
  TeamValidationResult
} from '../../core/models';

import { EventService } from '../../core/services/events/event.service';
import {
  ParticipantEventService,
  RegistrationValidation
} from '../../core/services/events/participant-event.service';

import { NotificationService } from '../../core/services/notifications/notification.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import {
  TeamLoadState,
  TeamService
} from '../../core/services/teams/team.service';

type RegistrationLoadStatus = 'LOADING' | 'LOADED' | 'ERROR';

@Component({
  selector: 'nk-events',
  imports: [FormsModule, RouterLink],
  templateUrl: './events.html'
})
export class Events implements OnInit {

  // =========================================================
  // SERVICES
  // =========================================================

  private readonly eventService =
    inject(EventService);

  private readonly participantEventService =
    inject(ParticipantEventService);

  private readonly participantService =
    inject(ParticipantService);

  private readonly shelterHomeService =
    inject(ShelterHomeService);

  private readonly teamService =
    inject(TeamService);

  private readonly shelterData =
    inject(ShelterDataService);

  private readonly notifications =
    inject(NotificationService);

  private readonly route =
    inject(ActivatedRoute);


  /**
   * The event master is read-only from here: it is owned by the backend and
   * there is no frontend write path, so the page never fabricates an event.
   */
  readonly events =
    this.eventService.events$;

  private readonly eventBootstrapPending =
    signal(false);

  readonly eventsLoading =
    computed(() =>
      this.eventBootstrapPending() ||
      this.eventService.loading()
    );

  readonly eventsLoaded =
    this.eventService.loaded;

  readonly eventsError =
    this.eventService.loadError;


  // =========================================================
  // LIFECYCLE
  // =========================================================

  /**
   * Shelter homes, participants, events and registrations all come from the one
   * backend store, so a single refresh fills every list this page renders.
   */
  ngOnInit(): void {

    // Deep link in: /events?eventId=<id> expands that event's card once the
    // event master has loaded.
    const deepLinkEventId =
      this.route.snapshot.queryParamMap.get('eventId') ?? undefined;

    void this.shelterData.ensureLoaded();

    void this.loadEventMaster(deepLinkEventId);
  }


  private async loadEventMaster(
    deepLinkEventId?: string
  ): Promise<void> {

    this.eventBootstrapPending.set(true);

    await this.eventService.load();

    this.eventBootstrapPending.set(false);

    // Nothing preselects an event on this route today, but if a selection is
    // already in place its registrations must be read before the first render
    // of the drawer.
    const preselected =
      this.selectedEvent();

    if (preselected) {
      await this.loadRegistrations(preselected.id);
    }

    // A deep-linked event card opens as soon as the master contains the event.
    if (deepLinkEventId) {

      const target = this.events().find(
        event => event.id === deepLinkEventId
      );

      if (target) {
        this.expandCard(target);
      }
    }
  }


  // =========================================================
  // FILTERS
  // =========================================================

  readonly searchTerm =
    signal('');

  readonly categoryFilter =
    signal<EventCategory | 'ALL'>('ALL');

  readonly modeFilter =
    signal<EventMode | 'ALL'>('ALL');

  readonly statusFilter =
    signal<EventStatus | 'ALL'>('ACTIVE');


  readonly filteredEvents = computed(() => {

    const search =
      this.searchTerm().trim().toLowerCase();

    const category =
      this.categoryFilter();

    const mode =
      this.modeFilter();

    const status =
      this.statusFilter();

    return this.events().filter(event => {

      const matchesSearch =
        !search ||
        event.name.toLowerCase().includes(search) ||
        event.eventCode.toLowerCase().includes(search);

      const matchesCategory =
        category === 'ALL' ||
        event.category === category;

      const matchesMode =
        mode === 'ALL' ||
        event.mode === mode;

      const matchesStatus =
        status === 'ALL' ||
        event.status === status;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesMode &&
        matchesStatus
      );
    });
  });


  readonly totalEvents = computed(() =>
    this.events().length
  );

  /**
   * Events grouped under the canonical ARTS / LITERARY / CULTURAL sections.
   * Groups with no matching events are omitted; the existing search, category,
   * mode and status filters all still apply.
   */
  readonly groupedEvents = computed(() => {
    const order: readonly EventCategory[] = ['ARTS', 'LITERARY', 'CULTURAL'];

    return order
      .map(category => ({
        category,
        events: this.filteredEvents().filter(event => event.category === category),
      }))
      .filter(group => group.events.length > 0);
  });

  /**
   * Collapsed-card label for the backend's eligible levels; an event with no
   * levels configured renders an em dash, never an invented list.
   */
  eligibleLevelsLabel(event: Event): string {
    if (!event.eligibleLevels.length) {
      return '—';
    }

    return event.eligibleLevels.map(level => this.levelLabel(level)).join(', ');
  }

  readonly activeEvents = computed(() =>
    this.events().filter(
      event => event.status === 'ACTIVE'
    ).length
  );

  readonly groupEvents = computed(() =>
    this.events().filter(
      event => event.mode === 'GROUP'
    ).length
  );

  readonly soloEvents = computed(() =>
    this.events().filter(
      event => event.mode === 'SOLO'
    ).length
  );


  // =========================================================
  // EVENT FILTERS
  // =========================================================

  setSearch(value: string): void {
    this.searchTerm.set(value);
  }

  setCategory(value: string): void {
    this.categoryFilter.set(
      value as EventCategory | 'ALL'
    );
  }

  setMode(value: string): void {
    this.modeFilter.set(
      value as EventMode | 'ALL'
    );
  }

  setStatus(value: string): void {
    this.statusFilter.set(
      value as EventStatus | 'ALL'
    );
  }


  // =========================================================
  // EVENT PARTICIPANTS DRAWER
  // =========================================================

  selectedEvent =
    signal<Event | null>(null);

  showParticipantsDrawer =
    signal(false);


  // =========================================================
  // PARTICIPANT DRAWER FILTERS
  // =========================================================

  participantSearch =
    signal('');

  participantHomeFilter =
    signal<string>('ALL');


  readonly participants =
    this.participantService.participants$;

  readonly homes =
    this.shelterHomeService.homes$;


  // =========================================================
  // REGISTERED PARTICIPANTS
  // =========================================================

  /**
   * Per-event outcome of the latest registration read. Registrations live in
   * the backend store and the synchronous getters on ParticipantEventService
   * only see what has been read, so "not read yet", "read and empty" and
   * "read failed" are kept as distinct states.
   */
  private readonly registrationLoadStates =
    signal<Record<string, RegistrationLoadStatus>>({});

  registrationLoadStatus(
    eventId: string | undefined
  ): RegistrationLoadStatus | null {

    return eventId
      ? this.registrationLoadStates()[eventId] ?? null
      : null;
  }

  /** True while the selected event's registrations are being read. */
  readonly registrationsLoading =
    computed(() =>
      this.registrationLoadStatus(this.selectedEvent()?.id) === 'LOADING'
    );

  readonly registrationsReady =
    computed(() =>
      this.registrationLoadStatus(this.selectedEvent()?.id) === 'LOADED'
    );

  readonly registrationsFailed =
    computed(() =>
      this.registrationLoadStatus(this.selectedEvent()?.id) === 'ERROR'
    );


  readonly eventRegistrations =
    computed(() => {

      const event =
        this.selectedEvent();

      if (!event) {
        return [];
      }

      return this.participantEventService
        .registrations$()
        .filter(registration =>
          registration.eventId === event.id
        );
    });


  /**
   * Every persisted registration for the selected event, whether registered,
   * cancelled or waitlisted. Active registrations are listed first.
   *
   * Display data is taken from the registration row first, because the backend
   * may inline it, and only then from the cached participant record. A row is
   * never dropped for lack of a cached participant.
   */
  readonly registeredParticipants =
    computed(() =>
      [
        ...this.eventRegistrations().filter(
          registration => registration.registrationStatus === 'REGISTERED'
        ),
        ...this.eventRegistrations().filter(
          registration => registration.registrationStatus !== 'REGISTERED'
        )
      ].map(registration => {

        const participant =
          this.participantService
            .getParticipantById(
              registration.participantId
            );

        const name =
          registration.participantName ??
          participant?.fullName ??
          'Unknown participant';

        const shelterHomeId =
          registration.shelterHomeId ??
          participant?.shelterHomeId;

        const level = registration.level ?? participant?.level;

        return {
          registration,
          name,
          code:
            registration.participantCode ??
            participant?.participantCode ??
            '—',
          homeName: shelterHomeId
            ? this.getHomeName(shelterHomeId)
            : 'Unknown Home',
          levelText: level
            ? this.levelLabel(level)
            : 'No level',
          initial:
            name.charAt(0).toUpperCase() || '?'
        };
      })
    );


  /** Active registrations only; cancelled and waitlisted rows are not counted. */
  readonly registeredCount =
    computed(() =>
      this.eventRegistrations().filter(
        registration => registration.registrationStatus === 'REGISTERED'
      ).length
    );


  // =========================================================
  // COLLAPSIBLE EVENT CARDS
  // =========================================================

  /** Only one card is expanded at a time; null means every card is collapsed. */
  expandedEventId =
    signal<string | null>(null);


  toggleCard(event: Event): void {

    if (this.expandedEventId() === event.id) {
      this.expandedEventId.set(null);
      return;
    }

    this.expandCard(event);
  }


  private expandCard(event: Event): void {

    this.expandedEventId.set(event.id);

    this.ensureRegistrationsLoaded(event.id);
  }


  /**
   * Reads an event's registrations the first time its card opens and again
   * after a failed read; a successful read is never re-fetched on expand and
   * registrations for closed cards are never preloaded.
   */
  private ensureRegistrationsLoaded(
    eventId: string
  ): void {

    const status =
      this.registrationLoadStatus(eventId);

    if (status === 'LOADING' || status === 'LOADED') {
      return;
    }

    void this.loadRegistrations(eventId, status === 'ERROR');
  }


  /** Active registrations for one event; the count shown on the card header. */
  activeRegistrationCount(
    eventId: string
  ): number {

    return this.participantEventService
      .registrations$()
      .filter(registration =>
        registration.eventId === eventId &&
        registration.registrationStatus === 'REGISTERED'
      ).length;
  }


  /**
   * Participants for the expanded card's table — every registration row the
   * backend returned, each carrying its registration status; the header count
   * stays REGISTERED-only (`activeRegistrationCount`). Display data comes from
   * the registration row first, then the cached participant record; a row is
   * never dropped for lack of a cached participant.
   */
  cardParticipants(
    eventId: string
  ) {

    return this.participantEventService
      .registrations$()
      .filter(registration => registration.eventId === eventId)
      .map(registration => {

        const participant =
          this.shelterData
            .participants()
            .find(item => item.id === registration.participantId);

        const level =
          registration.level ?? participant?.level;

        const homeName =
          participant?.shelterHomeId
            ? this.shelterData
                .getHomeById(participant.shelterHomeId)?.homeName ?? '—'
            : '—';

        return {
          registration,
          status: registration.registrationStatus,
          name:
            registration.participantName ??
            participant?.fullName ??
            'Unknown participant',
          age: registration.age ?? participant?.age,
          standard: registration.standard ?? participant?.standard,
          levelText: level ? this.levelLabel(level) : '—',
          homeName
        };
      });
  }


  retryCardRegistrations(eventId: string): void {
    void this.loadRegistrations(eventId, true);
  }


  // =========================================================
  // ADD PARTICIPANT STATE
  // =========================================================

  showAddParticipant =
    signal(false);

  selectedParticipantId =
    signal('');

  registrationValidation =
    signal<RegistrationValidation | null>(
      null
    );

  /** Identifies the in-flight write so double clicks cannot submit twice. */
  registrationBusy =
    signal<string | null>(null);


  // =========================================================
  // EVENT SELECTION
  // =========================================================

  /**
   * Makes an event the active selection and reads its registrations from the
   * backend. Without this the counts and the drawer read an empty cache.
   */
  selectEvent(event: Event): void {

    this.selectedEvent.set(event);

    void this.loadRegistrations(event.id);
  }


  /**
   * Reads one event's registrations and records whether the read succeeded,
   * so a failed request is never rendered as an empty list or a zero count.
   */
  private async loadRegistrations(
    eventId: string,
    force = false
  ): Promise<void> {

    this.setRegistrationLoadStatus(eventId, 'LOADING');

    const registrations =
      await this.participantEventService
        .loadEventRegistrations(eventId, force);

    this.setRegistrationLoadStatus(
      eventId,
      registrations === null ? 'ERROR' : 'LOADED'
    );
  }


  private setRegistrationLoadStatus(
    eventId: string,
    status: RegistrationLoadStatus
  ): void {

    this.registrationLoadStates.update(current => ({
      ...current,
      [eventId]: status
    }));
  }


  retryRegistrations(): void {

    const event =
      this.selectedEvent();

    if (event) {
      void this.loadRegistrations(event.id, true);
    }
  }


  // =========================================================
  // PARTICIPANT DRAWER
  // =========================================================

  openParticipants(
    event: Event
  ): void {

    this.selectEvent(event);

    this.participantSearch.set('');

    this.participantHomeFilter.set('ALL');

    this.showAddParticipant.set(false);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.showParticipantsDrawer.set(true);
  }


  closeParticipants(): void {

    this.showParticipantsDrawer.set(false);

    this.showAddParticipant.set(false);

    this.selectedEvent.set(null);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);
  }


  // =========================================================
  // PARTICIPANT FILTERS
  // =========================================================

  setParticipantSearch(
    value: string
  ): void {

    this.participantSearch.set(value);
  }


  setParticipantHome(
    value: string
  ): void {

    this.participantHomeFilter.set(value);
  }


  // =========================================================
  // AVAILABLE PARTICIPANTS
  // =========================================================

  readonly availableParticipants =
    computed(() => {

      const search =
        this.participantSearch()
          .trim()
          .toLowerCase();

      const homeId =
        this.participantHomeFilter();

      const event =
        this.selectedEvent();

      if (!event) {
        return [];
      }

      return this.participants()
        .filter(participant => {

          // Search
          const matchesSearch =
            !search ||
            participant.fullName
              .toLowerCase()
              .includes(search) ||
            participant.participantCode
              .toLowerCase()
              .includes(search);

          // Home
          const matchesHome =
            homeId === 'ALL' ||
            participant.shelterHomeId === homeId;

          // Duplicate
          const alreadyRegistered =
            this.participantEventService
              .isAlreadyRegistered(
                participant.id,
                event.id
              );

          return (
            matchesSearch &&
            matchesHome &&
            !alreadyRegistered
          );
        });
    });


  // =========================================================
  // ADD PARTICIPANT
  // =========================================================

  openAddParticipant(): void {

    const event =
      this.selectedEvent();

    if (!event) {
      return;
    }

    if (event.status !== 'ACTIVE') {
      return;
    }

    // Candidate eligibility depends on the registration cache, so the panel
    // only opens once the event's registrations are actually in hand.
    if (!this.registrationsReady()) {
      return;
    }

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.showAddParticipant.set(true);
  }


  closeAddParticipant(): void {

    this.showAddParticipant.set(false);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);
  }


  setSelectedParticipant(
    participantId: string
  ): void {

    this.selectedParticipantId.set(
      participantId
    );

    this.registrationValidation.set(null);

    const event =
      this.selectedEvent();

    if (!event || !participantId) {
      return;
    }

    const validation =
      this.participantEventService
        .validateRegistration(
          participantId,
          event.id
        );

    this.registrationValidation.set(
      validation
    );
  }


  // =========================================================
  // REGISTER
  // =========================================================

  async registerSelectedParticipant(): Promise<void> {

    const event =
      this.selectedEvent();

    const participantId =
      this.selectedParticipantId();

    if (!event || !participantId) {
      return;
    }

    if (this.registrationBusy()) {
      return;
    }

    this.registrationBusy.set(
      `register:${participantId}`
    );

    try {

      // The service re-reads this event's registrations after the write, so
      // the count and the list below reflect the backend.
      const result =
        await this.participantEventService
          .registerParticipant(
            participantId,
            event.id
          );

      if (!result.success) {
        this.reportFailure(
          'Participant could not be registered.',
          result.errors
        );
        return;
      }

      this.reportRegistrationSuccess(
        'Participant registered.',
        result.sourceWriteBack
      );

      this.selectedParticipantId.set('');

      this.registrationValidation.set(null);

      // Close add mode after successful registration
      this.showAddParticipant.set(false);

    } finally {
      this.registrationBusy.set(null);
    }
  }


  // =========================================================
  // CANCEL REGISTRATION
  // =========================================================

  async cancelRegistration(
    registration: ParticipantEvent
  ): Promise<void> {

    if (this.registrationBusy()) {
      return;
    }

    this.registrationBusy.set(
      `cancel:${registration.id}`
    );

    try {

      const result =
        await this.participantEventService
          .cancelRegistration(
            registration.participantId,
            registration.eventId
          );

      if (!result.success) {
        this.reportFailure(
          'Registration could not be cancelled.',
          result.errors
        );
        return;
      }

      this.reportRegistrationSuccess(
        'Registration cancelled.',
        result.sourceWriteBack
      );

    } finally {
      this.registrationBusy.set(null);
    }
  }


  // =========================================================
  // REACTIVATE REGISTRATION
  // =========================================================

  async reactivateRegistration(
    registration: ParticipantEvent
  ): Promise<void> {

    if (this.registrationBusy()) {
      return;
    }

    this.registrationBusy.set(
      `reactivate:${registration.id}`
    );

    try {

      const result =
        await this.participantEventService
          .reactivateRegistration(
            registration.participantId,
            registration.eventId
          );

      if (!result.success) {
        this.reportFailure(
          'Registration could not be reactivated.',
          result.errors
        );
        return;
      }

      this.reportRegistrationSuccess(
        'Registration reactivated.',
        result.sourceWriteBack
      );

    } finally {
      this.registrationBusy.set(null);
    }
  }


  /**
   * Reports a successful registration write together with exactly what the
   * backend said about the Google Sheet. Nothing is claimed about the sheet
   * when the backend did not report on it.
   */
  private reportRegistrationSuccess(
    message: string,
    writeBack: SourceWriteBackResult | undefined
  ): void {

    if (!writeBack) {
      this.notifications.success(message);
      return;
    }

    switch (writeBack.status) {

      case 'UPDATED':
        this.notifications.success(
          message,
          'Google Sheet updated.'
        );
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
          writeBack.message?.trim() ||
            'Registration updated in Nakshatra, but the Google Sheet could not be updated.'
        );
        return;

      case 'UNVERIFIED':
        this.notifications.warning(
          message,
          writeBack.message?.trim() ||
            'Registration updated in Nakshatra, but the Google Sheet update could not be confirmed.'
        );
        return;
    }
  }


  private reportFailure(
    message: string,
    errors: string[]
  ): void {

    this.notifications.error(
      message,
      errors.length > 0
        ? errors.join(' ')
        : 'The request could not be completed. Please try again.'
    );
  }


  // =========================================================
  // TEAM MANAGEMENT
  // =========================================================

  selectedTeamEvent =
    signal<Event | null>(null);

  /** The open team is tracked by id so it always reflects the backend cache. */
  private readonly selectedTeamId =
    signal<string | null>(null);

  readonly selectedTeam = computed(() => {

    const teamId = this.selectedTeamId();

    return teamId
      ? this.teamService.getById(teamId) ?? null
      : null;
  });

  showTeamsDrawer =
    signal(false);

  showCreateTeam =
    signal(false);

  showTeamMembers =
    signal(false);

  showAddTeamMember =
    signal(false);

  teamName = '';

  teamParticipantSearch =
    signal('');

  teamParticipantHomeFilter =
    signal('ALL');

  /** Result of the local, non-persisting team rule check. */
  teamValidation =
    signal<TeamValidationResult | null>(null);

  teamFormError =
    signal('');

  /** Identifies the in-flight team write so double clicks cannot submit twice. */
  teamBusy =
    signal<string | null>(null);

  readonly teamsLoadState = computed<TeamLoadState>(() => {

    const event = this.selectedTeamEvent();

    return event
      ? this.teamService.loadState(event.id)
      : { status: 'IDLE', error: '' };
  });

  readonly teamsForSelectedEvent = computed(() => {

    const event = this.selectedTeamEvent();

    if (!event) {
      return [];
    }

    return this.teamService
      .teams$()
      .filter(team => team.eventId === event.id);
  });

  /**
   * The team list is rendered from the backend cache once it has been read.
   * During a refresh after a write the previous backend result stays visible.
   */
  readonly teamsListVisible = computed(() => {

    const status = this.teamsLoadState().status;

    return (
      status === 'LOADED' ||
      (status === 'LOADING' && this.teamsForSelectedEvent().length > 0)
    );
  });

  readonly teamRegistrationStatus = computed(() =>
    this.registrationLoadStatus(this.selectedTeamEvent()?.id)
  );

  /** Active registrations only, matching the participants drawer. */
  readonly teamRegisteredCount = computed(() => {

    const event = this.selectedTeamEvent();

    if (!event) {
      return 0;
    }

    return this.participantEventService
      .registrations$()
      .filter(item =>
        item.eventId === event.id &&
        item.registrationStatus === 'REGISTERED'
      )
      .length;
  });

  readonly selectedTeamMembers = computed(() => {

    const team =
      this.selectedTeam();

    if (!team) {
      return [];
    }

    return this.teamService
      .getMembers(team.id)
      .map(member => this.participantService.getParticipantById(member.participantId))
      .filter((participant): participant is Participant => !!participant);
  });

  readonly teamCandidates = computed(() => {

    const event = this.selectedTeamEvent();
    const team = this.selectedTeam();

    if (!event || !team) {
      return [];
    }

    const search = this.teamParticipantSearch().trim().toLowerCase();
    const homeId = this.teamParticipantHomeFilter();

    return this.participants()
      .filter(participant => {

        const matchesSearch =
          !search ||
          participant.fullName.toLowerCase().includes(search) ||
          participant.participantCode.toLowerCase().includes(search);

        const matchesHome =
          homeId === 'ALL' || participant.shelterHomeId === homeId;

        return matchesSearch && matchesHome;
      })
      .map(participant => ({
        participant,
        isRegistered: this.participantEventService.isAlreadyRegistered(
          participant.id,
          event.id
        ),
        isEligible:
          participant.eligibilityStatus === 'ELIGIBLE' &&
          !!participant.level &&
          event.eligibleLevels.includes(participant.level),
        assignedTeam: this.teamService.getParticipantTeam(
          participant.id,
          event.id
        )
      }));
  });


  openTeams(event: Event): void {

    if (event.mode !== 'GROUP') {
      return;
    }

    this.selectedTeamEvent.set(event);
    this.selectedTeamId.set(null);
    this.showCreateTeam.set(false);
    this.showTeamMembers.set(false);
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
    this.teamFormError.set('');

    this.showTeamsDrawer.set(true);

    // Persisted teams and the registrations that team candidates depend on
    // are both read from the backend; failures surface through load state.
    void this.teamService.loadTeams(event.id);
    void this.loadRegistrations(event.id);
  }


  async retryLoadTeams(): Promise<void> {

    const event = this.selectedTeamEvent();

    if (!event) {
      return;
    }

    await this.teamService.loadTeams(event.id, true);
  }


  retryTeamRegistrations(): void {

    const event = this.selectedTeamEvent();

    if (event) {
      void this.loadRegistrations(event.id, true);
    }
  }


  closeTeams(): void {
    this.showTeamsDrawer.set(false);
    this.selectedTeamEvent.set(null);
    this.selectedTeamId.set(null);
    this.showCreateTeam.set(false);
    this.showTeamMembers.set(false);
    this.showAddTeamMember.set(false);
    this.teamName = '';
    this.teamValidation.set(null);
    this.teamFormError.set('');
  }


  openCreateTeam(): void {
    this.teamName = '';
    this.teamValidation.set(null);
    this.teamFormError.set('');
    this.showCreateTeam.set(true);
  }


  closeCreateTeam(): void {
    this.showCreateTeam.set(false);
    this.teamName = '';
    this.teamFormError.set('');
  }


  async createTeam(): Promise<void> {

    const event = this.selectedTeamEvent();

    if (!event || this.teamBusy()) {
      return;
    }

    if (!this.teamName.trim()) {
      this.teamFormError.set('Team name is required.');
      return;
    }

    this.teamFormError.set('');
    this.teamValidation.set(null);
    this.teamBusy.set('create');

    try {

      const result = await this.teamService.createTeam(
        event.id,
        this.teamName
      );

      if (!result.success) {
        this.reportFailure('Team could not be created.', result.errors);
        return;
      }

      this.notifications.success(
        result.team
          ? `${result.team.name} has been created.`
          : 'Team has been created.'
      );

      this.showCreateTeam.set(false);
      this.teamName = '';

      if (result.team) {
        this.selectedTeamId.set(result.team.id);
        this.showTeamMembers.set(true);
      }

    } finally {
      this.teamBusy.set(null);
    }
  }


  viewTeamMembers(team: Team): void {
    this.selectedTeamId.set(team.id);
    this.showTeamMembers.set(true);
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
    this.teamFormError.set('');
  }


  closeTeamMembers(): void {
    this.selectedTeamId.set(null);
    this.showTeamMembers.set(false);
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
    this.teamFormError.set('');
  }


  openAddTeamMember(): void {
    const team = this.selectedTeam();

    if (!team || !this.canModifyTeam(team)) {
      return;
    }

    this.teamParticipantSearch.set('');
    this.teamParticipantHomeFilter.set('ALL');
    this.teamValidation.set(null);
    this.showAddTeamMember.set(true);
  }


  closeAddTeamMember(): void {
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
  }


  setTeamParticipantSearch(value: string): void {
    this.teamParticipantSearch.set(value);
  }


  setTeamParticipantHome(value: string): void {
    this.teamParticipantHomeFilter.set(value);
  }


  async addTeamMember(participantId: string): Promise<void> {

    const team = this.selectedTeam();

    if (!team || this.teamBusy()) {
      return;
    }

    this.teamValidation.set(null);
    this.teamBusy.set(`add:${participantId}`);

    try {

      const result = await this.teamService.addMember(
        team.id,
        participantId
      );

      if (!result.success) {
        this.reportFailure('Participant could not be added to the team.', result.errors);
        return;
      }

      this.notifications.success('Participant has been added to the team.');
      this.showAddTeamMember.set(false);

    } finally {
      this.teamBusy.set(null);
    }
  }


  async removeTeamMember(participantId: string): Promise<void> {

    const team = this.selectedTeam();

    if (!team || this.teamBusy()) {
      return;
    }

    this.teamValidation.set(null);
    this.teamBusy.set(`remove:${participantId}`);

    try {

      const result = await this.teamService.removeMember(
        team.id,
        participantId
      );

      if (!result.success) {
        this.reportFailure('Participant could not be removed from the team.', result.errors);
        return;
      }

      this.notifications.success('Participant has been removed from the team.');

    } finally {
      this.teamBusy.set(null);
    }
  }


  /**
   * Runs the local team rules against the backend data in hand. This is a
   * check only; it does not change the team's persisted status.
   */
  validateTeam(team: Team): void {
    const result = this.teamService.validateTeam(team.id);

    this.teamValidation.set(result);

    if (result.valid) {
      this.notifications.info(
        `${team.name} meets the team rules.`,
        'This check does not change the team status.'
      );
    }
  }


  getTeamMemberCount(teamId: string): number {
    return this.teamService.getTeamMemberCount(teamId);
  }


  canModifyTeam(team: Team): boolean {
    return team.status !== 'LOCKED' && team.status !== 'CANCELLED';
  }


  teamStatusLabel(team: Team): string {
    return team.status.charAt(0) + team.status.slice(1).toLowerCase();
  }


  teamSizeRule(event: Event): string {

    if (
      event.minimumTeamSize === undefined &&
      event.maximumTeamSize === undefined
    ) {
      return 'Minimum and maximum team size are not configured.';
    }

    if (event.minimumTeamSize === undefined) {
      return `Maximum ${event.maximumTeamSize} participants.`;
    }

    if (event.maximumTeamSize === undefined) {
      return `Minimum ${event.minimumTeamSize} participants.`;
    }

    return `${event.minimumTeamSize}–${event.maximumTeamSize} participants.`;
  }


  // =========================================================
  // HELPERS
  // =========================================================

  getHomeName(
    shelterHomeId: string
  ): string {

    const home =
      this.shelterHomeService
        .getHomeById(
          shelterHomeId
        );

    return home?.name ??
      'Unknown Home';
  }


  levelLabel(
    level: ParticipantLevel
  ): string {

    const labels:
      Record<ParticipantLevel, string> = {

      SUB_JUNIOR:
        'Sub Juniors',

      JUNIOR:
        'Juniors',

      SENIOR:
        'Seniors',

      SUPER_SENIOR:
        'Super Seniors'
    };

    return labels[level];
  }


  categoryLabel(
    category: EventCategory
  ): string {

    const labels:
      Record<EventCategory, string> = {

      ARTS:
        'Arts',

      LITERARY:
        'Literary',

      CULTURAL:
        'Cultural'
    };

    return labels[category];
  }


  modeLabel(
    mode: EventMode
  ): string {

    return mode === 'SOLO'
      ? 'Individual'
      : 'Group';
  }


  statusLabel(
    status: EventStatus
  ): string {

    const labels:
      Record<EventStatus, string> = {

      ACTIVE:
        'Active',

      CANCELLED:
        'Cancelled',

      INACTIVE:
        'Inactive'
    };

    return labels[status];
  }


  registrationStatusLabel(
    status: RegistrationStatus
  ): string {

    const labels:
      Record<RegistrationStatus, string> = {

      REGISTERED:
        'Registered',

      CANCELLED:
        'Cancelled',

      WAITLISTED:
        'Waitlisted'
    };

    return labels[status];
  }
}

