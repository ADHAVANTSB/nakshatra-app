import { Injectable, inject } from '@angular/core';
import { Event, EventCategory, Participant, ShelterHome } from '../../models';
import { AttendanceService } from '../attendance/attendance.service';
import { CertificateService } from '../certificates/certificate.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ParticipantService } from '../participants/participant.service';
import { ScoringService } from '../scoring/scoring.service';
import { ShelterHomeService } from '../shelter-homes/shelter-home.service';
import { TeamService } from '../teams/team.service';

export interface AttendanceSummary { recorded: number; present: number; absent: number; }
export interface CertificateSummary { generated: number; issued: number; }

export interface OperationalSummary {
  homes: number;
  participants: number;
  events: number;
  activeEvents: number;
  registrations: number;
  teams: number;
  attendance: AttendanceSummary;
  finalizedScores: number;
  certificates: CertificateSummary;
}

export interface HomeReport {
  home: ShelterHome;
  participants: number;
  boys: number;
  girls: number;
  registrations: number;
  teams: number;
  attendance: AttendanceSummary;
  finalizedSoloScores: number;
  participantCertificates: number;
}

export interface EventReport {
  event: Event;
  registrations: number;
  teams?: number;
  attendance: AttendanceSummary;
  finalizedScores: number;
  certificates: CertificateSummary;
}

export interface ParticipantReport {
  participant: Participant;
  registrations: number;
  attendance: AttendanceSummary;
  finalizedSoloScores: number;
  certificates: number;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly homes = inject(ShelterHomeService);
  private readonly participants = inject(ParticipantService);
  private readonly events = inject(EventService);
  private readonly registrations = inject(ParticipantEventService);
  private readonly teams = inject(TeamService);
  private readonly attendance = inject(AttendanceService);
  private readonly scoring = inject(ScoringService);
  private readonly certificates = inject(CertificateService);

  getSummary(): OperationalSummary {
    const attendance = this.attendance.records$();
    const scores = this.scoring.scores$();
    const certificates = this.certificates.certificates$();
    return {
      homes: this.homes.getHomes().length,
      participants: this.participants.getParticipants().length,
      events: this.events.getAll().length,
      activeEvents: this.events.activeEvents().length,
      registrations: this.registrations.getAll().filter(item => item.registrationStatus === 'REGISTERED').length,
      teams: this.teams.getAll().filter(team => team.status !== 'CANCELLED').length,
      attendance: this.summarizeAttendance(attendance),
      finalizedScores: scores.filter(score => score.status === 'FINALIZED').length,
      certificates: this.summarizeCertificates(certificates),
    };
  }

  getHomeReports(eventId?: string): HomeReport[] {
    const registrations = this.registrations.getAll().filter(item =>
      item.registrationStatus === 'REGISTERED' && (!eventId || item.eventId === eventId)
    );
    const attendance = this.attendance.records$().filter(item => !eventId || item.eventId === eventId);
    const scores = this.scoring.scores$().filter(score => !eventId || score.eventId === eventId);
    const certificates = this.certificates.certificates$().filter(item => !eventId || item.eventId === eventId);
    const teams = this.teams.getAll().filter(team =>
      team.status !== 'CANCELLED' && (!eventId || team.eventId === eventId)
    );

    return this.homes.getHomes().map(home => {
      const homeParticipants = this.participants.getParticipants().filter(item => item.shelterHomeId === home.id);
      const participantIds = new Set(homeParticipants.map(item => item.id));
      return {
        home,
        participants: homeParticipants.length,
        boys: homeParticipants.filter(item => item.gender === 'MALE').length,
        girls: homeParticipants.filter(item => item.gender === 'FEMALE').length,
        registrations: registrations.filter(item => participantIds.has(item.participantId)).length,
        teams: teams.filter(team => this.teams.getMembers(team.id).some(member => participantIds.has(member.participantId))).length,
        attendance: this.summarizeAttendance(attendance.filter(item => participantIds.has(item.participantId))),
        finalizedSoloScores: scores.filter(score => score.status === 'FINALIZED' && !!score.participantId && participantIds.has(score.participantId)).length,
        participantCertificates: certificates.filter(item => !!item.participantId && participantIds.has(item.participantId)).length,
      };
    });
  }

  getEventReports(category?: EventCategory | '', eventId?: string): EventReport[] {
    return this.events.getAll()
      .filter(event => !category || event.category === category)
      .filter(event => !eventId || event.id === eventId)
      .map(event => {
        const attendance = this.attendance.getByEvent(event.id);
        const scores = this.scoring.getByEvent(event.id);
        return {
          event,
          registrations: this.registrations.getEventRegistrations(event.id).length,
          teams: event.mode === 'GROUP' ? this.teams.getTeamsByEvent(event.id).length : undefined,
          attendance: this.summarizeAttendance(attendance),
          finalizedScores: scores.filter(score => score.status === 'FINALIZED').length,
          certificates: this.summarizeCertificates(this.certificates.getByEvent(event.id)),
        };
      });
  }

  getParticipantReports(homeId?: string, eventId?: string, search = ''): ParticipantReport[] {
    const query = search.trim().toLowerCase();
    return this.participants.getParticipants()
      .filter(participant => !homeId || participant.shelterHomeId === homeId)
      .filter(participant => !query || [participant.fullName, participant.participantCode, participant.shelterHomeId]
        .some(value => value.toLowerCase().includes(query)))
      .map(participant => {
        const registrations = this.registrations.getParticipantRegistrations(participant.id)
          .filter(item => !eventId || item.eventId === eventId);
        const attendance = this.attendance.records$().filter(item =>
          item.participantId === participant.id && (!eventId || item.eventId === eventId)
        );
        const scores = this.scoring.scores$().filter(score =>
          score.status === 'FINALIZED' && score.participantId === participant.id && (!eventId || score.eventId === eventId)
        );
        const certificates = this.certificates.certificates$().filter(item =>
          item.participantId === participant.id && (!eventId || item.eventId === eventId)
        );
        return { participant, registrations: registrations.length, attendance: this.summarizeAttendance(attendance), finalizedSoloScores: scores.length, certificates: certificates.length };
      });
  }

  private summarizeAttendance(records: { status: 'PRESENT' | 'ABSENT' }[]): AttendanceSummary {
    return { recorded: records.length, present: records.filter(item => item.status === 'PRESENT').length, absent: records.filter(item => item.status === 'ABSENT').length };
  }

  private summarizeCertificates(records: { status: 'GENERATED' | 'ISSUED' }[]): CertificateSummary {
    return { generated: records.filter(item => item.status === 'GENERATED').length, issued: records.filter(item => item.status === 'ISSUED').length };
  }
}
