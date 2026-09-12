import { Injectable, computed, signal } from '@angular/core';
import {
  Event,
  EventCategory,
  EventMode,
  EventStatus,
  ParticipantLevel
} from '../../models';

@Injectable({
  providedIn: 'root'
})
export class EventService {

  private readonly events = signal<Event[]>([
    {
      id: 'EVT-0001',
      eventCode: 'ART-001',
      name: 'Clay Modelling',
      category: 'ARTS',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0002',
      eventCode: 'ART-002',
      name: 'Rangoli',
      category: 'ARTS',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0003',
      eventCode: 'ART-003',
      name: 'Greeting Card making',
      category: 'ARTS',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0004',
      eventCode: 'ART-004',
      name: 'Waste to wealth',
      category: 'ARTS',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0005',
      eventCode: 'ART-005',
      name: 'String Art',
      category: 'ARTS',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0006',
      eventCode: 'LIT-001',
      name: 'Group Discussion',
      category: 'LITERARY',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0007',
      eventCode: 'LIT-002',
      name: 'Story Telling (Tamil/English)',
      category: 'LITERARY',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0008',
      eventCode: 'LIT-003',
      name: 'Story Writing (Tamil/English)',
      category: 'LITERARY',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0009',
      eventCode: 'LIT-004',
      name: 'Potpurri (Words Play)',
      category: 'LITERARY',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0010',
      eventCode: 'LIT-005',
      name: 'Quiz (SJ + J)',
      category: 'LITERARY',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0011',
      eventCode: 'LIT-006',
      name: 'Quiz (S + SS)',
      category: 'LITERARY',
      mode: 'GROUP',
      eligibleLevels: [
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0012',
      eventCode: 'LIT-007',
      name: 'Block and Tackle',
      category: 'LITERARY',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0013',
      eventCode: 'CUL-001',
      name: 'Group Song',
      category: 'CULTURAL',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0014',
      eventCode: 'CUL-002',
      name: 'Skit (Tamil)',
      category: 'CULTURAL',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0015',
      eventCode: 'CUL-003',
      name: 'Group Dance',
      category: 'CULTURAL',
      mode: 'GROUP',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'EVT-0016',
      eventCode: 'CUL-004',
      name: 'Adapt Tune',
      category: 'CULTURAL',
      mode: 'SOLO',
      eligibleLevels: [
        'SUB_JUNIOR',
        'JUNIOR',
        'SENIOR',
        'SUPER_SENIOR'
      ],
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  readonly events$ = this.events.asReadonly();

  readonly activeEvents = computed(() =>
    this.events().filter(event => event.status === 'ACTIVE')
  );

  getAll(): Event[] {
    return this.events();
  }

  getById(id: string): Event | undefined {
    return this.events().find(event => event.id === id);
  }

  getByCategory(category: EventCategory): Event[] {
    return this.events().filter(
      event => event.category === category
    );
  }

  getByMode(mode: EventMode): Event[] {
    return this.events().filter(
      event => event.mode === mode
    );
  }

  getByLevel(level: ParticipantLevel): Event[] {
    return this.events().filter(
      event =>
        event.status === 'ACTIVE' &&
        event.eligibleLevels.includes(level)
    );
  }

  addEvent(event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): Event {

    const now = new Date().toISOString();

    const newEvent: Event = {
      ...event,
      id: `EVT-${Date.now()}`,
      createdAt: now,
      updatedAt: now
    };

    this.events.update(current => [
      ...current,
      newEvent
    ]);

    return newEvent;
  }

  updateEvent(
    id: string,
    changes: Partial<Omit<Event, 'id' | 'createdAt'>>
  ): boolean {

    const existing = this.getById(id);

    if (!existing) {
      return false;
    }

    this.events.update(current =>
      current.map(event =>
        event.id === id
          ? {
              ...event,
              ...changes,
              updatedAt: new Date().toISOString()
            }
          : event
      )
    );

    return true;
  }

  cancelEvent(id: string): boolean {
    return this.updateEvent(id, {
      status: 'CANCELLED'
    });
  }

  deactivateEvent(id: string): boolean {
    return this.updateEvent(id, {
      status: 'INACTIVE'
    });
  }

  activateEvent(id: string): boolean {
    return this.updateEvent(id, {
      status: 'ACTIVE'
    });
  }
}
