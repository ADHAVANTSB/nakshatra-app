import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Event,
  EventCategory,
  EventMode,
  EventStatus,
  Participant,
  ParticipantLevel,
  ParticipantEvent,
  ShelterHome
} from '../../core/models';

import { EventService } from '../../core/services/events/event.service';
import {
  ParticipantEventService,
  RegistrationValidation
} from '../../core/services/events/participant-event.service';

import { ParticipantService } from '../../core/services/participants/participant.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';

@Component({
  selector: 'nk-events',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './events.html',
  styleUrl: './events.scss'
})
export class Events {

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


  // =========================================================
  // EVENT MASTER
  // =========================================================

  readonly events =
    this.eventService.events$;


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
  // EVENT FORM
  // =========================================================

  showAddForm =
    signal(false);

  editingEvent =
    signal<Event | null>(null);


  eventName = '';
  eventCode = '';

  category: EventCategory =
    'ARTS';

  mode: EventMode =
    'SOLO';

  eligibleLevels: ParticipantLevel[] = [
    'SUB_JUNIOR',
    'JUNIOR',
    'SENIOR',
    'SUPER_SENIOR'
  ];

  minimumTeamSize: number | null =
    null;

  maximumTeamSize: number | null =
    null;

  schedule = '';
  venue = '';


  readonly categories: EventCategory[] = [
    'ARTS',
    'LITERARY',
    'CULTURAL'
  ];

  readonly modes: EventMode[] = [
    'SOLO',
    'GROUP'
  ];

  readonly levels: ParticipantLevel[] = [
    'SUB_JUNIOR',
    'JUNIOR',
    'SENIOR',
    'SUPER_SENIOR'
  ];


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

  readonly eventRegistrations =
    computed(() => {

      const event =
        this.selectedEvent();

      if (!event) {
        return [];
      }

      return this.participantEventService
        .getEventRegistrations(event.id);
    });


  readonly registeredParticipants =
    computed(() => {

      const registrations =
        this.eventRegistrations();

      return registrations
        .map(registration => {

          const participant =
            this.participantService
              .getParticipantById(
                registration.participantId
              );

          return {
            registration,
            participant
          };
        })
        .filter(
          item => !!item.participant
        ) as {
          registration: ParticipantEvent;
          participant: Participant;
        }[];
    });


  readonly registeredCount =
    computed(() =>
      this.eventRegistrations().length
    );


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

  registrationSuccess =
    signal(false);


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
  // EVENT FORM
  // =========================================================

  openAddForm(): void {

    this.resetForm();

    this.editingEvent.set(null);

    this.showAddForm.set(true);
  }


  openEditForm(event: Event): void {

    this.editingEvent.set(event);

    this.eventName =
      event.name;

    this.eventCode =
      event.eventCode;

    this.category =
      event.category;

    this.mode =
      event.mode;

    this.eligibleLevels =
      [...event.eligibleLevels];

    this.minimumTeamSize =
      event.minimumTeamSize ?? null;

    this.maximumTeamSize =
      event.maximumTeamSize ?? null;

    this.schedule =
      event.schedule ?? '';

    this.venue =
      event.venue ?? '';

    this.showAddForm.set(true);
  }


  closeForm(): void {

    this.showAddForm.set(false);

    this.editingEvent.set(null);

    this.resetForm();
  }


  saveEvent(): void {

    if (!this.eventName.trim()) {
      return;
    }

    if (!this.eventCode.trim()) {
      return;
    }

    if (this.eligibleLevels.length === 0) {
      return;
    }

    const existing =
      this.editingEvent();


    if (existing) {

      this.eventService.updateEvent(
        existing.id,
        {
          eventCode:
            this.eventCode.trim(),

          name:
            this.eventName.trim(),

          category:
            this.category,

          mode:
            this.mode,

          eligibleLevels:
            [...this.eligibleLevels],

          minimumTeamSize:
            this.minimumTeamSize ??
            undefined,

          maximumTeamSize:
            this.maximumTeamSize ??
            undefined,

          schedule:
            this.schedule.trim() ||
            undefined,

          venue:
            this.venue.trim() ||
            undefined
        }
      );

    } else {

      this.eventService.addEvent(
        {
          eventCode:
            this.eventCode.trim(),

          name:
            this.eventName.trim(),

          category:
            this.category,

          mode:
            this.mode,

          eligibleLevels:
            [...this.eligibleLevels],

          minimumTeamSize:
            this.minimumTeamSize ??
            undefined,

          maximumTeamSize:
            this.maximumTeamSize ??
            undefined,

          schedule:
            this.schedule.trim() ||
            undefined,

          venue:
            this.venue.trim() ||
            undefined,

          status:
            'ACTIVE'
        }
      );
    }

    this.closeForm();
  }


