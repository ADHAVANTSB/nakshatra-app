import { Injectable, signal } from '@angular/core';

import {
  Participant,
  ParticipantLevel
} from '../../models';

@Injectable({
  providedIn: 'root'
})
export class ParticipantService {

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


  // ---------------------------------------------------------
  // READ ONLY SIGNAL
  // ---------------------------------------------------------

  readonly participants$ =
    this.participants.asReadonly();


  // ---------------------------------------------------------
  // GET ALL PARTICIPANTS
  // ---------------------------------------------------------

  getParticipants():
    Participant[] {

    return this.participants();

  }


  // ---------------------------------------------------------
  // GET PARTICIPANTS BY HOME
  // ---------------------------------------------------------

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


  // ---------------------------------------------------------
  // GET PARTICIPANT
  // ---------------------------------------------------------

  getParticipantById(
    id: string
  ): Participant | undefined {

    return this.participants()
      .find(
        participant =>
          participant.id === id
      );

  }


  // ---------------------------------------------------------
  // ADD PARTICIPANT
  // ---------------------------------------------------------

  addParticipant(
    participant: Participant
  ): void {

    this.participants.update(
      current => [
        ...current,
        participant
      ]
    );

  }


  // ---------------------------------------------------------
  // UPDATE PARTICIPANT
  // ---------------------------------------------------------

  updateParticipant(
    updatedParticipant: Participant
  ): void {

    this.participants.update(
      current =>
        current.map(
          participant =>

            participant.id ===
            updatedParticipant.id

              ? {
                  ...updatedParticipant,

                  version:
                    participant.version + 1,

                  updatedAt:
                    new Date().toISOString()
                }

              : participant
        )
    );

  }


  // ---------------------------------------------------------
  // PARTICIPANT COUNT
  // ---------------------------------------------------------

  getParticipantCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .length;

  }


  // ---------------------------------------------------------
  // BOYS COUNT
  // ---------------------------------------------------------

  getMaleCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .filter(
        participant =>
          participant.gender ===
          'MALE'
      )
      .length;

  }


  // ---------------------------------------------------------
  // GIRLS COUNT
  // ---------------------------------------------------------

  getFemaleCount(
    shelterHomeId: string
  ): number {

    return this
      .getParticipantsByHomeId(
        shelterHomeId
      )
      .filter(
        participant =>
          participant.gender ===
          'FEMALE'
      )
      .length;

  }


  // ---------------------------------------------------------
  // DETERMINE PARTICIPANT LEVEL
  // ---------------------------------------------------------

  determineLevel(
    age: number,
    standard: number
  ): ParticipantLevel | null {

    if (
      standard >= 1 &&
      standard <= 3 &&
      age <= 10
    ) {

      return 'SUB_JUNIOR';

    }


    if (
      standard >= 4 &&
      standard <= 6 &&
      age <= 13
    ) {

      return 'JUNIOR';

    }


    if (
      standard >= 7 &&
      standard <= 9 &&
      age <= 16
    ) {

      return 'SENIOR';

    }


    if (
      standard >= 10 &&
      standard <= 12 &&
      age <= 19
    ) {

      return 'SUPER_SENIOR';

    }


    return null;

  }


  // ---------------------------------------------------------
  // VALIDATE PARTICIPANT
  // ---------------------------------------------------------

  validateParticipant(
    participant: Participant
  ): string[] {

    const errors: string[] = [];


    if (
      !participant.fullName.trim()
    ) {

      errors.push(
        'Participant name is required.'
      );

    }


    if (
      participant.age < 1 ||
      participant.age > 19
    ) {

      errors.push(
        'Age must be between 1 and 19.'
      );

    }


    if (
      participant.standard < 1 ||
      participant.standard > 12
    ) {

      errors.push(
        'Standard must be between 1 and 12.'
      );

    }


    const calculatedLevel =
      this.determineLevel(
        participant.age,
        participant.standard
      );


    if (!calculatedLevel) {

      errors.push(
        'Age and Standard combination is not eligible.'
      );

    }


    return errors;

  }

}