export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type ValidationResultStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface ValidationResult {
  id?: string;
  importVersionId?: string;
  entityType: 'SHELTER_HOME' | 'CARETAKER' | 'PARTICIPANT' | 'EVENT' | 'PARTICIPANT_EVENT';
  entityId?: string;
  ruleCode: string;
  severity: ValidationSeverity;
  fieldName?: string;
  message: string;
  currentValue?: unknown;
  expectedValue?: unknown;
  status: ValidationResultStatus;
}