  toggleLevel(
    level: ParticipantLevel
  ): void {

    if (
      this.eligibleLevels
        .includes(level)
    ) {

      this.eligibleLevels =
        this.eligibleLevels.filter(
          item => item !== level
        );

    } else {

      this.eligibleLevels = [
        ...this.eligibleLevels,
        level
      ];
    }
  }


  isLevelSelected(
    level: ParticipantLevel
  ): boolean {

    return this.eligibleLevels
      .includes(level);
  }


  cancelEvent(event: Event): void {
    this.eventService
      .cancelEvent(event.id);
  }


  activateEvent(event: Event): void {
    this.eventService
      .activateEvent(event.id);
  }


  // =========================================================
  // PARTICIPANT DRAWER
  // =========================================================

  openParticipants(
    event: Event
  ): void {

    this.selectedEvent.set(event);

    this.participantSearch.set('');

    this.participantHomeFilter.set('ALL');

    this.showAddParticipant.set(false);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.registrationSuccess.set(false);

    this.showParticipantsDrawer.set(true);
  }


  closeParticipants(): void {

    this.showParticipantsDrawer.set(false);

    this.showAddParticipant.set(false);

    this.selectedEvent.set(null);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.registrationSuccess.set(false);
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

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.registrationSuccess.set(false);

    this.showAddParticipant.set(true);
  }


  closeAddParticipant(): void {

    this.showAddParticipant.set(false);

    this.selectedParticipantId.set('');

    this.registrationValidation.set(null);

    this.registrationSuccess.set(false);
  }


  setSelectedParticipant(
    participantId: string
  ): void {

    this.selectedParticipantId.set(
      participantId
    );

    this.registrationValidation.set(null);

    this.registrationSuccess.set(false);

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

  registerSelectedParticipant(): void {

    const event =
      this.selectedEvent();

    const participantId =
      this.selectedParticipantId();

    if (!event || !participantId) {
      return;
    }


    const result =
      this.participantEventService
        .registerParticipant(
          participantId,
          event.id,
          'ADMIN'
        );


    this.registrationValidation.set(
      result.validation
    );


    if (!result.success) {
      return;
    }


    this.registrationSuccess.set(true);

    this.selectedParticipantId.set('');


    // Close add mode after successful registration
    this.showAddParticipant.set(false);
  }


  // =========================================================
  // CANCEL REGISTRATION
  // =========================================================

  cancelRegistration(
    registration: ParticipantEvent
  ): void {

    this.participantEventService
      .cancelRegistration(
        registration.id,
        'ADMIN'
      );
  }


  // =========================================================
  // REACTIVATE REGISTRATION
  // =========================================================

  reactivateRegistration(
    registration: ParticipantEvent
  ): void {

    this.participantEventService
      .reactivateRegistration(
        registration.id,
        'ADMIN'
      );
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


  getHomeById(
    shelterHomeId: string
  ): ShelterHome | undefined {

    return this.shelterHomeService
      .getHomeById(
        shelterHomeId
      );
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


  private resetForm(): void {

    this.eventName = '';

    this.eventCode = '';

    this.category = 'ARTS';

    this.mode = 'SOLO';

    this.eligibleLevels = [
      'SUB_JUNIOR',
      'JUNIOR',
      'SENIOR',
      'SUPER_SENIOR'
    ];

    this.minimumTeamSize = null;

    this.maximumTeamSize = null;

    this.schedule = '';

    this.venue = '';
  }
}