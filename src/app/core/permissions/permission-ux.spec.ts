import { describe, expect, it } from 'vitest';

import { canEditModule, canEditRegistrations } from './role-matrix';
import { friendlyError, persistenceUnconfirmed } from './friendly-error';

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

describe('canEditRegistrations (registration controls per role)', () => {
  it('hides registration controls from the Events role', () => {
    expect(canEditRegistrations('EVENTS_TEAM')).toBe(false);
  });

  it('keeps registration controls for every other role', () => {
    expect(canEditRegistrations('ADMIN')).toBe(true);
    expect(canEditRegistrations('SUPPORT')).toBe(true);
    expect(canEditRegistrations('LIAISON_TEAM')).toBe(true);
    expect(canEditRegistrations('CERTIFICATE_TEAM')).toBe(true);
  });

  it('fails closed for a missing role', () => {
    expect(canEditRegistrations(undefined)).toBe(false);
    expect(canEditRegistrations(null)).toBe(false);
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

  it('maps the event finalization lock to the exact message with no Retry', () => {
    const result = friendlyError('EVENT_FINALIZED_LOCKED', 'internal technical detail');

    expect(result.message).toBe('This event has been finalized. Attendance and scores are locked.');
    expect(result.retryable).toBe(false);
  });

  it('maps JUDGE_SCORES_INCOMPLETE to the exact plain-English message with no Retry', () => {
    const result = friendlyError('JUDGE_SCORES_INCOMPLETE', 'missing judge/submission ids');

    expect(result.message).toBe('Every judge must submit final scores before this event can be finalized.');
    expect(result.message).not.toContain('missing judge/submission ids');
    expect(result.retryable).toBe(false);
  });

  it('maps UNKNOWN_ACTION to the backend-deployment hint with no Retry', () => {
    const result = friendlyError('UNKNOWN_ACTION', 'No handler for action "newFeature"');

    expect(result.message).toBe('This feature isn’t available in the current backend deployment yet. Please ask your administrator to update the backend.');
    expect(result.message).not.toContain('newFeature');
    expect(result.retryable).toBe(false);
  });

  it('maps the judging workflow rule rejections to plain English with no Retry', () => {
    for (const code of [
      'CRITERIA_PENDING',
      'JUDGES_LOCKED_AFTER_SCORING',
      'JUDGE_NAME_DUPLICATE',
      'JUDGE_SCORES_INCOMPLETE',
      'UNLOCK_REASON_REQUIRED',
      'RECONCILIATION_INCOMPLETE',
      'APPROVAL_COMMENTS_REQUIRED',
    ]) {
      const result = friendlyError(code, 'internal technical detail');
      expect(result.message).not.toBe('internal technical detail');
      expect(result.message).toMatch(/[A-Za-z]/);
      expect(result.retryable).toBe(false);
    }
  });

  it('distinguishes a stale backend deployment from network and authorization failures', () => {
    // Deployment out of date / feature not deployed: never a Retry, always
    // pointing at the administrator updating the backend.
    for (const code of ['BACKEND_ACTION_UNKNOWN', 'BACKEND_RESPONSE_UNRECOGNIZED']) {
      const result = friendlyError(code, 'technical detail');
      expect(result.message).toContain('out of date');
      expect(result.message).not.toContain('technical detail');
      expect(result.retryable).toBe(false);
    }

    // Network failures keep Retry and never blame the deployment.
    const network = friendlyError('NETWORK_ERROR', 'x');
    expect(network.retryable).toBe(true);
    expect(network.message).not.toContain('out of date');

    // Authorization failures never blame the deployment or offer Retry.
    const denied = friendlyError('AUTHORIZATION_FAILED', 'x');
    expect(denied.message).toBe('This action isn’t available for your role.');
    expect(denied.retryable).toBe(false);
  });

  it('maps LEGACY_SCORING_DISABLED to the judging-workflow direction with no Retry', () => {
    const result = friendlyError('LEGACY_SCORING_DISABLED', 'technical detail');

    expect(result.message).toContain('judging workflow');
    expect(result.message).not.toContain('technical detail');
    expect(result.retryable).toBe(false);
  });
});

describe('persistenceUnconfirmed', () => {
  it('is true only when a failed write produced no structured backend answer', () => {
    for (const code of [
      'NETWORK_ERROR',
      'REQUEST_TIMEOUT',
      'SERVER_RESPONSE_MALFORMED',
      'API_REQUEST_FAILED',
      'BACKEND_ACTION_UNKNOWN',
      'BACKEND_RESPONSE_UNRECOGNIZED',
      'BACKEND_UNSTRUCTURED_ERROR',
      'UNHANDLED_ERROR',
    ]) {
      expect(persistenceUnconfirmed(code)).toBe(true);
    }
  });

  it('is false for structured rejections, which always wrote nothing', () => {
    for (const code of [
      'JUDGE_SCORES_INCOMPLETE',
      'JUDGES_LOCKED_AFTER_SCORING',
      'LEGACY_SCORING_DISABLED',
      'VERSION_CONFLICT',
      'AUTHORIZATION_FAILED',
    ]) {
      expect(persistenceUnconfirmed(code)).toBe(false);
    }
  });
});
