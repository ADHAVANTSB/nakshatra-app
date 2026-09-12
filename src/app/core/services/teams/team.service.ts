import { Injectable, computed, signal } from '@angular/core';

import {
  Event,
  Participant,
  Team,
  TeamMember,
  TeamStatus,
  TeamValidationError,
  TeamValidationResult
} from '../../models';

import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';

@Injectable({
  providedIn: 'root'
})
export class TeamService {

  private readonly teams = signal<Team[]>([]);
  private readonly teamMembers = signal<TeamMember[]>([]);

  readonly teams$ = this.teams.asReadonly();
  readonly teamMembers$ = this.teamMembers.asReadonly();

  readonly activeTeams = computed(() =>
    this.teams().filter(team =>
      team.status !== 'CANCELLED'
    )
  );

  constructor(
    private readonly eventService: EventService,
    private readonly participantService: ParticipantService,
    private readonly participantEventService: ParticipantEventService
  ) {}

  // ---------------------------------------------------------
  // TEAM QUERIES
  // ---------------------------------------------------------

  getAll(): Team[] {
    return this.teams();
  }

  getById(teamId: string): Team | undefined {
    return this.teams().find(team => team.id === teamId);
  }

  getTeamsByEvent(eventId: string): Team[] {
    return this.teams().filter(team =>
      team.eventId === eventId &&
      team.status !== 'CANCELLED'
    );
  }

  getMembers(teamId: string): TeamMember[] {
    return this.teamMembers().filter(member =>
      member.teamId === teamId &&
      member.status === 'ACTIVE'
    );
  }

  getTeamMemberCount(teamId: string): number {
    return this.getMembers(teamId).length;
  }

