import { Injectable, computed, inject } from '@angular/core';

import { ConnectedShelterHome, ShelterHome } from '../../models';

import { ShelterDataService } from './shelter-data.service';

/**
 * Projects backend-connected shelter homes into the frontend read model.
 *
 * There is no frontend-only shelter home dataset: every record originates from
 * `listShelterHomes()`. Shelter home registration and Google Sheet connection
 * live exclusively in the /homes module.
 */
@Injectable({
  providedIn: 'root'
})
export class ShelterHomeService {
  private readonly shelterData = inject(ShelterDataService);

  readonly homes$ = computed(() =>
    this.shelterData.homes().map(home => this.toShelterHome(home))
  );

  getHomes(): ShelterHome[] {
    return this.homes$();
  }

  getHomeById(id: string): ShelterHome | undefined {
    return this.homes$().find(home => home.id === id);
  }

  getConnectedHomeById(id: string): ConnectedShelterHome | undefined {
    return this.shelterData.getHomeById(id);
  }

  getParticipantCount(id: string): number {
    return this.shelterData.getParticipantCount(id);
  }

  private toShelterHome(home: ConnectedShelterHome): ShelterHome {
    return {
      id: home.id,
      homeCode: home.homeCode,
      name: home.homeName,
      address: home.address,
      contactName: home.contactName,
      contactPhone: home.contactPhone,
      spreadsheetName: home.spreadsheetName,
      spreadsheetOpenUrl: home.spreadsheetOpenUrl,
      sourceStatus: home.sourceStatus,
      currentImportVersionId: home.currentImportVersionId,
      lastSyncedAt: home.lastSyncedAt,
      // The backend contract carries no transportation preference.
      transportationType: 'TO_BE_ARRANGED',
      status: home.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      version: home.version,
      createdAt: '',
      createdBy: 'BACKEND',
      updatedAt: '',
      updatedBy: 'BACKEND',
    };
  }
}
