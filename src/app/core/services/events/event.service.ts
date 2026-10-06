import { Injectable, computed, inject } from '@angular/core';

import {
  Event,
  EventCategory,
  EventMode,
  ParticipantLevel
} from '../../models';

import { ShelterDataService } from '../shelter-homes/shelter-data.service';

/**
 * Event master data.
 *
 * The backend owns the event catalogue, so events are read from the shared
 * backend store (`listEvents`). There is no local seed and no frontend write
 * path: the frontend never fabricates an event.
 */
@Injectable({
  providedIn: 'root'
})
export class EventService {

  private readonly shelterData = inject(ShelterDataService);

  readonly events$ = this.shelterData.events;

  readonly activeEvents = computed(() =>
    this.events$().filter(event => event.status === 'ACTIVE')
  );

  readonly loading = this.shelterData.loadingEvents;
  readonly loaded = this.shelterData.eventsLoaded;
  readonly loadError = this.shelterData.eventsError;

  /** Reads the event master from the backend. */
  load(): Promise<Event[] | null> {
    return this.shelterData.loadEvents();
  }

  getAll(): Event[] {
    return this.events$();
  }

  getById(id: string): Event | undefined {
    return this.events$().find(event => event.id === id);
  }

  getByCategory(category: EventCategory): Event[] {
    return this.events$().filter(
      event => event.category === category
    );
  }

  getByMode(mode: EventMode): Event[] {
    return this.events$().filter(
      event => event.mode === mode
    );
  }

  getByLevel(level: ParticipantLevel): Event[] {
    return this.events$().filter(
      event =>
        event.status === 'ACTIVE' &&
        event.eligibleLevels.includes(level)
    );
  }
}
