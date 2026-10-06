import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ValidationResult } from '../../../core/models';
import { ImportService } from '../../../core/services/imports/import.service';
import {
  ShelterDataService,
  ShelterImportRecord,
} from '../../../core/services/shelter-homes/shelter-data.service';
import { ShelterHomeService } from '../../../core/services/shelter-homes/shelter-home.service';

/** One backend import version of the selected shelter home, ready to render. */
interface ImportRow {
  id: string;
  versionLabel: string;
  status: string;
  statusClass: string;
  recordCount: number | null;
  validParticipantCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  lastSyncedAt: string;
  isCurrentVersion: boolean;
  issueCount: number;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  infos: ValidationResult[];
}

/**
 * Read-only import history and validation report.
 *
 * Import approval, rejection and locking are backend-owned operations and have
 * no write API yet, so this page only renders what the backend reports.
 */
@Component({
  selector: 'app-imports-page',
  imports: [FormsModule],
  templateUrl: './imports-page.component.html',
  styleUrl: './imports-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportsPageComponent implements OnInit {
  private readonly shelterData = inject(ShelterDataService);
  private readonly importService = inject(ImportService);
  private readonly shelterHomes = inject(ShelterHomeService);

  readonly homes = this.shelterHomes.homes$;
  readonly loading = this.shelterData.loading;
  readonly homesError = this.shelterData.homesError;
  readonly selectedHomeId = signal('');

  readonly selectedHomeName = computed(
    () =>
      this.homes().find(home => home.id === this.selectedHomeId())?.name ?? ''
  );

  /** Import versions of the selected home, newest first, with their issues. */
  readonly rows = computed<ImportRow[]>(() => {
    const shelterHomeId = this.selectedHomeId();

    if (!shelterHomeId) {
      return [];
    }

    const home = this.shelterData.getHomeById(shelterHomeId);
    const lastSyncedAt = home?.lastSyncedAt ?? '';
    const currentImportId =
      home?.currentImportVersionId ?? this.importService.getLatestImport(shelterHomeId)?.id;

    return this.importService
      .getImportsByHome(shelterHomeId)
      .map(record =>
        this.toRow(shelterHomeId, record, lastSyncedAt, currentImportId)
      );
  });

  constructor() {
    // Preselect the first connected home, and recover if the selection is stale.
    effect(() => {
      const homes = this.homes();
      const selectedHomeId = this.selectedHomeId();

      if (homes.length === 0) {
        return;
      }

      if (!selectedHomeId || !homes.some(home => home.id === selectedHomeId)) {
        this.selectedHomeId.set(homes[0].id);
      }
    });
  }

  ngOnInit(): void {
    void this.shelterData.refresh();
  }

  selectHome(shelterHomeId: string): void {
    this.selectedHomeId.set(shelterHomeId);
  }

  /** Renders a backend counter, which is optional on the import contract. */
  metric(value: number | null): string {
    return value === null ? 'Not reported' : String(value);
  }

  /** Stable key for a validation message, whose backend id may be absent. */
  trackIssue(issue: ValidationResult, index: number): string {
    return (
      issue.id ??
      `${issue.importVersionId ?? ''}-${issue.ruleCode}-${issue.entityType}-` +
        `${issue.entityId ?? ''}-${issue.fieldName ?? ''}-${index}`
    );
  }

  private toRow(
    shelterHomeId: string,
    record: ShelterImportRecord,
    lastSyncedAt: string,
    currentImportId: string | undefined
  ): ImportRow {
    const results = this.importService.getValidationsForImport(
      shelterHomeId,
      record.id
    );

    return {
      id: record.id,
      versionLabel:
        record.versionNumber === null
          ? 'Unversioned'
          : `Version ${record.versionNumber}`,
      status: record.status,
      statusClass: this.statusClass(record.status),
      recordCount: record.recordCount,
      validParticipantCount: record.validParticipantCount,
      errorCount: record.errorCount,
      warningCount: record.warningCount,
      lastSyncedAt,
      isCurrentVersion: record.id === currentImportId,
      issueCount: results.length,
      errors: results.filter(issue => issue.severity === 'ERROR'),
      warnings: results.filter(issue => issue.severity === 'WARNING'),
      infos: results.filter(issue => issue.severity === 'INFO'),
    };
  }

  private statusClass(status: string): string {
    switch (status) {
      case 'APPROVED':
        return 'status status--ok';
      case 'VALIDATION_FAILED':
      case 'REJECTED':
        return 'status status--bad';
      case 'READY_FOR_REVIEW':
        return 'status status--warn';
      default:
        return 'status';
    }
  }
}
