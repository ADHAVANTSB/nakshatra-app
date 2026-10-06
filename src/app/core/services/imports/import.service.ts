import { Injectable, computed, inject } from '@angular/core';

import { ValidationResult } from '../../models';

import {
  ShelterDataService,
  ShelterImportRecord,
} from '../shelter-homes/shelter-data.service';

/**
 * Read-only projection of the backend import history and validation results.
 *
 * Every value here is derived from `ShelterDataService`, the single source of
 * truth that the Apps Script backend feeds through `getImportStatus()` and
 * `getValidationResults()`. Nothing in this service owns state of its own.
 *
 * The backend exposes no write action for imports, therefore approving,
 * rejecting, superseding, locking or unlocking an import version cannot be
 * persisted from the frontend. Those operations stay backend-owned (the Google
 * Sheet and its Apps Script pipeline) until a write API exists; this service
 * deliberately provides no frontend-only simulation of them, because a
 * simulated approval would look real in the UI while vanishing on reload.
 */
@Injectable({
  providedIn: 'root',
})
export class ImportService {
  private readonly shelterData = inject(ShelterDataService);

  /** Every import version reported by the backend, across all shelter homes. */
  readonly imports$ = computed(() => this.shelterData.imports());

  /** Import versions of one shelter home, newest version first. */
  getImportsByHome(shelterHomeId: string): ShelterImportRecord[] {
    return this.shelterData
      .imports()
      .filter(record => record.shelterHomeId === shelterHomeId)
      .sort((a, b) => (b.versionNumber ?? -1) - (a.versionNumber ?? -1));
  }

  /** A single import version by its backend id (the import version id). */
  getImportById(importId: string): ShelterImportRecord | undefined {
    return this.shelterData.imports().find(record => record.id === importId);
  }

  /** The highest version the backend has recorded for a shelter home. */
  getLatestImport(shelterHomeId: string): ShelterImportRecord | undefined {
    return this.getImportsByHome(shelterHomeId)[0];
  }

  /**
   * Validation messages the shared store considers to belong to a shelter home.
   * The store scopes them by the home's current import version id.
   */
  getValidationResults(shelterHomeId: string): ValidationResult[] {
    return this.shelterData.getValidationResultsForHome(shelterHomeId);
  }

  /**
   * Validation messages that belong to one rendered import version.
   *
   * `ShelterImportRecord.id` is the backend `importVersionId` whenever the
   * import status payload supplies one, and that is the same id stored on every
   * validation result, so the primary match is a straight id comparison. The
   * backend sometimes omits `importVersionId` on a validation result; those
   * unlabelled messages are attached only to the row that represents the home's
   * current import version, so an older version never inherits them and the
   * same message is never counted twice.
   */
  getValidationsForImport(
    shelterHomeId: string,
    importId: string
  ): ValidationResult[] {
    const results = this.shelterData.validations();

    if (results.length === 0) {
      return [];
    }

    const currentImportId = this.getCurrentImportId(shelterHomeId);

    return results.filter(result => {
      if (result.importVersionId !== undefined) {
        return result.importVersionId === importId;
      }

      if (currentImportId !== importId) {
        return false;
      }

      return !result.entityId || result.entityId.startsWith(shelterHomeId);
    });
  }

  /**
   * The import version the backend currently points at for a shelter home,
   * falling back to the newest known version when the home carries no pointer.
   */
  private getCurrentImportId(shelterHomeId: string): string | undefined {
    return (
      this.shelterData.getHomeById(shelterHomeId)?.currentImportVersionId ??
      this.getLatestImport(shelterHomeId)?.id
    );
  }
}
