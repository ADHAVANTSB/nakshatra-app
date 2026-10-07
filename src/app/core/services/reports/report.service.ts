import { Injectable, computed, inject, signal } from '@angular/core';

import {
  EventCategory,
  EventMode,
  EventStatus,
  GetReportsData,
  OperationalCounts,
  ParticipantLevel,
  ReportScopePayload,
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';

/* ================================================================
   REQUEST STATE
   ================================================================ */

/** Lifecycle of one backend read. */
export type ReportRequestStatus = 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR';

/**
 * State of one backend read. `data` is set only when `status` is LOADED and
 * `error` only when it is ERROR, so a page can never mistake a failed or
 * pending read for a real answer.
 */
export interface ReportRequestState<T> {
  readonly status: ReportRequestStatus;
  readonly data: T | null;
  readonly error: string;
}

/** State of the `getReports` read, plus the scope it belongs to. */
export interface ReportsRequestState extends ReportRequestState<NormalizedReportRows> {
  /** Stable key of the scope this state answers; '' before the first read. */
  readonly scopeKey: string;
}

/* ================================================================
   ROW MODELS
   Every counter below is nullable on purpose. `null` means "the backend row
   did not carry this figure", which pages render as an em dash. It never means
   zero.
   ================================================================ */

/** Attendance counters carried by a report row. */
export interface AttendanceSummary {
  readonly recorded: number | null;
  readonly present: number | null;
  readonly absent: number | null;
}

/** Certificate counters carried by a report row. */
export interface CertificateSummary {
  readonly generated: number | null;
  readonly issued: number | null;
}

/**
 * A `homes` row of `getReports`, normalized.
 *
 * `key` exists only for `@for` tracking and `homeId` only for joining; neither
 * is ever rendered, so a raw backend id can never reach the UI.
 */
export interface NormalizedHomeReport {
  readonly key: string;
  readonly homeId: string;
  readonly name: string;
  readonly homeCode: string;
  readonly participants: number | null;
  readonly boys: number | null;
  readonly girls: number | null;
  readonly registrations: number | null;
  readonly teams: number | null;
  readonly attendance: AttendanceSummary | null;
  readonly finalizedSoloScores: number | null;
  readonly participantCertificates: number | null;
}

/** An `events` row of `getReports`, normalized. */
export interface NormalizedEventReport {
  readonly key: string;
  readonly eventId: string;
  readonly name: string;
  readonly eventCode: string;
  readonly category: EventCategory | null;
  readonly mode: EventMode | null;
  readonly status: EventStatus | null;
  readonly registrations: number | null;
  readonly teams: number | null;
  readonly attendance: AttendanceSummary | null;
  readonly finalizedScores: number | null;
  readonly certificates: CertificateSummary | null;
}

/** A `participants` row of `getReports`, normalized. */
export interface NormalizedParticipantReport {
  readonly key: string;
  readonly participantId: string;
  readonly fullName: string;
  readonly participantCode: string;
  readonly shelterHomeId: string;
  readonly homeName: string;
  readonly homeCode: string;
  readonly level: ParticipantLevel | null;
  readonly registrations: number | null;
  readonly attendance: AttendanceSummary | null;
  readonly finalizedSoloScores: number | null;
  readonly certificates: number | null;
}

/** Which collections the backend returned as an array, per collection. */
export interface ReportCollectionsSupplied {
  readonly homes: boolean;
  readonly events: boolean;
  readonly participants: boolean;
}

/** Every `getReports` collection, normalized. */
export interface NormalizedReportRows {
  readonly homes: readonly NormalizedHomeReport[];
  readonly events: readonly NormalizedEventReport[];
  readonly participants: readonly NormalizedParticipantReport[];
  /**
   * False for a collection the backend omitted (not an array). Pages treat an
   * omitted collection as an error for that report, never as an empty one.
   */
  readonly supplied: ReportCollectionsSupplied;
}

const IDLE_SUMMARY: ReportRequestState<OperationalCounts> = {
  status: 'IDLE',
  data: null,
  error: '',
};

const IDLE_REPORTS: ReportsRequestState = {
  status: 'IDLE',
  data: null,
  error: '',
  scopeKey: '',
};

/**
 * Read-only reporting over the Nakshatra backend.
 *
 * Exactly two backend actions feed it: `getDashboardSummary` for the
 * operational counters and `getReports` for the report rows. Every figure a
 * page renders comes from one of them. Nothing is counted on the client, a
 * failed read surfaces as an ERROR state with the backend message, and nothing
 * here sorts by score, ranks rows, selects a winner or writes a record.
 *
 * The shared shelter store is used only to turn a joined id into a readable
 * name or code, so a raw id never reaches the UI.
 */
@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly apiClient = inject(ApiClientService);
  private readonly shelterData = inject(ShelterDataService);

  private readonly summaryStateSignal = signal<ReportRequestState<OperationalCounts>>(IDLE_SUMMARY);
  private readonly reportsStateSignal = signal<ReportsRequestState>(IDLE_REPORTS);

  /** The in-flight summary read, so parallel callers share one request. */
  private summaryPending: Promise<OperationalCounts | null> | null = null;

  /** The in-flight report read and its scope, so an identical scope is not re-sent. */
  private reportsPending: { readonly key: string; readonly promise: Promise<void> } | null = null;

  /** Guards against a slower, superseded report read overwriting a newer one. */
  private reportsRequest = 0;

  /** Full state of the last `getDashboardSummary` read. */
  readonly summaryState = this.summaryStateSignal.asReadonly();
  /** Backend counters, only when the last summary read succeeded. */
  readonly summary = computed(() => this.summaryStateSignal().data);
  readonly summaryLoading = computed(() => this.summaryStateSignal().status === 'LOADING');
  /** Backend message from the last `getDashboardSummary` failure. */
  readonly summaryError = computed(() => {
    const state = this.summaryStateSignal();
    return state.status === 'ERROR' ? state.error : '';
  });

  /** Full state of the last `getReports` read. */
  readonly reportsState = this.reportsStateSignal.asReadonly();
  readonly reportsLoading = computed(() => this.reportsStateSignal().status === 'LOADING');
  /** Backend message from the last `getReports` failure. */
  readonly reportsError = computed(() => {
    const state = this.reportsStateSignal();
    return state.status === 'ERROR' ? state.error : '';
  });

  /**
   * Reads the backend operational counters.
   *
   * Parallel calls collapse into one request. Returns the counts, or null when
   * the backend could not supply them; the reason is kept in `summaryError`.
   * This never fans out per event or per participant: the backend already
   * aggregates those figures.
   */
  getBackendSummary(): Promise<OperationalCounts | null> {
    if (this.summaryPending) {
      return this.summaryPending;
    }

    this.summaryPending = this.fetchSummary().finally(() => {
      this.summaryPending = null;
    });

    return this.summaryPending;
  }

  /**
   * Reads the report collections for one scope.
   *
   * One request covers every collection. A scope that is already in flight is
   * never re-sent. Unless `force` is set, a scope that already loaded or already
   * failed is not re-sent either, so switching tabs or re-applying the same
   * filter costs nothing; Retry and Reload pass `force`.
   */
  loadReports(scope: ReportScopePayload, force = false): Promise<void> {
    const key = scopeKey(scope);

    if (this.reportsPending?.key === key) {
      return this.reportsPending.promise;
    }

    const current = this.reportsStateSignal();

    if (
      !force &&
      current.scopeKey === key &&
      (current.status === 'LOADED' || current.status === 'ERROR')
    ) {
      return Promise.resolve();
    }

    const promise = this.fetchReports(scope, key);
    this.reportsPending = { key, promise };
    return promise;
  }

  /** True when the current report state answers exactly this scope. */
  isCurrentScope(scope: ReportScopePayload): boolean {
    return this.reportsStateSignal().scopeKey === scopeKey(scope);
  }

  /**
   * Normalizes a `getReports` payload into renderable rows.
   *
   * ASSUMED ROW SHAPE (the backend row contract is not published to the
   * client, so every field is read defensively and a missing one becomes null):
   *
   *  homes[]        id|shelterHomeId, name|homeName, homeCode|code,
   *                 participants|participantCount, boys|maleCount,
   *                 girls|femaleCount, registrations|registrationCount,
   *                 teams|teamCount, attendance{recorded,present,absent} or
   *                 attendanceRecorded|attendancePresent|attendanceAbsent,
   *                 finalizedSoloScores|finalizedScores,
   *                 certificates|participantCertificates
   *  events[]       id|eventId, name|eventName, eventCode|code, category, mode,
   *                 status, registrations|registrationCount,
   *                 teams|teamCount, attendance{…},
   *                 finalizedScores|finalizedScoreCount,
   *                 certificates{generated,issued} or
   *                 certificatesGenerated|certificatesIssued
   *  participants[] id|participantId, fullName|name, participantCode|code,
   *                 shelterHomeId|homeId, level,
   *                 registrations|registrationCount, attendance{…},
   *                 finalizedSoloScores|finalizedScores,
   *                 certificates|certificateCount
   *
   * Reading rules: a count is accepted only as a finite JSON number — a numeric
   * string is never coerced — and a label only as a non-empty trimmed string. A
   * row with no readable identity (no id and no name/code) is skipped rather
   * than rendered as a blank line. A collection that is not an array is
   * reported through `supplied` so the page can show it as an error.
   */
  normalizeReports(data: GetReportsData): NormalizedReportRows {
    const homes = this.collection(data?.homes);
    const events = this.collection(data?.events);
    const participants = this.collection(data?.participants);

    return {
      homes: homes.rows
        .map((row, index) => this.normalizeHomeRow(row, index))
        .filter((row): row is NormalizedHomeReport => row !== null),
      events: events.rows
        .map((row, index) => this.normalizeEventRow(row, index))
        .filter((row): row is NormalizedEventReport => row !== null),
      participants: participants.rows
        .map((row, index) => this.normalizeParticipantRow(row, index))
        .filter((row): row is NormalizedParticipantReport => row !== null),
      supplied: {
        homes: homes.present,
        events: events.present,
        participants: participants.present,
      },
    };
  }

  /**
   * Human-readable shelter home label. Raw backend ids are never rendered.
   */
  getHomeName(homeId: string): string {
    if (!homeId) {
      return 'Unknown Home';
    }

    return this.shelterData.getHomeById(homeId)?.homeName || 'Unknown Home';
  }

  /**
   * Human-readable shelter home code. Raw backend ids are never rendered.
   */
  getHomeCode(homeId: string): string {
    if (!homeId) {
      return '—';
    }

    return this.shelterData.getHomeById(homeId)?.homeCode || '—';
  }

  /** Renders a counter, or an em dash when the backend row never carried one. */
  figure(value: number | null): string {
    return value === null ? '—' : String(value);
  }

  /* ================================================================
     REQUESTS
     ================================================================ */

  private async fetchSummary(): Promise<OperationalCounts | null> {
    this.summaryStateSignal.set({ status: 'LOADING', data: null, error: '' });

    const response = await this.apiClient.getDashboardSummary();

    if (!response.success) {
      this.summaryStateSignal.set({
        status: 'ERROR',
        data: null,
        error: response.error.message || 'The backend summary could not be read.',
      });
      return null;
    }

    this.summaryStateSignal.set({ status: 'LOADED', data: response.data.summary, error: '' });
    return response.data.summary;
  }

  private async fetchReports(scope: ReportScopePayload, key: string): Promise<void> {
    const request = ++this.reportsRequest;

    this.reportsStateSignal.set({ status: 'LOADING', data: null, error: '', scopeKey: key });

    const response = await this.apiClient.getReports(scope);

    // A newer scope was requested meanwhile; its read owns the state now.
    if (request !== this.reportsRequest) {
      return;
    }

    this.reportsPending = null;

    if (!response.success) {
      this.reportsStateSignal.set({
        status: 'ERROR',
        data: null,
        error: response.error.message || 'The backend report could not be read.',
        scopeKey: key,
      });
      return;
    }

    this.reportsStateSignal.set({
      status: 'LOADED',
      data: this.normalizeReports(response.data),
      error: '',
      scopeKey: key,
    });
  }

  /* ================================================================
     ROW NORMALIZATION
     ================================================================ */

  private normalizeHomeRow(row: unknown, index: number): NormalizedHomeReport | null {
    const value = asRecord(row);

    if (!value) {
      return null;
    }

    const homeId = this.readString(value, 'id', 'shelterHomeId') ?? '';
    const name = this.readString(value, 'name', 'homeName');
    const homeCode = this.readString(value, 'homeCode', 'code');

    if (!homeId && !name && !homeCode) {
      return null;
    }

    return {
      key: rowKey(homeId, `${homeCode ?? ''}:${name ?? ''}`, index),
      homeId,
      name: name ?? this.getHomeName(homeId),
      homeCode: homeCode ?? this.getHomeCode(homeId),
      participants: this.readNumber(value, 'participants', 'participantCount'),
      boys: this.readNumber(value, 'boys', 'maleCount'),
      girls: this.readNumber(value, 'girls', 'femaleCount'),
      registrations: this.readNumber(value, 'registrations', 'registrationCount'),
      teams: this.readNumber(value, 'teams', 'teamCount'),
      attendance: this.readAttendance(value),
      finalizedSoloScores: this.readNumber(value, 'finalizedSoloScores', 'finalizedScores'),
      participantCertificates: this.readNumber(
        value,
        'participantCertificates',
        'certificates',
        'certificateCount'
      ),
    };
  }

  private normalizeEventRow(row: unknown, index: number): NormalizedEventReport | null {
    const value = asRecord(row);

    if (!value) {
      return null;
    }

    const eventId = this.readString(value, 'id', 'eventId') ?? '';
    const name = this.readString(value, 'name', 'eventName');
    const eventCode = this.readString(value, 'eventCode', 'code');

    if (!eventId && !name && !eventCode) {
      return null;
    }

    return {
      key: rowKey(eventId, `${eventCode ?? ''}:${name ?? ''}`, index),
      eventId,
      name: name ?? this.getEventName(eventId),
      eventCode: eventCode ?? this.getEventCode(eventId),
      category: this.readEnum<EventCategory>(value, 'category', EVENT_CATEGORIES),
      mode: this.readEnum<EventMode>(value, 'mode', EVENT_MODES),
      status: this.readEnum<EventStatus>(value, 'status', EVENT_STATUSES),
      registrations: this.readNumber(value, 'registrations', 'registrationCount'),
      teams: this.readNumber(value, 'teams', 'teamCount'),
      attendance: this.readAttendance(value),
      finalizedScores: this.readNumber(value, 'finalizedScores', 'finalizedScoreCount'),
      certificates: this.readCertificates(value),
    };
  }

  private normalizeParticipantRow(
    row: unknown,
    index: number
  ): NormalizedParticipantReport | null {
    const value = asRecord(row);

    if (!value) {
      return null;
    }

    const participantId = this.readString(value, 'id', 'participantId') ?? '';
    const fullName = this.readString(value, 'fullName', 'name');
    const participantCode = this.readString(value, 'participantCode', 'code');

    if (!participantId && !fullName && !participantCode) {
      return null;
    }

    const shelterHomeId = this.readString(value, 'shelterHomeId', 'homeId') ?? '';

    return {
      key: rowKey(participantId, `${participantCode ?? ''}:${fullName ?? ''}`, index),
      participantId,
      fullName: fullName ?? this.getParticipantName(participantId),
      participantCode: participantCode ?? this.getParticipantCode(participantId),
      shelterHomeId,
      // A home is only ever named through the readable helpers, so a report row
      // can never surface a raw shelter home id.
      homeName: this.readString(value, 'homeName', 'shelterHomeName') ?? this.getHomeName(shelterHomeId),
      homeCode: this.readString(value, 'homeCode', 'shelterHomeCode') ?? this.getHomeCode(shelterHomeId),
      level: this.readEnum<ParticipantLevel>(value, 'level', PARTICIPANT_LEVELS),
      registrations: this.readNumber(value, 'registrations', 'registrationCount'),
      attendance: this.readAttendance(value),
      finalizedSoloScores: this.readNumber(value, 'finalizedSoloScores', 'finalizedScores'),
      certificates: this.readNumber(value, 'certificates', 'certificateCount'),
    };
  }

  /** A collection is present only when the payload actually holds an array. */
  private collection(value: unknown): { present: boolean; rows: unknown[] } {
    return Array.isArray(value) ? { present: true, rows: value } : { present: false, rows: [] };
  }

  private readString(value: Record<string, unknown>, ...keys: readonly string[]): string | null {
    for (const key of keys) {
      const candidate = value[key];

      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  private readNumber(value: Record<string, unknown>, ...keys: readonly string[]): number | null {
    for (const key of keys) {
      const candidate = value[key];

      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private readEnum<T extends string>(
    value: Record<string, unknown>,
    key: string,
    allowed: readonly T[]
  ): T | null {
    const candidate = value[key];

    return typeof candidate === 'string' && (allowed as readonly string[]).includes(candidate)
      ? (candidate as T)
      : null;
  }

  /** Attendance is accepted nested under `attendance` or flattened on the row. */
  private readAttendance(value: Record<string, unknown>): AttendanceSummary | null {
    const nested = asRecord(value['attendance']);
    const source = nested ?? value;

    const summary: AttendanceSummary = {
      recorded: this.readNumber(source, 'recorded', 'attendanceRecorded'),
      present: this.readNumber(source, 'present', 'attendancePresent'),
      absent: this.readNumber(source, 'absent', 'attendanceAbsent'),
    };

    return summary.recorded === null && summary.present === null && summary.absent === null
      ? null
      : summary;
  }

  /** Certificates are accepted nested under `certificates` or flattened. */
  private readCertificates(value: Record<string, unknown>): CertificateSummary | null {
    const nested = asRecord(value['certificates']);
    const source = nested ?? value;

    const summary: CertificateSummary = {
      generated: this.readNumber(source, 'generated', 'certificatesGenerated'),
      issued: this.readNumber(source, 'issued', 'certificatesIssued'),
    };

    return summary.generated === null && summary.issued === null ? null : summary;
  }

  /* ================================================================
     READABLE LABELS FOR JOINED IDS
     An id is only ever used to look up a label in the shared store; it is
     never rendered.
     ================================================================ */

  private getEventName(eventId: string): string {
    return (eventId && this.shelterData.getEventById(eventId)?.name) || '—';
  }

  private getEventCode(eventId: string): string {
    return (eventId && this.shelterData.getEventById(eventId)?.eventCode) || '—';
  }

  private getParticipantName(participantId: string): string {
    return (
      (participantId &&
        this.shelterData.participants().find(participant => participant.id === participantId)
          ?.fullName) ||
      '—'
    );
  }

  private getParticipantCode(participantId: string): string {
    return (
      (participantId &&
        this.shelterData.participants().find(participant => participant.id === participantId)
          ?.participantCode) ||
      '—'
    );
  }
}

const EVENT_CATEGORIES: readonly EventCategory[] = ['ARTS', 'LITERARY', 'CULTURAL'];
const EVENT_MODES: readonly EventMode[] = ['SOLO', 'GROUP'];
const EVENT_STATUSES: readonly EventStatus[] = ['ACTIVE', 'CANCELLED', 'INACTIVE'];
const PARTICIPANT_LEVELS: readonly ParticipantLevel[] = [
  'SUB_JUNIOR',
  'JUNIOR',
  'SENIOR',
  'SUPER_SENIOR',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Stable identity of a report scope, used to deduplicate reads. */
function scopeKey(scope: ReportScopePayload): string {
  return JSON.stringify([scope.homeId ?? '', scope.eventId ?? '', scope.category ?? '']);
}

/**
 * A row key that is unique per collection. The backend id is preferred; a row
 * without one falls back to its readable identity plus its position, because
 * `@for` requires a unique track expression and the position is known here.
 */
function rowKey(id: string, identity: string, index: number): string {
  return id || `${identity}#${index}`;
}
