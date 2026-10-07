import { Injectable, inject, signal } from '@angular/core';

import {
  Attendance,
  AttendanceStatus
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { TeamService } from '../teams/team.service';

export interface AttendanceResult {
  success: boolean;
  attendance?: Attendance;
  errors: string[];
  errorCode?: string;
}

/**
 * Attendance.
 *
 * Every mark is persisted by the backend through `markAttendance`, and the cache
 * below holds only records the backend has returned. A mark is never reported
 * as successful unless the backend accepted it.
 *
 * The backend contract exposes no attendance read action, so records persisted
 * in an earlier session cannot be loaded here; those rows display "Not marked"
 * until they are marked again in this session.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly apiClient = inject(ApiClientService);
  private readonly eventService = inject(EventService);
  private readonly participantEventService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);

  private readonly records = signal<Attendance[]>([]);

  readonly records$ = this.records.asReadonly();

  getByEvent(eventId: string): Attendance[] {
    return this.records().filter(record => record.eventId === eventId);
  }

  getByParticipantEvent(
    participantId: string,
    eventId: string
  ): Attendance | undefined {
    return this.records().find(record =>
      record.participantId === participantId &&
      record.eventId === eventId
    );
  }

  async markAttendance(
    participantId: string,
    eventId: string,
    status: AttendanceStatus,
    teamId?: string
  ): Promise<AttendanceResult> {
    const errors = this.validateAttendance(participantId, eventId, teamId);

    if (errors.length > 0) {
      return { success: false, errors };
    }

    const existing = this.getByParticipantEvent(participantId, eventId);

    const response = await this.apiClient.markAttendance({
      eventId,
      participantId,
      status,
      ...(teamId ? { teamId } : {}),
      ...(existing ? { expectedVersion: existing.version } : {}),
    });

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    const attendance = response.data.attendance;

    this.records.update(current => [
      ...current.filter(record =>
        !(record.participantId === attendance.participantId && record.eventId === attendance.eventId)
      ),
      attendance,
    ]);

    return { success: true, attendance, errors: [] };
  }

  private validateAttendance(
    participantId: string,
    eventId: string,
    teamId?: string
  ): string[] {
    const errors: string[] = [];
    const participant = this.participantService.getParticipantById(participantId);
    const event = this.eventService.getById(eventId);

    if (!participant) {
      return ['Participant not found.'];
    }

    if (!event) {
      return ['Event not found.'];
    }

    if (event.status !== 'ACTIVE') {
      errors.push('Attendance can only be recorded for an active event.');
    }

    if (!this.participantEventService.isAlreadyRegistered(participantId, eventId)) {
      errors.push('Attendance can only be recorded for a registered participant.');
    }

    if (teamId) {
      const team = this.teamService.getById(teamId);

      if (!team || team.eventId !== eventId) {
        errors.push('The selected team does not belong to this event.');
      } else if (!this.teamService.getMembers(teamId).some(
        member => member.participantId === participantId
      )) {
        errors.push('The participant is not an active member of the selected team.');
      }
    }

    return errors;
  }
}
