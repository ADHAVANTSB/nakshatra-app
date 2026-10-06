import { Injectable, computed, inject } from '@angular/core';

import {
  PARTICIPANT_LEVEL_LABELS,
  NAKSHATRA_EVENT_RULES,
} from '../../constants/nakshatra-rules';

import {
  Gender,
  Participant,
  ParticipantLevel,
} from '../../models';

import { ApiClientService } from '../api/api-client.service';
import { ShelterDataService } from '../shelter-homes/shelter-data.service';

/**
 * Read access to backend participant records.
 *
 * Participants are owned by the Apps Script backend: they are created by the
 * Google Sheet connection flow and returned by `listParticipants(shelterHomeId)`.
 * There is deliberately no frontend participant dataset and no local mutation
 * path, so every module resolves participants through the same backend ids.
 */
@Injectable({
  providedIn: 'root'
})
export class ParticipantService {
  private readonly shelterData = inject(ShelterDataService);
  private readonly apiClient = inject(ApiClientService);

  readonly participants$ = this.shelterData.participants;

  readonly MAX_PARTICIPANTS_PER_HOME =
    NAKSHATRA_EVENT_RULES.maxParticipantsPerHome;

  readonly MIN_AGE = 1;
  readonly MAX_AGE = 19;

  readonly MIN_STANDARD = 1;
  readonly MAX_STANDARD = 12;

  /** True while backend participant records are being fetched. */
  readonly loading = this.shelterData.loading;

  readonly totalCount = computed(() => this.shelterData.totalParticipants());

  getParticipants(): Participant[] {
    return this.shelterData.participants();
  }

  getParticipantsByHomeId(shelterHomeId: string): Participant[] {
    return this.shelterData.getParticipantsByHomeId(shelterHomeId);
  }

  getParticipantById(id: string): Participant | undefined {
    return this.shelterData
      .participants()
      .find(participant => participant.id === id);
  }

  getParticipantCount(shelterHomeId: string): number {
    return this.shelterData.getParticipantCount(shelterHomeId);
  }

  getMaleCount(shelterHomeId: string): number {
    return this.getParticipantsByHomeId(shelterHomeId)
      .filter(participant => participant.gender === 'MALE')
      .length;
  }

  getFemaleCount(shelterHomeId: string): number {
    return this.getParticipantsByHomeId(shelterHomeId)
      .filter(participant => participant.gender === 'FEMALE')
      .length;
  }

  canAddParticipant(shelterHomeId: string): boolean {
    return (
      this.getParticipantCount(shelterHomeId) <
      this.MAX_PARTICIPANTS_PER_HOME
    );
  }

  getRemainingSlots(shelterHomeId: string): number {
    return Math.max(
      0,
      this.MAX_PARTICIPANTS_PER_HOME -
        this.getParticipantCount(shelterHomeId)
    );
  }

  /**
   * Nakshatra level band derived from age and standard.
   * Backend records carry their own calculated level; this mirrors the band so
   * a discrepancy between the sheet and the backend can be surfaced.
   */
  determineLevel(age: number, standard: number): ParticipantLevel | null {
    if (standard >= 1 && standard <= 3 && age <= 10) {
      return 'SUB_JUNIOR';
    }

    if (standard >= 4 && standard <= 6 && age <= 13) {
      return 'JUNIOR';
    }

    if (standard >= 7 && standard <= 9 && age <= 16) {
      return 'SENIOR';
    }

    if (standard >= 10 && standard <= 12 && age <= 19) {
      return 'SUPER_SENIOR';
    }

    return null;
  }

  /** Frontend consistency check over a backend participant record. */
  validateParticipant(participant: Participant): string[] {
    const errors: string[] = [];

    if (!participant.fullName || !participant.fullName.trim()) {
      errors.push('Participant name is required.');
    }

    if (
      participant.gender !== 'MALE' &&
      participant.gender !== 'FEMALE'
    ) {
      errors.push('Gender is required.');
    }

    if (
      participant.age < this.MIN_AGE ||
      participant.age > this.MAX_AGE
    ) {
      errors.push(
        `Age must be between ${this.MIN_AGE} and ${this.MAX_AGE}.`
      );
    }

    if (
      participant.standard < this.MIN_STANDARD ||
      participant.standard > this.MAX_STANDARD
    ) {
      errors.push(
        `Standard must be between ${this.MIN_STANDARD} and ${this.MAX_STANDARD}.`
      );
    }

    if (!participant.level) {
      errors.push('This participant has no calculated level.');
    }

    return errors;
  }

  levelLabel(level: ParticipantLevel | null): string {
    return level
      ? PARTICIPANT_LEVEL_LABELS[level]
      : 'No level';
  }

  /** Re-reads one participant; the backend is authoritative for the record. */
  async loadParticipant(participantId: string): Promise<Participant | null> {
    const response = await this.apiClient.getParticipant(participantId);
    return response.success ? response.data.participant : null;
  }

  /**
   * Persists an authorized participant edit through the backend.
   *
   * Only `fullName`, `gender`, `age` and `standard` are editable. Level,
   * eligibility, validation, approval, lock, version and ids are server-derived
   * and are never part of the payload. The record is re-read after a successful
   * write so the UI shows the persisted version.
   */
  async updateParticipant(
    participant: Participant,
    changes: EditableParticipantFields
  ): Promise<UpdateParticipantResult> {
    if (participant.lockStatus === 'LOCKED') {
      return {
        success: false,
        errors: ['This participant is locked and cannot be edited.'],
      };
    }

    const errors = this.validateEditableFields(changes);

    if (errors.length) {
      return { success: false, errors };
    }

    const response = await this.apiClient.updateParticipant({
      participantId: participant.id,
      expectedVersion: participant.version,
      fullName: changes.fullName.trim(),
      gender: changes.gender,
      age: changes.age,
      standard: changes.standard,
    });

    if (!response.success) {
      return { success: false, errors: [response.error.message], errorCode: response.error.code };
    }

    this.replaceParticipant(response.data.participant);

    return { success: true, participant: response.data.participant, errors: [] };
  }

  /** Replaces the cached record with a freshly read backend version. */
  replaceParticipant(participant: Participant): void {
    this.shelterData.replaceParticipant(participant);
  }

  private validateEditableFields(changes: EditableParticipantFields): string[] {
    const errors: string[] = [];

    if (!changes.fullName || !changes.fullName.trim()) {
      errors.push('Participant name is required.');
    }

    if (changes.gender !== 'MALE' && changes.gender !== 'FEMALE') {
      errors.push('Gender is required.');
    }

    if (!Number.isInteger(changes.age) || changes.age < this.MIN_AGE || changes.age > this.MAX_AGE) {
      errors.push(`Age must be between ${this.MIN_AGE} and ${this.MAX_AGE}.`);
    }

    if (
      !Number.isInteger(changes.standard) ||
      changes.standard < this.MIN_STANDARD ||
      changes.standard > this.MAX_STANDARD
    ) {
      errors.push(
        `Standard must be between ${this.MIN_STANDARD} and ${this.MAX_STANDARD}.`
      );
    }

    return errors;
  }
}

export interface EditableParticipantFields {
  fullName: string;
  gender: Gender;
  age: number;
  standard: number;
}

export interface UpdateParticipantResult {
  success: boolean;
  participant?: Participant;
  errors: string[];
  errorCode?: string;
}
