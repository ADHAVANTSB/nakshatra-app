import { Injectable, signal } from '@angular/core';
import {
  ImportVersion,
  ImportStatus,
  ValidationResult
} from '../../models';

@Injectable({
  providedIn: 'root'
})
export class ImportService {

  private readonly imports = signal<ImportVersion[]>([]);

  readonly imports$ = this.imports.asReadonly();
  private readonly validations = signal<ValidationResult[]>([]);
  readonly validations$ = this.validations.asReadonly();

  /**
   * Get all import versions for a shelter home
   */
  getImportsByHome(shelterHomeId: string): ImportVersion[] {
    return this.imports().filter(
      item => item.shelterHomeId === shelterHomeId
    );
  }

  /**
   * Get a specific import version
   */
  getImportById(importId: string): ImportVersion | undefined {
    return this.imports().find(
      item => item.id === importId
    );
  }

  /**
   * Get the latest import version for a shelter home
   */
  getLatestImport(shelterHomeId: string): ImportVersion | undefined {
    const homeImports = this.getImportsByHome(shelterHomeId);

    if (homeImports.length === 0) {
      return undefined;
    }

    return [...homeImports].sort(
      (a, b) => b.versionNumber - a.versionNumber
    )[0];
  }

  /**
   * Get next version number for a shelter home
   */
  getNextVersionNumber(shelterHomeId: string): number {
    const latest = this.getLatestImport(shelterHomeId);

    return latest ? latest.versionNumber + 1 : 1;
  }

  /**
   * Create a new import version
   */
  createImportVersion(
    shelterHomeId: string,
    sheetSourceId: string,
    importedBy: string,
    recordCount: number = 0,
    errorCount: number = 0,
    warningCount: number = 0,
    sourceHash?: string
  ): ImportVersion {

    const now = new Date().toISOString();

    const versionNumber =
      this.getNextVersionNumber(shelterHomeId);

    const status: ImportStatus =
      errorCount > 0 ? 'VALIDATION_FAILED' : 'READY_FOR_REVIEW';

    const importVersion: ImportVersion = {
      id: `IMP-${Date.now()}`,
      shelterHomeId,
      sheetSourceId,
      versionNumber,
      importedAt: now,
      importedBy,
      status,
      sourceHash,
      recordCount,
      errorCount,
      warningCount
      , validationStatus: errorCount ? 'FAILED' : warningCount ? 'WARNING' : 'PASSED', approvalStatus: 'PENDING', lockStatus: 'UNLOCKED', version: 1, updatedAt: now, updatedBy: importedBy
    };

    this.imports.update(current => [
      ...current,
      importVersion
    ]);

    return importVersion;
  }

  /**
   * Update import status
   */
  updateStatus(
    importId: string,
    status: ImportStatus
  ): boolean {

    const existing = this.getImportById(importId);

    if (!existing) {
      return false;
    }

    this.imports.update(current =>
      current.map(item =>
        item.id === importId
          ? {
              ...item,
              status
            }
          : item
      )
    );

    return true;
  }

  /**
   * Approve an import version
   */
  approveImport(importId: string): boolean {
    if (!this.canApprove(importId)) return false;
    return this.updateWorkflow(importId, 'APPROVED', 'APPROVED', undefined, 'ADMIN');
  }

  /**
   * Reject an import version
   */
  rejectImport(importId: string): boolean {
    return this.updateWorkflow(importId, 'REJECTED', 'REJECTED', undefined, 'ADMIN');
  }

  /**
   * Mark an older version as superseded
   */
  supersedeImport(importId: string): boolean {
    return this.updateStatus(importId, 'SUPERSEDED');
  }

  /**
   * Check whether an import can be approved
   */
  canApprove(importId: string): boolean {

    const importVersion = this.getImportById(importId);

    if (!importVersion) {
      return false;
    }

    return (
      importVersion.status === 'READY_FOR_REVIEW' &&
      importVersion.errorCount === 0
    );
  }

  /**
   * Check whether an import has validation errors
   */
  hasErrors(importId: string): boolean {

    const importVersion = this.getImportById(importId);

    return !!importVersion && importVersion.errorCount > 0;
  }

  getValidationResults(importVersionId: string): ValidationResult[] { return this.validations().filter(item => item.importVersionId === importVersionId); }
  setValidationResults(importVersionId: string, results: ValidationResult[]): void { this.validations.update(current => [...current.filter(item => item.importVersionId !== importVersionId), ...results.map(item => ({ ...item, importVersionId }))]); }
  lockImport(importId: string, by = 'ADMIN'): boolean { const item = this.getImportById(importId); return !!item && item.approvalStatus === 'APPROVED' && this.updateWorkflow(importId, 'APPROVED', 'APPROVED', 'LOCKED', by); }
  unlockImport(importId: string, reason: string, by = 'ADMIN'): boolean { const item = this.getImportById(importId); if (!item || item.lockStatus !== 'LOCKED' || item.approvalStatus !== 'APPROVED' || !reason.trim()) return false; return this.updateWorkflow(importId, 'READY_FOR_REVIEW', 'PENDING', 'UNLOCKED', by, reason); }
  private updateWorkflow(id: string, status: ImportStatus, approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED', lockStatus: 'LOCKED' | 'UNLOCKED' | undefined, by: string, unlockReason?: string): boolean { const item = this.getImportById(id); if (!item) return false; const now = new Date().toISOString(); this.imports.update(current => current.map(value => value.id === id ? { ...value, status, approvalStatus, ...(lockStatus ? { lockStatus } : {}), ...(lockStatus === 'LOCKED' ? { lockedAt: now, lockedBy: by } : {}), ...(unlockReason ? { unlockReason } : {}), version: (value.version ?? 1) + 1, updatedAt: now, updatedBy: by } : value)); return true; }
}
