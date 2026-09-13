import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttendanceStatus, Event, Participant } from '../../core/models';
import { AttendanceService } from '../../core/services/attendance/attendance.service';
import { EventService } from '../../core/services/events/event.service';
import { ParticipantEventService } from '../../core/services/events/participant-event.service';
import { ParticipantService } from '../../core/services/participants/participant.service';
import { TeamService } from '../../core/services/teams/team.service';

@Component({
  selector: 'nk-attendance',
  imports: [FormsModule],
  templateUrl: './attendance.html',
  styleUrl: './attendance.scss',
})
export class Attendance {
  private readonly attendanceService = inject(AttendanceService);
  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(ParticipantEventService);
  private readonly participantService = inject(ParticipantService);
  private readonly teamService = inject(TeamService);

  readonly events = this.eventService.events$;
  readonly selectedEventId = signal('');
  readonly message = signal('');
  readonly errors = signal<string[]>([]);
  readonly selectedEvent = computed(() => this.selectedEventId()
    ? this.eventService.getById(this.selectedEventId())
    : undefined);

  readonly attendees = computed(() => {
    const event = this.selectedEvent();
    if (!event) return [];
    return this.registrationService.getEventRegistrations(event.id)
      .map(registration => {
        const participant = this.participantService.getParticipantById(registration.participantId);
        return participant ? {
          participant,
          team: event.mode === 'GROUP'
            ? this.teamService.getParticipantTeam(participant.id, event.id)
            : undefined,
          attendance: this.attendanceService.getByParticipantEvent(participant.id, event.id)
        } : undefined;
      })
      .filter((item): item is {
        participant: Participant;
        team: ReturnType<TeamService['getParticipantTeam']>;
        attendance: ReturnType<AttendanceService['getByParticipantEvent']>;
      } => !!item);
  });

  readonly presentCount = computed(() => this.attendees()
    .filter(item => item.attendance?.status === 'PRESENT').length);
  readonly absentCount = computed(() => this.attendees()
    .filter(item => item.attendance?.status === 'ABSENT').length);

  setEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.message.set('');
    this.errors.set([]);
  }

  markAttendance(participantId: string, status: AttendanceStatus, teamId?: string): void {
    const event = this.selectedEvent();
    if (!event) return;
    const result = this.attendanceService.markAttendance(
      participantId, event.id, status, teamId, 'ADMIN'
    );
    this.errors.set(result.errors);
    this.message.set(result.success ? `Attendance marked ${status.toLowerCase()}.` : '');
  }

  levelLabel(participant: Participant): string {
    return participant.level?.replace('_', ' ') ?? 'No level';
  }

  eventModeLabel(event: Event): string {
    return event.mode === 'SOLO' ? 'Individual' : 'Group';
  }
}
