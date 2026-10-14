import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PROGRAMS, SCOPE_NOTE } from '../../core/constants/program-context.config';
import { ProgramContextService } from '../../core/services/program/program-context.service';

/**
 * Post-sign-in scope flow, step 1: choose the programme (Arts or Sports).
 *
 * The page renders exactly the configured programme catalogue — nothing is
 * invented here. Selecting a programme clears any previously chosen zone in
 * ProgramContextService, so a switch can never silently reuse stale zone
 * state, then continues to zone selection.
 */
@Component({
  selector: 'nk-select-program',
  imports: [],
  templateUrl: './select-program.html',
  styleUrl: './select-program.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectProgram {
  private readonly router = inject(Router);
  private readonly context = inject(ProgramContextService);

  readonly programs = PROGRAMS;
  readonly scopeNote = SCOPE_NOTE;

  select(programId: (typeof PROGRAMS)[number]['id']): void {
    this.context.selectProgram(programId);
    void this.router.navigateByUrl('/select-zone');
  }
}
