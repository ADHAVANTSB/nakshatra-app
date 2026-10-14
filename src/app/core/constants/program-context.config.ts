import {
  type ProgramDefinition,
  type ZoneDefinition,
} from '../models/program-context.model';

/**
 * Program and zone catalogue plus the storage key for the selected scope.
 *
 * CONFIGURABLE VALUES: zone dates live here and nowhere else. ZONE_1 and
 * ZONE_2 dates were supplied by the programme team (2026-10-25 / 2026-11-01);
 * the Test zone date stays undefined until it is confirmed, and the UI shows a
 * "to be confirmed" note instead of an invented date.
 */

export const PROGRAMS: readonly ProgramDefinition[] = [
  {
    id: 'ARTS',
    label: 'Arts',
    tagline: 'Arts, Literary and Cultural events',
    icon: 'arts',
  },
  {
    id: 'SPORTS',
    label: 'Sports',
    tagline: 'Sports meets and tournaments',
    icon: 'sports',
  },
] as const;

export const ZONES: readonly ZoneDefinition[] = [
  {
    id: 'ZONE_1',
    label: 'Zone 1',
    description: 'Programme zone 1',
    environment: 'LIVE',
    date: '2026-10-25',
  },
  {
    id: 'ZONE_2',
    label: 'Zone 2',
    description: 'Programme zone 2',
    environment: 'LIVE',
    date: '2026-11-01',
  },
  {
    id: 'TEST',
    label: 'Test',
    description: 'Rehearsal scope intended to use isolated test data',
    environment: 'TEST',
    dateNote: 'Test date to be confirmed',
  },
] as const;

export const PROGRAM_SCOPE_STORAGE_KEY = 'nakshatra.programScope';

/**
 * Shown wherever scope is displayed. Scope is persisted on the server-side
 * session and enforced by the backend on every scoped read and write.
 */
export const SCOPE_NOTE =
  'Program and zone selection is stored on your server-side session and enforced by the backend on every request.';
