export type AttendanceStatus = 'PRESENT' | 'ABSENT';

export interface Attendance {
  id: string;
  participantId: string;
  eventId: string;
  teamId?: string;
  status: AttendanceStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
