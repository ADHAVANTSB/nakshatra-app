import { Injectable, inject, signal } from '@angular/core';

import {
  Attendance,
  AttendanceStatus
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { ProgramContextService } from '../program/program-context.service';
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
 * Persisted marks are read through the backend's `listAttendance` action, so
 * values saved in an earlier session display on load instead of showing as
 * "Not marked". A failed read is reported honestly and never erases records
 * that are already visible.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly apiClient = inject(ApiClientService);
  private readonly eventService = inject(EventService);
  private readonly participantEventService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);
  private readonly programContext = inject(ProgramContextService);

  private readonly records = signal<Attendance[]>([]);
  /** Events whose persisted attendance has been read at least once. */
  private readonly loadedEvents = new Set<string>();
  /** In-flight reads, keyed by event id, so concurrent callers share one request. */
  private readonly pendingLoads = new Map<string, Promise<boolean>>();

  constructor() {
    // Attendance rows belong to one programme/zone scope: a scope switch
    // drops them so no old-zone mark can ever be displayed again.
    this.programContext.onScopeChange(() => {
      this.records.set([]);
      this.loadedEvents.clear();
      this.pendingLoads.clear();
    });
  }

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

  /**
   * Reads the persisted attendance for one event. Concurrent calls for the
   * same event share a single request; a settled load is not re-requested
   * unless `force` is set (used after VERSION_CONFLICT).
   */
  async loadEventAttendance(eventId: string, force = false): Promise<boolean> {
    if (!eventId) return false;

    if (!force) {
      const pending = this.pendingLoads.get(eventId);
      if (pending) return pending;
      if (this.loadedEvents.has(eventId)) return true;
    }

    const request = this.requestEventAttendance(eventId)
      .finally(() => this.pendingLoads.delete(eventId));
    this.pendingLoads.set(eventId, request);
    return request;
  }

  private async requestEventAttendance(eventId: string): Promise<boolean> {
    const scopeVersion = this.programContext.scopeVersion();
    const response = await this.apiClient.listAttendance({ eventId });

    if (this.programContext.scopeVersion() !== scopeVersion) {
      // Scope changed while this read was in flight: never land old-zone rows.
      return false;
    }

    if (!response.success) {
      // A failed read must not clear records that are already displayed.
      return false;
    }

    this.records.update(current => [
      ...current.filter(record => record.eventId !== eventId),
      ...response.data.attendance,
    ]);
    this.loadedEvents.add(eventId);
    return true;
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

    const scopeVersion = this.programContext.scopeVersion();

    const response = await this.apiClient.markAttendance({
      eventId,
      participantId,
      status,
      ...(teamId ? { teamId } : {}),
      ...(existing ? { expectedVersion: existing.version } : {}),
    });

    if (this.programContext.scopeVersion() !== scopeVersion) {
      // The programme/zone changed while the mark was in flight: the
      // backend accepted it, but it belongs to the previous scope and is
      // never cached here.
      return response.success
        ? { success: true, attendance: response.data.attendance, errors: [] }
        : { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    if (!response.success) {
      if (response.error.code === 'VERSION_CONFLICT') {
        // The stored version no longer matches the backend; keeping it would
        // make every retry send the same stale expectedVersion. The forced
        // re-read brings the persisted values back so what is displayed is
        // current — the user no longer has to refresh manually.
        this.records.update(current => current.filter(record =>
          !(record.participantId === participantId && record.eventId === eventId)
        ));
        await this.loadEventAttendance(eventId, true);
      }

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
