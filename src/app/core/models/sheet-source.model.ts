export type SyncStatus = 'IDLE' | 'SYNCING' | 'SUCCESS' | 'FAILED' | 'CONFLICT';
export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface SheetSource {
  id: string;
  shelterHomeId: string;
  provider: 'GOOGLE_SHEETS';
  sheetId: string;
  sheetUrl: string;
  overallSheetName: string;
  eventSheetName: string;
  lastSyncedAt?: string;
  lastSyncedVersion?: number;
  syncStatus: SyncStatus;
  connectionStatus: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
}
