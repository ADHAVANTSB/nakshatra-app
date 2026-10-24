import {
  type ProgramDefinition,
  type ZoneDefinition,
} from '../models/program-context.model';

/**
 * Program and zone catalogue plus the storage key for the selected scope.
 *
 * CONFIGURABLE VALUES: zone dates live here and nowhere else. ZONE_1 and
 * ZONE_2 dates were supplied by the programme team (2026-10-25 / 2026-11-01);
 * the event (TEST) zone carries no date and no blurb — the UI shows neither
 * instead of inventing one.
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
  // Hidden from the zone-selection page by organiser decision (2026-10-25):
  // only the event card is offered. The scopes stay valid for seeded sessions,
  // deep links and the backend — nothing else changes.
  {
    id: 'ZONE_1',
    label: 'Zone 1',
    description: 'Programme zone 1',
    environment: 'LIVE',
    date: '2026-10-25',
    hidden: true,
  },
  {
    id: 'ZONE_2',
    label: 'Zone 2',
    description: 'Programme zone 2',
    environment: 'LIVE',
    date: '2026-11-01',
    hidden: true,
  },
  {
    id: 'TEST',
    label: 'Nakshatra Arts 25OCT',
    environment: 'TEST',
  },
] as const;

export const PROGRAM_SCOPE_STORAGE_KEY = 'nakshatra.programScope';

/**
 * Shown wherever scope is displayed. Scope is persisted on the server-side
 * session and enforced by the backend on every scoped read and write.
 */
export const SCOPE_NOTE =
  'Program and zone selection is stored on your server-side session and enforced by the backend on every request.';
