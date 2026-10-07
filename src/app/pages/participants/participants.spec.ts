import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Participant, ParticipantEvent } from '../../core/models';
import { Participants, RegistrationEntry } from './participants';

/**
 * Detail-panel presentation tests.
 *
 * These exercise the pure presentation helpers of the all-in-one detail view:
 * the ACTIVE registration count, category grouping, the "Open event" link
 * target and the source labels. No backend call is made — the component is
 * created without change detection so `ngOnInit` never starts a refresh, and
 * registration state is set directly.
 */

function registration(overrides: Partial<ParticipantEvent>): ParticipantEvent {
  return {
    id: 'reg-1',
    participantId: 'participant-1',
    eventId: 'event-1',
    registrationStatus: 'REGISTERED',
    version: 1,
    ...overrides,
  };
}

function entry(
  registrationOverrides: Partial<ParticipantEvent>,
  overrides: Partial<RegistrationEntry> = {}
): RegistrationEntry {
  const registrationRow = registration(registrationOverrides);

  return {
    registration: registrationRow,
    name: registrationRow.eventName ?? 'Event not in the current event list',
    category: registrationRow.category,
    mode: registrationRow.mode,
    categoryKnown: !!registrationRow.category,
    ...overrides,
  };
}

describe('Participants — detail panel presentation', () => {
  let component: Participants;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Participants],
      providers: [provideRouter([])],
    }).compileComponents();

    component = TestBed.createComponent(Participants).componentInstance;
  });

  describe('activeRegistrationCount', () => {
    it('counts only REGISTERED registrations', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', registrationStatus: 'REGISTERED' }),
        registration({ id: 'reg-2', eventId: 'event-2', registrationStatus: 'CANCELLED' }),
        registration({ id: 'reg-3', eventId: 'event-3', registrationStatus: 'WAITLISTED' }),
        registration({ id: 'reg-4', eventId: 'event-4', registrationStatus: 'REGISTERED' }),
      ]);

      expect(component.activeRegistrationCount()).toBe(2);
    });

    it('reports zero while registrations have not been read yet', () => {
      expect(component.activeRegistrationCount()).toBe(0);
    });
  });

  describe('eventGroups', () => {
    it('follows the ARTS / LITERARY / CULTURAL order', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', category: 'CULTURAL' }),
        registration({ id: 'reg-2', eventId: 'event-2', category: 'ARTS' }),
        registration({ id: 'reg-3', eventId: 'event-3', category: 'LITERARY' }),
      ]);

      expect(component.eventGroups().map(group => group.category))
        .toEqual(['ARTS', 'LITERARY', 'CULTURAL']);
    });

    it('hides categories the participant has no registration for', () => {
      component.registrations.set([
        registration({ id: 'reg-1', eventId: 'event-1', category: 'CULTURAL' }),
      ]);

      expect(component.eventGroups().map(group => group.category)).toEqual(['CULTURAL']);
    });
  });

  describe('eventLinkTarget', () => {
    it('returns the registration event id when one exists', () => {
      const resolved = entry({ eventId: 'event-9' });

      expect(component.eventLinkTarget(resolved)).toBe('event-9');
    });

    it('returns null so no link is rendered for a row without an event id', () => {
      const resolved = entry({ eventId: '', eventName: 'Group Song' });

      expect(component.eventLinkTarget(resolved)).toBeNull();
    });
  });

  describe('source labels', () => {
    const participant = {
      id: 'participant-1',
      participantCode: 'P-0001',
      shelterHomeId: 'home-1',
      fullName: 'Test Participant',
      gender: 'MALE',
      age: 10,
      standard: 5,
      level: 'JUNIOR',
      eligibilityStatus: 'ELIGIBLE',
      validationStatus: 'PASSED',
      approvalStatus: 'APPROVED',
      lockStatus: 'UNLOCKED',
      version: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    } as Participant;

    it('shows an em dash when the source version is absent', () => {
      expect(component.sourceVersionLabel({ ...participant, sourceVersionId: undefined }))
        .toBe('—');
    });

    it('abbreviates a present source version id', () => {
      const label = component.sourceVersionLabel({
        ...participant,
        sourceVersionId: 'import-version-0001-abcd',
      });

      expect(label).not.toBe('—');
      expect(label.length).toBeLessThan('import-version-0001-abcd'.length);
    });

    it('shows an em dash when the source row is absent', () => {
      expect(component.sourceRowLabel({ ...participant, sourceRowNumber: undefined }))
        .toBe('—');
    });

    it('shows the sheet row when present', () => {
      expect(component.sourceRowLabel({ ...participant, sourceRowNumber: 12 }))
        .toBe('Sheet row 12');
    });
  });
});
