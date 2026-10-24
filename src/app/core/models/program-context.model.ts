/**
 * Program and zone scope model.
 *
 * A scope is chosen after sign-in: program first (Arts / Sports), then zone
 * (Zone 1 / Zone 2 / Test). The scope is presentation context only — it is NOT
 * (yet) enforced by the backend, so nothing here may claim data isolation.
 */

export type ProgramId = 'ARTS' | 'SPORTS';
export type ZoneId = 'ZONE_1' | 'ZONE_2' | 'TEST';
export type ScopeEnvironment = 'LIVE' | 'TEST';

export interface ProgramDefinition {
  id: ProgramId;
  label: string;
  tagline: string;
  /** Inline SVG path(s) rendered by the selection cards. */
  icon: 'arts' | 'sports';
}

export interface ZoneDefinition {
  id: ZoneId;
  label: string;
  /** Optional zone blurb; omitted for zones that show no extra copy. */
  description?: string;
  environment: ScopeEnvironment;
  /**
   * When true the zone card is not offered on the selection page. The scope
   * itself stays valid for seeded sessions, deep links and the backend.
   */
  hidden?: boolean;
  /**
   * Event date for the zone as `YYYY-MM-DD`, or undefined while the committee
   * has not confirmed it. Configured in program-context.config.ts — never
   * invented in the UI. When undefined the UI shows no date line at all.
   */
  date?: string;
  /** Shown instead of a date when the date is not confirmed yet. */
  dateNote?: string;
}

export interface ProgramScope {
  program: ProgramDefinition;
  zone: ZoneDefinition;
}
