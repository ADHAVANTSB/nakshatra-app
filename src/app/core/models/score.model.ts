export type ScoreStatus = 'DRAFT' | 'FINALIZED';

export interface Score {
  id: string;
  eventId: string;
  participantId?: string;
  teamId?: string;
  value: number;
  status: ScoreStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
