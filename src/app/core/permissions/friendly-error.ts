/**
 * Plain-English presentation for API errors.
 *
 * Technical detail (codes, backend envelopes, HTTP status) is preserved in
 * the browser console for debugging and never shown in the UI. The error
 * `code` itself is kept on the returned error so existing consumers and
 * tests that branch on codes are unaffected.
 */

export interface FriendlyError {
  code: string;
  message: string;
  /** Whether offering a Retry is appropriate for this failure. */
  retryable: boolean;
}

/** The finalization lock message; also shown on locked pages and panels. */
export const EVENT_FINALIZED_MESSAGE =
  'This event has been finalized. Attendance and scores are locked.';

const MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  // Role restrictions: never offer Retry — retrying cannot succeed.
  AUTHORIZATION_FAILED: {
    message: 'This action isn’t available for your role.',
    retryable: false,
  },
  FORBIDDEN: { message: 'This action isn’t available for your role.', retryable: false },
  PERMISSION_DENIED: { message: 'This action isn’t available for your role.', retryable: false },
  ACCESS_DENIED: { message: 'You don’t have access to this page. Please contact your administrator if you think you should.', retryable: false },

  // Session lifecycle.
  SESSION_REQUIRED: { message: 'Your session has expired. Please sign in again.', retryable: false },
  SESSION_EXPIRED: { message: 'Your session has expired. Please sign in again.', retryable: false },
  SESSION_INVALID: { message: 'Your session has expired. Please sign in again.', retryable: false },

  // Genuine temporary failures: retrying is appropriate.
  NETWORK_ERROR: {
    message: 'We couldn’t load this information right now. Please try again later.',
    retryable: true,
  },
  SERVER_RESPONSE_MALFORMED: {
    message: 'We couldn’t load this information right now. Please try again later.',
    retryable: true,
  },
  API_REQUEST_FAILED: {
    message: 'We couldn’t load this information right now. Please try again later.',
    retryable: true,
  },
  REQUEST_TIMEOUT: {
    message: 'This is taking longer than expected. Your request may still have been processed — refresh before retrying.',
    retryable: true,
  },

  // Event finalization lock: retrying cannot succeed.
  EVENT_FINALIZED_LOCKED: {
    message: EVENT_FINALIZED_MESSAGE,
    retryable: false,
  },

  // Judging workflow rule rejections: retrying the same request cannot succeed.
  CRITERIA_PENDING: {
    message: 'Official judging criteria are still pending for this event. Scoring opens once the criteria are supplied and verified.',
    retryable: false,
  },
  JUDGES_LOCKED_AFTER_SCORING: {
    message: 'Judges can no longer be changed for this event because scoring has already been submitted. Contact your administrator if a change is required.',
    retryable: false,
  },
  JUDGE_SCORES_INCOMPLETE: {
    message: 'Every judge must submit final scores before this event can be finalized.',
    retryable: false,
  },
  JUDGE_NAME_DUPLICATE: {
    message: 'Two judges on this event have the same name. Give each judge a distinct name, then save again.',
    retryable: false,
  },
  UNLOCK_REASON_REQUIRED: {
    message: 'A reason is required to unlock a locked home sheet. Explain why the sheet needs correction, then unlock again.',
    retryable: false,
  },
  RECONCILIATION_INCOMPLETE: {
    message: 'Some participants are still missing registration, attendance or scoring for this event. Review the reconciliation table, resolve each item or acknowledge it explicitly, then accept again.',
    retryable: false,
  },
  APPROVAL_COMMENTS_REQUIRED: {
    message: 'A reviewer comment is required to return results for correction. Explain what needs fixing, then return again.',
    retryable: false,
  },

  // Backend deployment older than the frontend: the action is not deployed yet.
  UNKNOWN_ACTION: {
    message: 'This feature isn’t available in the current backend deployment yet. Please ask your administrator to update the backend.',
    retryable: false,
  },
  // A pre-envelope backend answered an unrouted action by falling through to
  // its login path (which rejects with exactly this error string). The
  // feature is not deployed at all until the backend is redeployed.
  BACKEND_ACTION_UNKNOWN: {
    message: 'This feature isn’t available in the deployed backend yet — the backend is out of date. Please ask your administrator to update the backend.',
    retryable: false,
  },
  // JSON body that is not a recognized response envelope at all.
  BACKEND_RESPONSE_UNRECOGNIZED: {
    message: 'The backend answered in a format this app doesn’t recognise. The deployed backend is likely out of date — please ask your administrator to update the backend.',
    retryable: false,
  },
  // Pre-envelope backends report failures as a bare string instead of an
  // error code; the cause is in the browser console.
  BACKEND_UNSTRUCTURED_ERROR: {
    message: 'The backend reported a problem in an older format that this app can’t classify. If this keeps happening the deployed backend is likely out of date — please ask your administrator to update the backend.',
    retryable: true,
  },
  // Legacy manual score writes on an event that is scored through judges.
  LEGACY_SCORING_DISABLED: {
    message: 'Manual score entry is disabled for this event: it is scored through the judging workflow. Configure the event’s judges and enter per-judge scores instead.',
    retryable: false,
  },
};

/**
 * Maps a technical API error to user-facing language. Unknown codes pass the
 * backend message through unchanged: business and validation messages are
 * already written for users and must not be flattened into a generic error.
 *
 * `context` is safe correlation detail (action, HTTP status, requestId) that
 * is logged to the console only — it never reaches the UI.
 */
export function friendlyError(
  code: string,
  technicalMessage: string,
  context?: Record<string, unknown>,
): FriendlyError {
  // Full technical detail stays available for debugging; never in the UI.
  console.debug('[nakshatra] api error', { code, message: technicalMessage, ...context });

  const mapped = MESSAGES[code];
  return {
    code,
    message: mapped?.message ?? technicalMessage,
    retryable: mapped?.retryable ?? true,
  };
}

/**
 * True when a failed WRITE cannot be confirmed or denied: the request never
 * produced a structured backend answer, so whether anything was persisted is
 * unknown. Callers must re-read what is stored instead of claiming either
 * "nothing changed" or "saved". A structured error envelope always means the
 * backend rejected the write before changing anything.
 */
export function persistenceUnconfirmed(code: string): boolean {
  return code === 'NETWORK_ERROR'
    || code === 'REQUEST_TIMEOUT'
    || code === 'SERVER_RESPONSE_MALFORMED'
    || code === 'API_REQUEST_FAILED'
    || code === 'BACKEND_ACTION_UNKNOWN'
    || code === 'BACKEND_RESPONSE_UNRECOGNIZED'
    || code === 'BACKEND_UNSTRUCTURED_ERROR'
    || code === 'UNHANDLED_ERROR';
}
