import { Injectable, signal } from '@angular/core';

import {
  Participant,
  ParticipantLevel
} from '../../models';

@Injectable({
  providedIn: 'root'
})
export class ParticipantService {

  // =========================================================
  // RULES
  // =========================================================

  readonly MAX_PARTICIPANTS_PER_HOME = 35;

  readonly MIN_AGE = 1;
  readonly MAX_AGE = 19;

  readonly MIN_STANDARD = 1;
  readonly MAX_STANDARD = 12;


  // =========================================================
  // TEMPORARY DEVELOPMENT DATA
  // =========================================================

  private readonly participants =
    signal<Participant[]>([

      {
        id: 'P-0001',

        participantCode:
          'NK26-SH-001-P001',

        shelterHomeId:
          'SH-0001',

        fullName:
          'Sample Participant',

        gender:
          'MALE',

        age:
          10,

        standard:
          3,

        level:
          'SUB_JUNIOR',

        eligibilityStatus:
          'ELIGIBLE',

        validationStatus:
          'PASSED',

        approvalStatus:
          'APPROVED',

        lockStatus:
          'LOCKED',

        version:
          1,

        sourceRowNumber:
          24,

        createdAt:
          new Date().toISOString(),

        createdBy:
          'SYSTEM',

        updatedAt:
          new Date().toISOString(),

        updatedBy:
          'SYSTEM'
      }

    ]);


  // =========================================================
  // READ-ONLY SIGNAL
  // =========================================================

  readonly participants$ =
    this.participants.asReadonly();


  // =========================================================
  // GET ALL
  // =========================================================

  getParticipants(): Participant[] {

    return this.participants();

  }


  // =========================================================
  // GET BY HOME
  // =========================================================

  getParticipantsByHomeId(
    shelterHomeId: string
  ): Participant[] {

    return this.participants()
      .filter(
        participant =>
          participant.shelterHomeId ===
          shelterHomeId
      );

  }


  // =========================================================
  // GET BY ID
  // =========================================================

  getParticipantById(
    id: string
  ): Participant | undefined {

    return this.participants()
      .find(
        participant =>
          participant.id === id
      );

  }


  // =========================================================
  // COUNT
  // =========================================================

  getParticipantCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .length;

  }


  // =========================================================
  // MALE COUNT
  // =========================================================

  getMaleCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .filter(
        participant =>
          participant.gender === 'MALE'
      )
      .length;

  }


  // =========================================================
  // FEMALE COUNT
  // =========================================================

  getFemaleCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .filter(
        participant =>
          participant.gender === 'FEMALE'
      )
      .length;

  }


  // =========================================================
  // CHECK HOME CAPACITY
  // =========================================================

  canAddParticipant(
    shelterHomeId: string
  ): boolean {

    return this.getParticipantCount(
      shelterHomeId
    ) < this.MAX_PARTICIPANTS_PER_HOME;

  }


  // =========================================================
  // REMAINING SLOTS
  // =========================================================

  getRemainingSlots(
    shelterHomeId: string
  ): number {

    return Math.max(
      0,
      this.MAX_PARTICIPANTS_PER_HOME -
      this.getParticipantCount(shelterHomeId)
    );

  }


  // =========================================================
  // DETERMINE LEVEL
  // =========================================================

  determineLevel(
    age: number,
    standard: number
  ): ParticipantLevel | null {

    // Sub Juniors
    if (
      standard >= 1 &&
      standard <= 3 &&
      age <= 10
    ) {

      return 'SUB_JUNIOR';

    }


    // Juniors
    if (
      standard >= 4 &&
      standard <= 6 &&
      age <= 13
    ) {

      return 'JUNIOR';

    }


    // Seniors
    if (
      standard >= 7 &&
      standard <= 9 &&
      age <= 16
    ) {

      return 'SENIOR';

    }


    // Super Seniors
    if (
      standard >= 10 &&
      standard <= 12 &&
      age <= 19
    ) {

      return 'SUPER_SENIOR';

    }


    return null;

  }


  // =========================================================
  // VALIDATE PARTICIPANT
  // =========================================================

  validateParticipant(
    participant: Participant
  ): string[] {

    const errors: string[] = [];


    // Name
    if (
      !participant.fullName ||
      !participant.fullName.trim()
    ) {

      errors.push(
        'Participant name is required.'
      );

    }


    // Gender
    if (
      participant.gender !== 'MALE' &&
      participant.gender !== 'FEMALE'
    ) {

      errors.push(
        'Gender is required.'
      );

    }


    // Age
    if (
      participant.age < this.MIN_AGE ||
      participant.age > this.MAX_AGE
    ) {

      errors.push(
        `Age must be between ${this.MIN_AGE} and ${this.MAX_AGE}.`
      );

    }


    // Standard
    if (
      participant.standard < this.MIN_STANDARD ||
      participant.standard > this.MAX_STANDARD
    ) {

      errors.push(
        `Standard must be between ${this.MIN_STANDARD} and ${this.MAX_STANDARD}.`
      );

    }


    // Level
    const level =
      this.determineLevel(
        participant.age,
        participant.standard
      );


    if (!level) {

      errors.push(
        'Age and Standard combination is not eligible.'
      );

    }


    return errors;

  }


  // =========================================================
  // PREPARE PARTICIPANT
  // =========================================================

  prepareParticipant(
    participant: Participant
  ): Participant {

    const level =
      this.determineLevel(
        participant.age,
        participant.standard
      );

    return {
      ...participant,
      level,
      eligibilityStatus:
        level ? 'ELIGIBLE' : 'INELIGIBLE'
    };

  }


  // =========================================================
  // ADD PARTICIPANT
  // =========================================================

  addParticipant(
    participant: Participant
  ): {
    success: boolean;
    errors: string[];
  } {

    const errors =
      this.validateParticipant(
        participant
      );


    if (errors.length > 0) {

      return {
        success: false,
        errors
      };

    }


    if (
      !this.canAddParticipant(
        participant.shelterHomeId
      )
    ) {

      return {
        success: false,
        errors: [
          'This shelter home already has the maximum of 35 participants.'
        ]
      };

    }


    const prepared =
      this.prepareParticipant(
        participant
      );


    this.participants.update(
      current => [
        ...current,
        prepared
      ]
    );


    return {
      success: true,
      errors: []
    };

  }


  // =========================================================
  // UPDATE PARTICIPANT
  // =========================================================

  updateParticipant(
    updatedParticipant: Participant
  ): {
    success: boolean;
    errors: string[];
  } {

    const errors =
      this.validateParticipant(
        updatedParticipant
      );


    if (errors.length > 0) {

      return {
        success: false,
        errors
      };

    }


    const existing =
      this.getParticipantById(
        updatedParticipant.id
      );


    if (!existing) {

      return {
        success: false,
        errors: [
          'Participant could not be found.'
        ]
      };

    }


    const prepared =
      this.prepareParticipant(
        updatedParticipant
      );


    this.participants.update(
      current =>
        current.map(
          participant =>

            participant.id ===
            prepared.id

              ? {
                  ...prepared,

                  version:
                    participant.version + 1,

                  updatedAt:
                    new Date().toISOString()
                }

              : participant
        )
    );


    return {
      success: true,
      errors: []
    };

  }
    // =========================================================
  // LOCK PARTICIPANT
  // =========================================================

  lockParticipant(
    participantId: string
  ): boolean {

    const participant =
      this.getParticipantById(
        participantId
      );

    if (!participant) {

      return false;

    }

    this.participants.update(
      current =>
        current.map(
          item =>

            item.id === participantId

              ? {
                  ...item,

                  lockStatus:
                    'LOCKED',

                  updatedAt:
                    new Date().toISOString(),

                  updatedBy:
                    'ADMIN'
                }

              : item
        )
    );

    return true;

  }


  // =========================================================
  // UNLOCK PARTICIPANT
  // =========================================================

  unlockParticipant(
    participantId: string
  ): boolean {

    const participant =
      this.getParticipantById(
        participantId
      );

    if (!participant) {

      return false;

    }

    this.participants.update(
      current =>
        current.map(
          item =>

            item.id === participantId

              ? {
                  ...item,

                  lockStatus:
                    'UNLOCKED',

                  updatedAt:
                    new Date().toISOString(),

                  updatedBy:
                    'ADMIN'
                }

              : item
        )
    );

    return true;

  }

}