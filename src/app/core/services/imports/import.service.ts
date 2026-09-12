import { Injectable, signal } from '@angular/core';
import {
  ImportVersion,
  ImportStatus
} from '../../models';

@Injectable({
  providedIn: 'root'
})
export class ImportService {

  private readonly imports = signal<ImportVersion[]>([]);

  readonly imports$ = this.imports.asReadonly();

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
      errorCount > 0
        ? 'VALIDATION_FAILED'
        : warningCount > 0
          ? 'READY_FOR_REVIEW'
          : 'IMPORTED';

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
    return this.updateStatus(importId, 'APPROVED');
  }

  /**
   * Reject an import version
   */
  rejectImport(importId: string): boolean {
    return this.updateStatus(importId, 'REJECTED');
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

  /**
   * Remove an import version.
   *
   * This is intentionally not exposed in the UI.
   * Later the backend should retain import history permanently.
   */
  clearLocalImports(): void {
    this.imports.set([]);
  }
}