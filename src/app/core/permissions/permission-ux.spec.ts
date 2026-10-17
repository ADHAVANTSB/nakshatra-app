import { describe, expect, it } from 'vitest';

import { canEditModule } from './role-matrix';
import { friendlyError } from './friendly-error';

describe('canEditModule (approved role permission table)', () => {
  it('grants Support/Admin edit access everywhere', () => {
    for (const role of ['ADMIN', 'SUPPORT']) {
      expect(canEditModule(role, 'SCORING')).toBe(true);
      expect(canEditModule(role, 'SETTINGS')).toBe(true);
    }
  });

  it('limits Liaison to Homes and Participants edits', () => {
    expect(canEditModule('LIAISON_TEAM', 'HOMES')).toBe(true);
    expect(canEditModule('LIAISON_TEAM', 'PARTICIPANTS')).toBe(true);
    expect(canEditModule('LIAISON_TEAM', 'SCORING')).toBe(false);
    expect(canEditModule('LIAISON_TEAM', 'ATTENDANCE')).toBe(false);
  });

  it('limits Events to Attendance and Scoring edits', () => {
    expect(canEditModule('EVENTS_TEAM', 'ATTENDANCE')).toBe(true);
    expect(canEditModule('EVENTS_TEAM', 'SCORING')).toBe(true);
    expect(canEditModule('EVENTS_TEAM', 'EVENTS')).toBe(false);
    expect(canEditModule('EVENTS_TEAM', 'HOMES')).toBe(false);
  });

  it('limits Certificates to Result Approval edits', () => {
    expect(canEditModule('CERTIFICATE_TEAM', 'RESULT_APPROVAL')).toBe(true);
    expect(canEditModule('CERTIFICATE_TEAM', 'CERTIFICATES')).toBe(false);
    expect(canEditModule('CERTIFICATE_TEAM', 'SCORING')).toBe(false);
  });

  it('fails closed for missing or unknown roles', () => {
    expect(canEditModule(undefined, 'SCORING')).toBe(false);
    expect(canEditModule('SOMETHING_ELSE', 'SCORING')).toBe(false);
  });
});

describe('friendlyError', () => {
  it('never exposes the technical authorization message', () => {
    const result = friendlyError(
      'AUTHORIZATION_FAILED',
      'Role "EVENTS_TEAM" is not permitted to write SCORING data.',
    );

    expect(result.message).toBe('This action isn’t available for your role.');
    expect(result.message).not.toContain('EVENTS_TEAM');
    expect(result.retryable).toBe(false);
  });

  it('does not offer Retry for permission restrictions', () => {
    expect(friendlyError('PERMISSION_DENIED', 'x').retryable).toBe(false);
    expect(friendlyError('SESSION_EXPIRED', 'x').retryable).toBe(false);
  });

  it('keeps retry available for genuine temporary failures', () => {
    expect(friendlyError('NETWORK_ERROR', 'x').retryable).toBe(true);
    expect(friendlyError('REQUEST_TIMEOUT', 'x').retryable).toBe(true);
  });

  it('passes business and validation messages through unchanged', () => {
    expect(friendlyError('EMAIL_INVALID', 'Enter a valid email address.').message)
      .toBe('Enter a valid email address.');
  });

  it('keeps the error code for existing consumers', () => {
    expect(friendlyError('AUTHORIZATION_FAILED', 'x').code).toBe('AUTHORIZATION_FAILED');
  });
});
