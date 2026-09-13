export type CertificateStatus = 'GENERATED' | 'ISSUED';

/**
 * A certificate record deliberately contains no presentation or eligibility data.
 * Official rules and templates will be supplied by the backend/configuration later.
 */
export interface Certificate {
  id: string;
  eventId: string;
  participantId?: string;
  teamId?: string;
  scoreId: string;
  status: CertificateStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
