import {
  Component,
  computed,
  inject,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { Participant } from '../../core/models';

import { ParticipantService }
  from '../../core/services/participants/participant.service';

import { ShelterHomeService }
  from '../../core/services/shelter-homes/shelter-home.service';


@Component({
  selector: 'nk-participants',

  imports: [
    FormsModule
  ],

  templateUrl: './participants.html',

  styleUrl: './participants.scss'
})
export class Participants {

  // =========================================================
  // SERVICES
  // =========================================================

  private readonly participantService =
    inject(ParticipantService);

  private readonly shelterHomeService =
    inject(ShelterHomeService);

  private readonly route =
    inject(ActivatedRoute);


  // =========================================================
  // STATE
  // =========================================================

  readonly selectedHomeId =
    signal<string | null>(null);

  readonly showAddForm =
    signal(false);

  readonly editingParticipant =
    signal<Participant | null>(null);

  readonly validationErrors =
    signal<string[]>([]);

  readonly successMessage =
    signal('');


  // =========================================================
  // FORM DATA
  // =========================================================

  participantName = '';

  gender:
    'MALE' |
    'FEMALE' |
    '' = '';

  age:
    number | null = null;

  standard:
    number | null = null;


  // =========================================================
  // DATA
  // =========================================================

  readonly homes =
    this.shelterHomeService.homes$;

  readonly allParticipants =
    this.participantService.participants$;


  readonly participants =
    computed(() => {

      const homeId =
        this.selectedHomeId();

      if (!homeId) {

        return this.allParticipants();

      }

      return this.participantService
        .getParticipantsByHomeId(
          homeId
        );

    });


  // =========================================================
  // INITIALIZE
  // =========================================================

  constructor() {

    this.route.queryParamMap
      .subscribe(params => {

        const homeId =
          params.get('homeId');

        this.selectedHomeId.set(
          homeId
        );

      });

  }


  // =========================================================
  // SELECT HOME
  // =========================================================

  selectHome(
    homeId: string
  ): void {

    this.selectedHomeId.set(
      homeId || null
    );

    this.clearMessages();

  }


  // =========================================================
  // OPEN ADD FORM
  // =========================================================

  openAddForm(): void {

    this.clearMessages();

    this.resetForm();

    this.editingParticipant.set(
      null
    );

    this.showAddForm.set(
      true
    );

  }


  // =========================================================
  // CLOSE FORM
  // =========================================================

  closeAddForm(): void {

    this.showAddForm.set(
      false
    );

    this.editingParticipant.set(
      null
    );

    this.clearMessages();

    this.resetForm();

  }


  // =========================================================
  // ADD PARTICIPANT
  // =========================================================

  addParticipant(): void {

    this.clearMessages();


    const homeId =
      this.selectedHomeId();


    // -------------------------------------------------------
    // HOME REQUIRED
    // -------------------------------------------------------

    if (!homeId) {

      this.validationErrors.set([
        'Please select a shelter home before adding a participant.'
      ]);

      return;

    }


    // -------------------------------------------------------
    // REQUIRED FIELDS
    // -------------------------------------------------------

    if (
      !this.participantName.trim() ||
      !this.gender ||
      this.age === null ||
      this.standard === null
    ) {

      this.validationErrors.set([
        'Please complete all participant fields.'
      ]);

      return;

    }


    // -------------------------------------------------------
    // CREATE PARTICIPANT
    // -------------------------------------------------------

    const now =
      new Date().toISOString();

    const participantCount =
      this.participantService
        .getParticipantCount(
          homeId
        );


    const participant: Participant = {

      id:
        `P-${Date.now()}`,

      participantCode:
        `NK26-${homeId}-${String(
          participantCount + 1
        ).padStart(3, '0')}`,

      shelterHomeId:
        homeId,

      fullName:
        this.participantName.trim(),

      gender:
        this.gender,

      age:
        this.age,

      standard:
        this.standard,

      level:
        this.participantService
          .determineLevel(
            this.age,
            this.standard
          ),

      eligibilityStatus:
        'ELIGIBLE',

      validationStatus:
        'PASSED',

      approvalStatus:
        'PENDING',

      lockStatus:
        'UNLOCKED',

      version:
        1,

      sourceRowNumber:
        0,

      createdAt:
        now,

      createdBy:
        'ADMIN',

      updatedAt:
        now,

      updatedBy:
        'ADMIN'

    };


    // -------------------------------------------------------
    // SERVICE VALIDATION
    // -------------------------------------------------------

    const result =
      this.participantService
        .addParticipant(
          participant
        );


    if (!result.success) {

      this.validationErrors.set(
        result.errors
      );

      return;

    }


    // -------------------------------------------------------
    // SUCCESS
    // -------------------------------------------------------

    this.successMessage.set(
      `${participant.fullName} has been added successfully.`
    );

    this.resetForm();

    this.showAddForm.set(
      false
    );

  }


  // =========================================================
  // EDIT PARTICIPANT
  // =========================================================

  editParticipant(
    participant: Participant
  ): void {

    // -------------------------------------------------------
    // LOCK CHECK
    // -------------------------------------------------------

    if (
      participant.lockStatus === 'LOCKED'
    ) {

      this.validationErrors.set([
        'This participant is locked and cannot be edited.'
      ]);

      return;

    }


    this.clearMessages();


    // -------------------------------------------------------
    // LOAD EXISTING DATA INTO FORM
    // -------------------------------------------------------

    this.participantName =
      participant.fullName;

    this.gender =
      participant.gender;

    this.age =
      participant.age;

    this.standard =
      participant.standard;


    this.editingParticipant.set(
      participant
    );

    this.showAddForm.set(
      true
    );

  }


  // =========================================================
  // SAVE EDITED PARTICIPANT
  // =========================================================

  saveEditedParticipant(): void {

    const existing =
      this.editingParticipant();


    if (!existing) {

      return;

    }


    this.clearMessages();


    // -------------------------------------------------------
    // REQUIRED FIELDS
    // -------------------------------------------------------

    if (
      !this.participantName.trim() ||
      !this.gender ||
      this.age === null ||
      this.standard === null
    ) {

      this.validationErrors.set([
        'Please complete all participant fields.'
      ]);

      return;

    }


    // -------------------------------------------------------
    // CREATE UPDATED OBJECT
    // -------------------------------------------------------

    const updatedParticipant: Participant = {

      ...existing,

      fullName:
        this.participantName.trim(),

      gender:
        this.gender,

      age:
        this.age,

      standard:
        this.standard,

      level:
        this.participantService
          .determineLevel(
            this.age,
            this.standard
          )

    };


    // -------------------------------------------------------
    // SERVICE UPDATE
    // -------------------------------------------------------

    const result =
      this.participantService
        .updateParticipant(
          updatedParticipant
        );


    if (!result.success) {

      this.validationErrors.set(
        result.errors
      );

      return;

    }


    // -------------------------------------------------------
    // SUCCESS
    // -------------------------------------------------------

    this.successMessage.set(
      `${updatedParticipant.fullName} was updated successfully.`
    );

    this.showAddForm.set(
      false
    );

    this.editingParticipant.set(
      null
    );

    this.resetForm();

  }


  // =========================================================
  // CANCEL EDIT
  // =========================================================

  cancelEdit(): void {

    this.showAddForm.set(
      false
    );

    this.editingParticipant.set(
      null
    );

    this.resetForm();

    this.clearMessages();

  }


  // =========================================================
  // LOCK PARTICIPANT
  // =========================================================

  lockParticipant(
    participantId: string
  ): void {

    this.clearMessages();


    const success =
      this.participantService
        .lockParticipant(
          participantId
        );


    if (!success) {

      this.validationErrors.set([
        'Participant could not be locked.'
      ]);

      return;

    }


    this.successMessage.set(
      'Participant has been locked successfully.'
    );

  }

  unlockParticipant(
    participantId: string
  ): void {

    this.clearMessages();

    const success =
      this.participantService
        .unlockParticipant(participantId);

    if (!success) {
      this.validationErrors.set([
        'Participant could not be unlocked.'
      ]);
      return;
    }

    this.successMessage.set(
      'Participant has been unlocked successfully.'
    );
  }


  // =========================================================
  // GET LEVEL LABEL
  // =========================================================

  getLevelLabel(
    level: string | null
  ): string {

    switch (level) {

      case 'SUB_JUNIOR':
        return 'Sub Juniors';

      case 'JUNIOR':
        return 'Juniors';

      case 'SENIOR':
        return 'Seniors';

      case 'SUPER_SENIOR':
        return 'Super Seniors';

      default:
        return 'Not Eligible';

    }

  }


  // =========================================================
  // GET HOME NAME
  // =========================================================

  getHomeName(
    homeId: string
  ): string {

    return this.shelterHomeService
      .getHomeById(homeId)
      ?.name ??
      'Unknown Home';

  }


  // =========================================================
  // REMAINING SLOTS
  // =========================================================

  getRemainingSlots(): number {

    const homeId =
      this.selectedHomeId();


    if (!homeId) {

      return 0;

    }


    return this.participantService
      .getRemainingSlots(
        homeId
      );

  }


  // =========================================================
  // RESET FORM
  // =========================================================

  resetForm(): void {

    this.participantName = '';

    this.gender = '';

    this.age = null;

    this.standard = null;

  }


  // =========================================================
  // CLEAR MESSAGES
  // =========================================================

  clearMessages(): void {

    this.validationErrors.set([]);

    this.successMessage.set('');

  }

}
