import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Event,
  EventCategory,
  EventMode,
  EventStatus,
  Participant,
  ParticipantLevel,
  ParticipantEvent,
  RegistrationStatus,
  Team,
  TeamValidationResult
} from '../../core/models';

import { EventService } from '../../core/services/events/event.service';
import {
  ParticipantEventService,
  RegistrationValidation
} from '../../core/services/events/participant-event.service';

import { ParticipantService } from '../../core/services/participants/participant.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { TeamService } from '../../core/services/teams/team.service';

@Component({
  selector: 'nk-events',
  imports: [FormsModule],
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
    void this.shelterData.refresh();
    void this.loadEventMaster();
  }


  private async loadEventMaster(): Promise<void> {

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

  /** True while the selected event's registrations are being read. */
  registrationsLoading =
    signal(false);

  /** The event whose registrations finished loading, or null when nothing has. */
  registrationsLoadedEventId =
    signal<string | null>(null);

  /**
   * Registrations live in the backend store. The synchronous getters on
   * ParticipantEventService only see what has been read, so the drawer treats
   * "not read yet" and "read and empty" as two different states.
   */
  readonly registrationsReady =
    computed(() => {

      const event =
        this.selectedEvent();

      return (
        !!event &&
        this.registrationsLoadedEventId() === event.id
      );
    });


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
   * cancelled or waitlisted, paired with the participant record the backend
   * holds for it.
   */
  readonly registeredParticipants =
    computed(() =>
      this.eventRegistrations().map(registration => {

        const participant =
          this.participantService
            .getParticipantById(
              registration.participantId
            );

        return {
          registration,
          name:
            participant?.fullName ??
            'Unknown participant',
          code:
            participant?.participantCode ??
            '—',
          homeName:
            participant
              ? this.getHomeName(
                  participant.shelterHomeId
                )
              : 'Unknown Home',
          levelText:
            participant?.level
              ? this.levelLabel(participant.level)
              : 'No level',
          initial:
            participant
              ? participant.fullName
                  .charAt(0)
                  .toUpperCase()
              : '?'
        };
      })
    );


  readonly registeredCount =
    computed(() =>
      this.eventRegistrations().length
    );


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

  registrationNotice =
    signal('');

  registrationErrors =
    signal<string[]>([]);

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

    this.registrationsLoadedEventId.set(null);

    void this.loadRegistrations(event.id);
  }


  private async loadRegistrations(
    eventId: string,
    force = false
  ): Promise<void> {

    if (this.selectedEvent()?.id === eventId) {
      this.registrationsLoading.set(true);

      this.registrationErrors.set([]);
    }

    const registrations =
      await this.participantEventService
        .loadEventRegistrations(eventId, force);

    // A newer selection owns the loading and ready flags from here on.
    if (this.selectedEvent()?.id !== eventId) {
      return;
    }

    this.registrationsLoading.set(false);

    this.registrationsLoadedEventId.set(eventId);

    if (registrations === null) {
      this.registrationErrors.set([
        'Registrations could not be read from the backend. Please try again.'
      ]);
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

    this.registrationNotice.set('');

    this.showParticipantsDrawer.set(true);
  }


  closeParticipants(): void {

    this.showParticipantsDrawer.set(false);

    this.showAddParticipant.set(false);

    this.selectedEvent.set(null);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.registrationNotice.set('');

    this.registrationErrors.set([]);

    this.registrationsLoadedEventId.set(null);
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

    this.registrationNotice.set('');

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

    this.registrationNotice.set('');

    this.registrationErrors.set([]);

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

    this.registrationErrors.set([]);

    this.registrationNotice.set('');

    try {

      const result =
        await this.participantEventService
          .registerParticipant(
            participantId,
            event.id
          );

      // The service re-reads this event's registrations after the write, so
      // the count and the list below already reflect the backend.
      this.registrationsLoadedEventId.set(
        event.id
      );

      if (!result.success) {
        this.registrationErrors.set(
          this.reportErrors(result.errors)
        );
        return;
      }

      this.registrationNotice.set(
        'Participant registered successfully.'
      );

      this.selectedParticipantId.set('');

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

    this.registrationErrors.set([]);

    this.registrationNotice.set('');

    try {

      const result =
        await this.participantEventService
          .cancelRegistration(
            registration.participantId,
            registration.eventId
          );

      this.registrationsLoadedEventId.set(
        registration.eventId
      );

      if (!result.success) {
        this.registrationErrors.set(
          this.reportErrors(result.errors)
        );
        return;
      }

      this.registrationNotice.set(
        'Registration cancelled.'
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

    this.registrationErrors.set([]);

    this.registrationNotice.set('');

    try {

      const result =
        await this.participantEventService
          .reactivateRegistration(
            registration.participantId,
            registration.eventId
          );

      this.registrationsLoadedEventId.set(
        registration.eventId
      );

      if (!result.success) {
        this.registrationErrors.set(
          this.reportErrors(result.errors)
        );
        return;
      }

      this.registrationNotice.set(
        'Registration reactivated.'
      );

    } finally {
      this.registrationBusy.set(null);
    }
  }


  private reportErrors(
    errors: string[]
  ): string[] {

    return errors.length > 0
      ? errors
      : [
          'The request could not be completed. Please try again.'
        ];
  }


  // =========================================================
  // TEAM MANAGEMENT
  // =========================================================

  selectedTeamEvent =
    signal<Event | null>(null);

  selectedTeam =
    signal<Team | null>(null);

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

  teamValidation =
    signal<TeamValidationResult | null>(null);

  teamSuccessMessage =
    signal('');

  teamFormError =
    signal('');

  readonly teamsForSelectedEvent = computed(() => {

    const event = this.selectedTeamEvent();

    if (!event) {
      return [];
    }

    return this.teamService
      .teams$()
      .filter(team => team.eventId === event.id);
  });

  readonly teamRegisteredCount = computed(() => {

    const event = this.selectedTeamEvent();

    if (!event) {
      return 0;
    }

    return this.participantEventService
      .registrations$()
      .filter(item => item.eventId === event.id)
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
    this.selectedTeam.set(null);
    this.showCreateTeam.set(false);
    this.showTeamMembers.set(false);
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
    this.teamSuccessMessage.set('');
    this.teamFormError.set('');

    // Team candidates and the registered count read the same registration
    // cache as the participants drawer.
    void this.loadRegistrations(event.id);

    this.showTeamsDrawer.set(true);
  }


  closeTeams(): void {
    this.showTeamsDrawer.set(false);
    this.selectedTeamEvent.set(null);
    this.selectedTeam.set(null);
    this.showCreateTeam.set(false);
    this.showTeamMembers.set(false);
    this.showAddTeamMember.set(false);
    this.teamName = '';
    this.teamValidation.set(null);
    this.teamSuccessMessage.set('');
    this.teamFormError.set('');
  }


  openCreateTeam(): void {
    this.teamName = '';
    this.teamValidation.set(null);
    this.teamSuccessMessage.set('');
    this.teamFormError.set('');
    this.showCreateTeam.set(true);
  }


  closeCreateTeam(): void {
    this.showCreateTeam.set(false);
    this.teamName = '';
    this.teamFormError.set('');
  }


  createTeam(): void {

    const event = this.selectedTeamEvent();

    if (!event) {
      return;
    }

    if (!this.teamName.trim()) {
      this.teamFormError.set('Team name is required.');
      return;
    }

    const result = this.teamService.createTeam(
      event.id,
      this.teamName,
      'ADMIN'
    );

    this.teamValidation.set(result);

    if (!result.valid || !result.team) {
      return;
    }

    this.teamSuccessMessage.set(`${result.team.name} has been created.`);
    this.selectedTeam.set(result.team);
    this.showCreateTeam.set(false);
    this.showTeamMembers.set(true);
    this.teamName = '';
  }


  viewTeamMembers(team: Team): void {
    this.selectedTeam.set(team);
    this.showTeamMembers.set(true);
    this.showAddTeamMember.set(false);
    this.teamValidation.set(null);
    this.teamSuccessMessage.set('');
    this.teamFormError.set('');
  }


  closeTeamMembers(): void {
    this.selectedTeam.set(null);
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
    this.teamSuccessMessage.set('');
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


  addTeamMember(participantId: string): void {

    const team = this.selectedTeam();

    if (!team) {
      return;
    }

    const result = this.teamService.addMember(
      team.id,
      participantId,
      'ADMIN'
    );

    this.teamValidation.set(result);

    if (!result.valid) {
      return;
    }

    this.teamSuccessMessage.set('Participant has been added to the team.');
    this.showAddTeamMember.set(false);
  }


  removeTeamMember(participantId: string): void {

    const team = this.selectedTeam();

    if (!team) {
      return;
    }

    const result = this.teamService.removeMember(
      team.id,
      participantId,
      'ADMIN'
    );

    this.teamValidation.set(result);

    if (result.valid) {
      this.teamSuccessMessage.set('Participant has been removed from the team. Revalidate before marking it ready.');
    }
  }


  validateTeam(team: Team): void {
    const result = this.teamService.validateTeam(team.id);

    this.teamValidation.set(result);
    this.teamSuccessMessage.set(
      result.valid ? `${team.name} is valid and ready for review.` : ''
    );
  }


  markTeamReady(team: Team): void {
    const result = this.teamService.markReady(team.id, 'ADMIN');

    this.teamValidation.set(result);

    if (result.valid) {
      this.teamSuccessMessage.set(`${team.name} is ready.`);
    }
  }


  lockTeam(team: Team): void {
    const result = this.teamService.lockTeam(team.id, 'ADMIN');

    this.teamValidation.set(result);

    if (result.valid) {
      this.teamSuccessMessage.set(`${team.name} has been locked.`);
    }
  }


  cancelTeam(team: Team): void {
    const result = this.teamService.cancelTeam(team.id, 'ADMIN');

    this.teamValidation.set(result);

    if (result.valid) {
      this.teamSuccessMessage.set(`${team.name} has been cancelled.`);

      if (this.selectedTeam()?.id === team.id) {
        this.closeTeamMembers();
      }
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
