/**
 * Preview Dataset Refresh — backend `previewDatasetRefresh` response.
 *
 * This is a PREVIEW ONLY payload: the backend exposes no destructive reset
 * action, so the frontend renders these numbers verbatim and renders no reset
 * control. Field names mirror the backend exactly.
 */

export interface DatasetRefreshPreviewTableCount {
  participants: number;
  participantEvents: number;
  attendance: number;
  scores: number;
  certificates: number;
}

export interface DatasetRefreshPreviewPreservedTable {
  table: string;
  count: number;
  reason: string;
}

export interface DatasetRefreshPreviewOrphanRisk {
  ifCleared: string;
  orphanedTables: string[];
  note: string;
}

export interface DatasetRefreshPreviewConnectedHome {
  shelterHomeId: string;
  spreadsheetName: string;
  participantCount: number;
  registrationCount: number;
  rowsProposedForArchive: number;
}

export interface DatasetRefreshPreviewTrigger {
  shelterHomeId: string;
  spreadsheetName: string;
  triggerInstalled: boolean;
  triggerSourceCurrent: boolean;
}

export interface DatasetRefreshPreviewData {
  scope: string;
  destructive: boolean;
  generatedAt: string;
  backupRequired: boolean;
  separateTestDeploymentRecommended: boolean;
  tableCounts: DatasetRefreshPreviewTableCount;
  preservedTables: DatasetRefreshPreviewPreservedTable[];
  cleanupOrder: string[];
  orphanRisks: DatasetRefreshPreviewOrphanRisk[];
  connectedHomes: DatasetRefreshPreviewConnectedHome[];
  triggerInventory: DatasetRefreshPreviewTrigger[];
  proposed: {
    archive: string;
    addOrUpdate: string;
  };
  requiredResetSteps: string[];
}
