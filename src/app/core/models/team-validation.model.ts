export type TeamValidationErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_GROUP'
  | 'EVENT_NOT_ACTIVE'
  | 'TEAM_NOT_FOUND'
  | 'PARTICIPANT_NOT_FOUND'
  | 'PARTICIPANT_NOT_ELIGIBLE'
  | 'PARTICIPANT_NOT_REGISTERED'
  | 'PARTICIPANT_ALREADY_IN_TEAM'
  | 'TEAM_MINIMUM_SIZE_NOT_MET'
  | 'TEAM_MAXIMUM_SIZE_EXCEEDED'
  | 'TEAM_LOCKED'
  | 'TEAM_CANCELLED';

export interface TeamValidationError {
  code: TeamValidationErrorCode;
  message: string;
  participantId?: string;
  teamId?: string;
}

export interface TeamValidationResult {
  valid: boolean;
  errors: TeamValidationError[];
  warnings: string[];
}