  getParticipantTeam(
    participantId: string,
    eventId: string
  ): Team | undefined {

    const eventTeams = this.getTeamsByEvent(eventId);

    for (const team of eventTeams) {
      const memberExists = this.getMembers(team.id)
        .some(member => member.participantId === participantId);

      if (memberExists) {
        return team;
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------
  // TEAM CREATION
  // ---------------------------------------------------------

  createTeam(
    eventId: string,
    name: string,
    createdBy = 'ADMIN'
  ): TeamValidationResult & { team?: Team } {

    const event = this.eventService.getById(eventId);

    if (!event) {
      return {
        valid: false,
        errors: [
          {
            code: 'EVENT_NOT_FOUND',
            message: 'Event not found.'
          }
        ],
        warnings: []
      };
    }

    if (event.mode !== 'GROUP') {
      return {
        valid: false,
        errors: [
          {
            code: 'EVENT_NOT_GROUP',
            message: 'Teams can only be created for group events.'
          }
        ],
        warnings: []
      };
    }

    if (event.status !== 'ACTIVE') {
      return {
        valid: false,
        errors: [
          {
            code: 'EVENT_NOT_ACTIVE',
            message: 'Teams cannot be created for an inactive or cancelled event.'
          }
        ],
        warnings: []
      };
    }

    const now = new Date().toISOString();

    const team: Team = {
      id: `TEAM-${Date.now()}`,
      teamCode: `NK26-T-${String(this.teams().length + 1).padStart(4, '0')}`,
      eventId,
      name: name.trim(),
      status: 'DRAFT',
      validationStatus: 'NOT_VALIDATED',
      version: 1,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy
    };

    this.teams.update(current => [
      ...current,
      team
    ]);

    return {
      valid: true,
      errors: [],
      warnings: [],
      team
    };
  }

  // ---------------------------------------------------------
  // ADD MEMBER
  // ---------------------------------------------------------

  addMember(
    teamId: string,
    participantId: string,
    addedBy = 'ADMIN'
  ): TeamValidationResult & { member?: TeamMember } {

    const team = this.getById(teamId);

    if (!team) {
      return {
        valid: false,
        errors: [
          {
            code: 'TEAM_NOT_FOUND',
            message: 'Team not found.'
          }
        ],
        warnings: []
      };
    }

    const participant =
      this.participantService.getParticipantById(participantId);

    if (!participant) {
      return {
        valid: false,
        errors: [
          {
            code: 'PARTICIPANT_NOT_FOUND',
            message: 'Participant not found.'
          }
        ],
        warnings: []
      };
    }

    const validation =
      this.validateMember(team, participant);

    if (!validation.valid) {
      return validation;
    }

    const now = new Date().toISOString();

    const member: TeamMember = {
      id: `TM-${Date.now()}`,
      teamId,
      participantId,
      status: 'ACTIVE',
      joinedAt: now,
      joinedBy: addedBy
    };

    this.teamMembers.update(current => [
      ...current,
      member
    ]);

    this.touchTeam(teamId, addedBy);

    return {
      valid: true,
      errors: [],
      warnings: [],
      member
    };
  }

  // ---------------------------------------------------------
  // REMOVE MEMBER
  // ---------------------------------------------------------

  removeMember(
    teamId: string,
    participantId: string,
    removedBy = 'ADMIN'
  ): TeamValidationResult {

    const team = this.getById(teamId);

    if (!team) {
      return {
        valid: false,
        errors: [
          {
            code: 'TEAM_NOT_FOUND',
            message: 'Team not found.'
          }
        ],
        warnings: []
      };
    }

    if (
      team.status === 'LOCKED' ||
      team.status === 'CANCELLED'
    ) {
      return {
        valid: false,
        errors: [
          {
            code: 'TEAM_LOCKED',
            message: 'Locked or cancelled teams cannot be modified.'
          }
        ],
        warnings: []
      };
    }

    const member = this.teamMembers().find(item =>
      item.teamId === teamId &&
      item.participantId === participantId &&
      item.status === 'ACTIVE'
    );

    if (!member) {
      return {
        valid: false,
        errors: [
          {
            code: 'PARTICIPANT_NOT_FOUND',
            message: 'Participant is not currently part of this team.'
          }
        ],
        warnings: []
      };
    }

    const now = new Date().toISOString();

    this.teamMembers.update(current =>
      current.map(item =>
        item.id === member.id
          ? {
              ...item,
              status: 'REMOVED',
              removedAt: now,
              removedBy
            }
          : item
      )
    );

    this.touchTeam(teamId, removedBy);

    return {
      valid: true,
      errors: [],
      warnings: []
    };
  }

  // ---------------------------------------------------------
  // MEMBER VALIDATION
  // ---------------------------------------------------------

  validateMember(
    team: Team,
    participant: Participant
  ): TeamValidationResult {

    const errors: TeamValidationError[] = [];
    const warnings: string[] = [];

    const event = this.eventService.getById(team.eventId);

    if (!event) {
      errors.push({
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found.',
        teamId: team.id
      });

      return {
        valid: false,
        errors,
        warnings
      };
    }

    if (event.mode !== 'GROUP') {
      errors.push({
        code: 'EVENT_NOT_GROUP',
        message: 'This event is not a group event.',
        teamId: team.id
      });
    }

    if (team.status === 'LOCKED') {
      errors.push({
        code: 'TEAM_LOCKED',
        message: 'This team is locked.',
        teamId: team.id
      });
    }

    if (team.status === 'CANCELLED') {
      errors.push({
        code: 'TEAM_CANCELLED',
        message: 'This team has been cancelled.',
        teamId: team.id
      });
    }

    if (participant.eligibilityStatus !== 'ELIGIBLE') {
      errors.push({
        code: 'PARTICIPANT_NOT_ELIGIBLE',
        message: `${participant.fullName} is not eligible.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    if (
      participant.level &&
      event.eligibleLevels.length > 0 &&
      !event.eligibleLevels.includes(participant.level)
    ) {
      errors.push({
        code: 'PARTICIPANT_NOT_ELIGIBLE',
        message:
          `${participant.fullName} is not eligible for ${event.name}.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    const alreadyInTeam =
      this.getMembers(team.id)
        .some(member => member.participantId === participant.id);

    if (alreadyInTeam) {
      errors.push({
        code: 'PARTICIPANT_ALREADY_IN_TEAM',
        message: `${participant.fullName} is already in this team.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    const participantTeam =
      this.getParticipantTeam(participant.id, event.id);

    if (
      participantTeam &&
      participantTeam.id !== team.id
    ) {
      errors.push({
        code: 'PARTICIPANT_ALREADY_IN_TEAM',
        message:
          `${participant.fullName} is already assigned to another team for this event.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ---------------------------------------------------------
  // TEAM VALIDATION
  // ---------------------------------------------------------

  validateTeam(teamId: string): TeamValidationResult {

    const team = this.getById(teamId);

    if (!team) {
      return {
        valid: false,
        errors: [
          {
            code: 'TEAM_NOT_FOUND',
            message: 'Team not found.'
          }
        ],
        warnings: []
      };
    }

    const event = this.eventService.getById(team.eventId);

    if (!event) {
      return {
        valid: false,
        errors: [
          {
            code: 'EVENT_NOT_FOUND',
            message: 'Event not found.',
            teamId
          }
        ],
        warnings: []
      };
    }

    const members = this.getMembers(teamId);

    const errors: TeamValidationError[] = [];
    const warnings: string[] = [];

    // Minimum team size
    if (
      event.minimumTeamSize !== undefined &&
      members.length < event.minimumTeamSize
    ) {
      errors.push({
        code: 'TEAM_MINIMUM_SIZE_NOT_MET',
        message:
          `Team requires at least ${event.minimumTeamSize} participants. ` +
          `Currently ${members.length} participant(s).`,
        teamId
      });
    }

    // Maximum team size
    if (
      event.maximumTeamSize !== undefined &&
      members.length > event.maximumTeamSize
    ) {
      errors.push({
        code: 'TEAM_MAXIMUM_SIZE_EXCEEDED',
        message:
          `Team allows a maximum of ${event.maximumTeamSize} participants. ` +
          `Currently ${members.length} participant(s).`,
        teamId
      });
    }

    // Validate every member
    for (const member of members) {

      const participant =
        this.participantService.getParticipantById(
          member.participantId
        );

      if (!participant) {
        errors.push({
          code: 'PARTICIPANT_NOT_FOUND',
          message: 'Team contains a participant that no longer exists.',
          participantId: member.participantId,
          teamId
        });

        continue;
      }

      const memberValidation =
        this.validateMemberWithoutDuplicateCheck(
          team,
          participant
        );

      errors.push(...memberValidation.errors);
      warnings.push(...memberValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateMemberWithoutDuplicateCheck(
    team: Team,
    participant: Participant
  ): TeamValidationResult {

    const event = this.eventService.getById(team.eventId);

    if (!event) {
      return {
        valid: false,
        errors: [
          {
            code: 'EVENT_NOT_FOUND',
            message: 'Event not found.',
            teamId: team.id
          }
        ],
        warnings: []
      };
    }

    const errors: TeamValidationError[] = [];
    const warnings: string[] = [];

    if (participant.eligibilityStatus !== 'ELIGIBLE') {
      errors.push({
        code: 'PARTICIPANT_NOT_ELIGIBLE',
        message: `${participant.fullName} is not eligible.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    if (
      participant.level &&
      event.eligibleLevels.length > 0 &&
      !event.eligibleLevels.includes(participant.level)
    ) {
      errors.push({
        code: 'PARTICIPANT_NOT_ELIGIBLE',
        message:
          `${participant.fullName} is not eligible for ${event.name}.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ---------------------------------------------------------
  // TEAM STATUS
  // ---------------------------------------------------------

  markReady(
    teamId: string,
    updatedBy = 'ADMIN'
  ): TeamValidationResult {

    const validation = this.validateTeam(teamId);

    if (!validation.valid) {
      return validation;
    }

    this.updateTeamStatus(
      teamId,
      'READY',
      updatedBy
    );

    return validation;
  }

  lockTeam(
    teamId: string,
    updatedBy = 'ADMIN'
  ): TeamValidationResult {

    const validation = this.validateTeam(teamId);

    if (!validation.valid) {
      return validation;
    }

    this.updateTeamStatus(
      teamId,
      'LOCKED',
      updatedBy
    );

    return validation;
  }

  cancelTeam(
    teamId: string,
    updatedBy = 'ADMIN'
  ): TeamValidationResult {

    const team = this.getById(teamId);

    if (!team) {
      return {
        valid: false,
        errors: [
          {
            code: 'TEAM_NOT_FOUND',
            message: 'Team not found.'
          }
        ],
        warnings: []
      };
    }

    this.updateTeamStatus(
      teamId,
      'CANCELLED',
      updatedBy
    );

    return {
      valid: true,
      errors: [],
      warnings: []
    };
  }

  private updateTeamStatus(
    teamId: string,
    status: TeamStatus,
    updatedBy: string
  ): void {

    const now = new Date().toISOString();

    this.teams.update(current =>
      current.map(team =>
        team.id === teamId
          ? {
              ...team,
              status,
              validationStatus:
                status === 'READY' || status === 'LOCKED'
                  ? 'PASSED'
                  : team.validationStatus,
              version: team.version + 1,
              updatedAt: now,
              updatedBy
            }
          : team
      )
    );
  }

  private touchTeam(
    teamId: string,
    updatedBy: string
  ): void {

    const now = new Date().toISOString();

    this.teams.update(current =>
      current.map(team =>
        team.id === teamId
          ? {
              ...team,
              status: 'DRAFT',
              validationStatus: 'NOT_VALIDATED',
              version: team.version + 1,
              updatedAt: now,
              updatedBy
            }
          : team
      )
    );
  }
}