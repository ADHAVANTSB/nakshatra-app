import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { ParticipantService } from '../../core/services/participants/participant.service';

@Component({
  selector: 'nk-homes',
  imports: [],
  templateUrl: './homes.html',
  styleUrl: './homes.scss',
})
export class Homes {

  // ---------------------------------------------------------
  // SERVICES
  // ---------------------------------------------------------

  private readonly shelterHomeService =
    inject(ShelterHomeService);

  private readonly participantService =
    inject(ParticipantService);

  private readonly router =
    inject(Router);


  // ---------------------------------------------------------
  // SHELTER HOMES
  // ---------------------------------------------------------

  readonly homes =
    this.shelterHomeService.homes$;


  // ---------------------------------------------------------
  // PARTICIPANT COUNT
  // ---------------------------------------------------------

  getParticipantCount(
    homeId: string
  ): number {

    return this.participantService
      .getParticipantCount(homeId);
  }


  // ---------------------------------------------------------
  // BOYS COUNT
  // ---------------------------------------------------------

  getMaleCount(
    homeId: string
  ): number {

    return this.participantService
      .getMaleCount(homeId);
  }


  // ---------------------------------------------------------
  // GIRLS COUNT
  // ---------------------------------------------------------

  getFemaleCount(
    homeId: string
  ): number {

    return this.participantService
      .getFemaleCount(homeId);
  }


  // ---------------------------------------------------------
  // VIEW PARTICIPANTS
  // ---------------------------------------------------------

  viewParticipants(
    homeId: string
  ): void {

    this.router.navigate(
      ['/participants'],
      {
        queryParams: {
          homeId
        }
      }
    );
  }


  // ---------------------------------------------------------
  // VIEW HOME
  // ---------------------------------------------------------

  viewHome(
    homeId: string
  ): void {

    this.router.navigate(
      ['/homes'],
      {
        queryParams: {
          homeId
        }
      }
    );
  }

}