import { Injectable, inject, signal } from '@angular/core';

import {
  Attendance,
  AttendanceStatus
} from '../../models';

import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { TeamService } from '../teams/team.service';

export interface AttendanceResult {
  success: boolean;
  attendance?: Attendance;
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {

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

  markAttendance(
    participantId: string,
    eventId: string,
    status: AttendanceStatus,
    teamId?: string,
    updatedBy = 'ADMIN'
  ): AttendanceResult {

    const errors = this.validateAttendance(participantId, eventId, teamId);

    if (errors.length > 0) {
      return { success: false, errors };
    }

    const existing = this.getByParticipantEvent(participantId, eventId);
    const now = new Date().toISOString();

    if (existing) {
      const attendance: Attendance = {
        ...existing,
        teamId,
        status,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy
      };

      this.records.update(current => current.map(record =>
        record.id === existing.id ? attendance : record
      ));

      return { success: true, attendance, errors: [] };
    }

    const attendance: Attendance = {
      id: `ATT-${Date.now()}`,
      participantId,
      eventId,
      teamId,
      status,
      version: 1,
      createdAt: now,
      createdBy: updatedBy,
      updatedAt: now,
      updatedBy
    };

    this.records.update(current => [...current, attendance]);

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
