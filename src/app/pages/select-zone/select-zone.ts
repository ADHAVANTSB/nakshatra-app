import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';

import { ApiClientService } from '../../core/services/api/api-client.service';
import { ZONES, SCOPE_NOTE } from '../../core/constants/program-context.config';
import { ProgramContextService } from '../../core/services/program/program-context.service';
import { ZoneDefinition } from '../../core/models/program-context.model';

/** Payload of the backend selectScope action. */
interface ScopeSavePayload {
  programId: string;
  environmentId: string;
}

/**
 * Post-sign-in scope flow, step 2: choose the zone for the selected programme.
 *
 * Zone dates and descriptions render exactly what program-context.config.ts
 * configures. The Test zone is labelled as a TEST environment; the selected
 * programme/environment is persisted on the SERVER-SIDE session via the
 * selectScope action before the dashboard opens — browser state alone is
 * never the authority for scope.
 */
@Component({
  selector: 'nk-select-zone',
  imports: [DatePipe],
  templateUrl: './select-zone.html',
  styleUrl: './select-zone.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectZone {
  private readonly router = inject(Router);
  private readonly apiClient = inject(ApiClientService);
  readonly context = inject(ProgramContextService);

  readonly zones = ZONES;
  readonly scopeNote = SCOPE_NOTE;

  readonly program = this.context.program;

  /** True when no programme was chosen before opening this page (guard bypass). */
  readonly missingProgram = computed(() => this.program() === null);

  /** Set while the server-side scope persistence is in flight. */
  readonly saving = computed(() => this.context.scopeSaving());

  /** Live error message from a failed server-side scope persistence. */
  readonly saveError = computed(() => this.context.scopeSaveError());

  select(zoneId: ZoneDefinition['id']): void {
    if (this.missingProgram()) {
      return;
    }
    const program = this.context.program();
    if (!program) {
      return;
    }

    // Local selection first (guards + chip render immediately), then the
    // authoritative server-side persistence. Navigation happens only after
    // the backend confirmed the scope on the session.
    this.context.selectZone(zoneId);

    this.context.beginScopeSave();
    this.apiClient
      .post<{ scope: { programId: string; environmentId: string } }, ScopeSavePayload>(
        'selectScope',
        { programId: program.id, environmentId: zoneId },
      )
      .then((result) => {
        if (!result.success) {
          this.context.failScopeSave(
            result.error?.message || 'The zone could not be saved on the server.',
          );
          // Revert the local zone so the chip never shows an unconfirmed scope.
          this.context.clearZone();
          return;
        }
        this.context.confirmScopeSave();
        void this.router.navigateByUrl('/dashboard');
      })
      .catch(() => {
        this.context.failScopeSave(
          'The zone could not be saved on the server. Check the connection and try again.',
        );
        this.context.clearZone();
      });
  }

  changeProgram(): void {
    // A zone belongs to the programme it was picked for; restart the flow.
    this.context.clearZone();
    void this.router.navigateByUrl('/select-program');
  }
}
