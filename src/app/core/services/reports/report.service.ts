import { Injectable, inject } from '@angular/core';
import { Event, EventCategory, Participant, ShelterHome } from '../../models';
import { AttendanceService } from '../attendance/attendance.service';
import { CertificateService } from '../certificates/certificate.service';
import { EventService } from '../events/event.service';
import { ParticipantEventService } from '../events/participant-event.service';
import { ScoringService } from '../scoring/scoring.service';
import { ShelterDataResult, ShelterDataService } from '../shelter-homes/shelter-data.service';
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

/**
 * Read-only aggregation over already-loaded Nakshatra records.
 *
 * The only I/O this service performs is `load()`, which delegates to
 * `ShelterDataService.refresh()` so the shared backend cache is populated.
 * Every getter below is a pure read of that cache — no getter triggers a
 * request and no getter mutates state — which keeps the Summary, Homes, Events
 * and Participants tabs describing exactly the same backend snapshot.
 *
 * Shelter homes and participants both come from the single backend store, so
 * participant counts are grouped once per read and shared by the summary and
 * the per-home rows. That guarantees `summary.participants` always equals the
 * sum of the `HomeReport.participants` values.
 */
@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly shelterData = inject(ShelterDataService);
  private readonly homes = inject(ShelterHomeService);
  private readonly events = inject(EventService);
  private readonly registrations = inject(ParticipantEventService);
  private readonly teams = inject(TeamService);
  private readonly attendance = inject(AttendanceService);
  private readonly scoring = inject(ScoringService);
  private readonly certificates = inject(CertificateService);

  /** Fills the shared backend cache. Parallel calls collapse into one request. */
  load(): Promise<ShelterDataResult> {
    return this.shelterData.refresh();
  }

  getSummary(): OperationalSummary {
    const attendance = this.attendance.records$();
    const scores = this.scoring.scores$();
    const certificates = this.certificates.certificates$();
    const participantsByHome = this.participantsByHome();
    return {
      homes: this.homes.getHomes().length,
      // Sum of the same per-home grouping `getHomeReports()` uses, so the two
      // can never disagree.
      participants: this.totalParticipants(participantsByHome),
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
    const participantsByHome = this.participantsByHome();

    return this.homes.getHomes().map(home => {
      const homeParticipants = participantsByHome.get(home.id) ?? [];
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
    return this.allParticipants()
      .filter(participant => !homeId || participant.shelterHomeId === homeId)
      .filter(participant => !query || this.matchesSearch(participant, query))
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

  /**
   * Human-readable shelter home label. Raw backend ids are never rendered.
   */
  getHomeName(homeId: string): string {
    if (!homeId) {
      return 'Unknown Home';
    }

    return this.homes.getHomeById(homeId)?.name || 'Unknown Home';
  }

  /**
   * Human-readable shelter home code. Raw backend ids are never rendered.
   */
  getHomeCode(homeId: string): string {
    if (!homeId) {
      return '—';
    }

    return this.homes.getHomeById(homeId)?.homeCode || '—';
  }

  /**
   * Backend participants grouped by shelter home, restricted to homes the
   * backend currently reports. Every participant-facing number in this service
   * is derived from this single grouping.
   */
  private participantsByHome(): Map<string, Participant[]> {
    const grouped = new Map<string, Participant[]>();

    for (const participant of this.allParticipants()) {
      const existing = grouped.get(participant.shelterHomeId);

      if (existing) {
        existing.push(participant);
      } else {
        grouped.set(participant.shelterHomeId, [participant]);
      }
    }

    return grouped;
  }

  /** Flat list backing the grouping above, so both share one source. */
  private allParticipants(): Participant[] {
    const participants = this.shelterData.participants();
    const knownHomeIds = new Set(this.shelterData.homes().map(home => home.id));

    return participants.filter(participant => knownHomeIds.has(participant.shelterHomeId));
  }

  private totalParticipants(participantsByHome: Map<string, Participant[]>): number {
    let total = 0;

    for (const homeParticipants of participantsByHome.values()) {
      total += homeParticipants.length;
    }

    return total;
  }

  /** Searches the readable home label rather than the raw backend id. */
  private matchesSearch(participant: Participant, query: string): boolean {
    const homeLabel = `${this.getHomeName(participant.shelterHomeId)} ${this.getHomeCode(participant.shelterHomeId)}`;
    const terms: string[] = [participant.fullName, participant.participantCode, homeLabel];

    return terms.some(term => (term ?? '').toLowerCase().includes(query));
  }

  private summarizeAttendance(records: { status: 'PRESENT' | 'ABSENT' }[]): AttendanceSummary {
    return { recorded: records.length, present: records.filter(item => item.status === 'PRESENT').length, absent: records.filter(item => item.status === 'ABSENT').length };
  }

  private summarizeCertificates(records: { status: 'GENERATED' | 'ISSUED' }[]): CertificateSummary {
    return { generated: records.filter(item => item.status === 'GENERATED').length, issued: records.filter(item => item.status === 'ISSUED').length };
  }
}