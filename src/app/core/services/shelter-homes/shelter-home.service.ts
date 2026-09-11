import { Injectable, signal } from '@angular/core';

import { ShelterHome } from '../../models';

@Injectable({
  providedIn: 'root'
})
export class ShelterHomeService {

  private readonly homes = signal<ShelterHome[]>([
    {
      id: 'SH-0001',
      homeCode: 'NK26-SH-001',

      name: 'Sample Shelter Home',
      address: 'Chennai, Tamil Nadu',
      contactPhone: '9000000000',
      transportationType: 'OWN_TRANSPORT',

      status: 'ACTIVE',
      validationStatus: 'PASSED',
      approvalStatus: 'APPROVED',
      lockStatus: 'LOCKED',

      version: 1,

      createdAt: new Date().toISOString(),
      createdBy: 'SYSTEM',

      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM'
    }
  ]);

  readonly homes$ = this.homes.asReadonly();

  getHomes(): ShelterHome[] {
    return this.homes();
  }

  getHomeById(id: string): ShelterHome | undefined {
    return this.homes().find(
      home => home.id === id
    );
  }

  addHome(home: ShelterHome): void {
    this.homes.update(current => [
      ...current,
      home
    ]);
  }

  updateHome(updatedHome: ShelterHome): void {
    this.homes.update(current =>
      current.map(home =>
        home.id === updatedHome.id
          ? {
              ...updatedHome,
              version: home.version + 1,
              updatedAt: new Date().toISOString()
            }
          : home
      )
    );
  }
}