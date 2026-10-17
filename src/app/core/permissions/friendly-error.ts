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
};

/**
 * Maps a technical API error to user-facing language. Unknown codes pass the
 * backend message through unchanged: business and validation messages are
 * already written for users and must not be flattened into a generic error.
 */
export function friendlyError(code: string, technicalMessage: string): FriendlyError {
  // Full technical detail stays available for debugging; never in the UI.
  console.debug('[nakshatra] api error', { code, message: technicalMessage });

  const mapped = MESSAGES[code];
  return {
    code,
    message: mapped?.message ?? technicalMessage,
    retryable: mapped?.retryable ?? true,
  };
}
