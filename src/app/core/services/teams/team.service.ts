import { Injectable, computed, inject, signal } from '@angular/core';

import {
  Participant,
  Team,
  TeamMember,
  TeamValidationError,
  TeamValidationResult
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';

export type TeamLoadStatus = 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR';

export interface TeamLoadState {
  status: TeamLoadStatus;
  error: string;
}

export interface TeamWriteResult {
  success: boolean;
  team?: Team;
  errors: string[];
  errorCode?: string;
}

const IDLE: TeamLoadState = { status: 'IDLE', error: '' };

/**
 * Teams and team members for group events.
 *
 * Teams are persisted by the backend. This service holds a per-event read cache
 * filled by `listTeams(eventId)` and refreshed after every `createTeam`,
 * `addTeamMember` and `removeTeamMember`; it never keeps a second team dataset
 * and never reports a write as successful unless the backend accepted it.
 *
 * The validation methods are pure rules evaluated against backend data so the
 * UI can explain why a member or team is not admissible before a request.
 */
@Injectable({
  providedIn: 'root'
})
export class TeamService {
  private readonly apiClient = inject(ApiClientService);
  private readonly eventService = inject(EventService);
  private readonly participantService = inject(ParticipantService);
  private readonly participantEventService = inject(ParticipantEventService);

  private readonly teams = signal<Team[]>([]);
  private readonly teamMembers = signal<TeamMember[]>([]);
  private readonly loadStates = signal<Record<string, TeamLoadState>>({});

  /** In-flight reads, so concurrent callers share one request per event. */
  private readonly pending = new Map<string, Promise<boolean>>();

  readonly teams$ = this.teams.asReadonly();
  readonly teamMembers$ = this.teamMembers.asReadonly();

  readonly activeTeams = computed(() =>
    this.teams().filter(team => team.status !== 'CANCELLED')
  );

  // ---------------------------------------------------------
  // BACKEND READS
  // ---------------------------------------------------------

  /** Load state for one event's teams; distinguishes empty from failed. */
  loadState(eventId: string): TeamLoadState {
    return this.loadStates()[eventId] ?? IDLE;
  }

  /**
   * Reads persisted teams for one event. Repeated calls reuse the cached result
   * unless `force` is set, and concurrent calls share a single request.
   */
  loadTeams(eventId: string, force = false): Promise<boolean> {
    const inFlight = this.pending.get(eventId);

    if (inFlight) {
      return inFlight;
    }

    if (!force && this.loadState(eventId).status === 'LOADED') {
      return Promise.resolve(true);
    }

    const request = this.fetchTeams(eventId).finally(() => {
      this.pending.delete(eventId);
    });

    this.pending.set(eventId, request);
    return request;
  }

  /** Re-reads one team from the backend and replaces it in the cache. */
  async refreshTeam(teamId: string): Promise<boolean> {
    const response = await this.apiClient.getTeam(teamId);

    if (!response.success) {
      return false;
    }

    this.mergeTeam(response.data.team, response.data.members);
    return true;
  }

  private async fetchTeams(eventId: string): Promise<boolean> {
    this.setLoadState(eventId, { status: 'LOADING', error: '' });

    const response = await this.apiClient.listTeams(eventId);

    if (!response.success) {
      this.setLoadState(eventId, { status: 'ERROR', error: response.error.message });
      return false;
    }

    const teamIds = new Set(response.data.teams.map(team => team.id));
    const staleTeamIds = new Set(
      this.teams().filter(team => team.eventId === eventId).map(team => team.id)
    );

    this.teams.update(current => [
      ...current.filter(team => team.eventId !== eventId),
      ...response.data.teams,
    ]);
    this.teamMembers.update(current => [
      ...current.filter(
        member => !teamIds.has(member.teamId) && !staleTeamIds.has(member.teamId)
      ),
      ...response.data.members,
    ]);

    this.setLoadState(eventId, { status: 'LOADED', error: '' });
    return true;
  }

  private mergeTeam(team: Team, members: TeamMember[]): void {
    this.teams.update(current => {
      const exists = current.some(item => item.id === team.id);
      return exists
        ? current.map(item => (item.id === team.id ? team : item))
        : [...current, team];
    });
    this.teamMembers.update(current => [
      ...current.filter(member => member.teamId !== team.id),
      ...members,
    ]);
  }

  private setLoadState(eventId: string, state: TeamLoadState): void {
    this.loadStates.update(current => ({ ...current, [eventId]: state }));
  }

  // ---------------------------------------------------------
  // CACHE QUERIES
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

  getParticipantTeam(participantId: string, eventId: string): Team | undefined {
    return this.getTeamsByEvent(eventId).find(team =>
      this.getMembers(team.id).some(member => member.participantId === participantId)
    );
  }

  // ---------------------------------------------------------
  // BACKEND WRITES
  // ---------------------------------------------------------

  async createTeam(eventId: string, name: string): Promise<TeamWriteResult> {
    const event = this.eventService.getById(eventId);
    const trimmed = name.trim();

    if (!event) {
      return { success: false, errors: ['Event not found.'] };
    }

    if (event.mode !== 'GROUP') {
      return { success: false, errors: ['Teams can only be created for group events.'] };
    }

    if (event.status !== 'ACTIVE') {
      return { success: false, errors: ['Teams cannot be created for an inactive or cancelled event.'] };
    }

    if (!trimmed) {
      return { success: false, errors: ['Enter a team name.'] };
    }

    const response = await this.apiClient.createTeam({ eventId, name: trimmed });

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    await this.loadTeams(eventId, true);

    return { success: true, team: this.getById(response.data.team.id) ?? response.data.team, errors: [] };
  }

  async addMember(teamId: string, participantId: string): Promise<TeamWriteResult> {
    const team = this.getById(teamId);

    if (!team) {
      return { success: false, errors: ['Team not found.'] };
    }

    const participant = this.participantService.getParticipantById(participantId);

    if (!participant) {
      return { success: false, errors: ['Participant not found.'] };
    }

    const validation = this.validateMember(team, participant);

    if (!validation.valid) {
      return { success: false, errors: validation.errors.map(error => error.message) };
    }

    const response = await this.apiClient.addTeamMember({ teamId, participantId });

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    await this.loadTeams(team.eventId, true);

    return { success: true, team: this.getById(teamId), errors: [] };
  }

  async removeMember(teamId: string, participantId: string): Promise<TeamWriteResult> {
    const team = this.getById(teamId);

    if (!team) {
      return { success: false, errors: ['Team not found.'] };
    }

    if (team.status === 'LOCKED' || team.status === 'CANCELLED') {
      return { success: false, errors: ['Locked or cancelled teams cannot be modified.'] };
    }

    if (!this.getMembers(teamId).some(member => member.participantId === participantId)) {
      return { success: false, errors: ['Participant is not currently part of this team.'] };
    }

    const response = await this.apiClient.removeTeamMember({ teamId, participantId });

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    await this.loadTeams(team.eventId, true);

    return { success: true, team: this.getById(teamId), errors: [] };
  }

  // ---------------------------------------------------------
  // VALIDATION (pure rules over backend data)
  // ---------------------------------------------------------

  validateMember(team: Team, participant: Participant): TeamValidationResult {
    const errors: TeamValidationError[] = [];
    const event = this.eventService.getById(team.eventId);

    if (!event) {
      return {
        valid: false,
        errors: [{ code: 'EVENT_NOT_FOUND', message: 'Event not found.', teamId: team.id }],
        warnings: []
      };
    }

    if (event.mode !== 'GROUP') {
      errors.push({ code: 'EVENT_NOT_GROUP', message: 'This event is not a group event.', teamId: team.id });
    }

    if (event.status !== 'ACTIVE') {
      errors.push({ code: 'EVENT_NOT_ACTIVE', message: 'Teams can only be modified for an active event.', teamId: team.id });
    }

    if (team.status === 'LOCKED') {
      errors.push({ code: 'TEAM_LOCKED', message: 'This team is locked.', teamId: team.id });
    }

    if (team.status === 'CANCELLED') {
      errors.push({ code: 'TEAM_CANCELLED', message: 'This team has been cancelled.', teamId: team.id });
    }

    errors.push(...this.eligibilityErrors(team, participant));

    if (this.getMembers(team.id).some(member => member.participantId === participant.id)) {
      errors.push({
        code: 'PARTICIPANT_ALREADY_IN_TEAM',
        message: `${participant.fullName} is already in this team.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    const otherTeam = this.getParticipantTeam(participant.id, event.id);

    if (otherTeam && otherTeam.id !== team.id) {
      errors.push({
        code: 'PARTICIPANT_ALREADY_IN_TEAM',
        message: `${participant.fullName} is already assigned to another team for this event.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    if (
      event.maximumTeamSize !== undefined &&
      this.getTeamMemberCount(team.id) >= event.maximumTeamSize
    ) {
      errors.push({
        code: 'TEAM_MAXIMUM_SIZE_EXCEEDED',
        message:
          `Team allows a maximum of ${event.maximumTeamSize} participants. ` +
          `Currently ${this.getTeamMemberCount(team.id)} participant(s).`,
        teamId: team.id
      });
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  validateTeam(teamId: string): TeamValidationResult {
    const team = this.getById(teamId);

    if (!team) {
      return {
        valid: false,
        errors: [{ code: 'TEAM_NOT_FOUND', message: 'Team not found.' }],
        warnings: []
      };
    }

    const event = this.eventService.getById(team.eventId);

    if (!event) {
      return {
        valid: false,
        errors: [{ code: 'EVENT_NOT_FOUND', message: 'Event not found.', teamId }],
        warnings: []
      };
    }

    if (event.mode !== 'GROUP') {
      return {
        valid: false,
        errors: [{ code: 'EVENT_NOT_GROUP', message: 'This event is not a group event.', teamId }],
        warnings: []
      };
    }

    if (event.status !== 'ACTIVE') {
      return {
        valid: false,
        errors: [{ code: 'EVENT_NOT_ACTIVE', message: 'This event is not currently active.', teamId }],
        warnings: []
      };
    }

    const members = this.getMembers(teamId);
    const errors: TeamValidationError[] = [];

    // Size limits are enforced only when the event actually configures them.
    if (event.minimumTeamSize !== undefined && members.length < event.minimumTeamSize) {
      errors.push({
        code: 'TEAM_MINIMUM_SIZE_NOT_MET',
        message:
          `Team requires at least ${event.minimumTeamSize} participants. ` +
          `Currently ${members.length} participant(s).`,
        teamId
      });
    }

    if (event.maximumTeamSize !== undefined && members.length > event.maximumTeamSize) {
      errors.push({
        code: 'TEAM_MAXIMUM_SIZE_EXCEEDED',
        message:
          `Team allows a maximum of ${event.maximumTeamSize} participants. ` +
          `Currently ${members.length} participant(s).`,
        teamId
      });
    }

    for (const member of members) {
      const participant = this.participantService.getParticipantById(member.participantId);

      if (!participant) {
        errors.push({
          code: 'PARTICIPANT_NOT_FOUND',
          message: 'Team contains a participant that is not loaded.',
          participantId: member.participantId,
          teamId
        });
        continue;
      }

      errors.push(...this.eligibilityErrors(team, participant));
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  private eligibilityErrors(team: Team, participant: Participant): TeamValidationError[] {
    const event = this.eventService.getById(team.eventId);
    const errors: TeamValidationError[] = [];

    if (!event) {
      return errors;
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
        message: `${participant.fullName} is not eligible for ${event.name}.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    if (!this.participantEventService.isAlreadyRegistered(participant.id, event.id)) {
      errors.push({
        code: 'PARTICIPANT_NOT_REGISTERED',
        message: `${participant.fullName} is not registered for ${event.name}.`,
        participantId: participant.id,
        teamId: team.id
      });
    }

    return errors;
  }
}
