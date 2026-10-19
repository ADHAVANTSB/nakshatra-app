import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Legacy /results-approval entry point.
 *
 * The approval workspace now lives inside the unified Results page. This
 * route keeps the same guards as /results (no authorization bypass) and
 * forwards there, preserving any deep-link query such as ?eventId=.
 */
@Component({
  selector: 'nk-results-approval-redirect',
  template: '',
})
export class ResultsApprovalRedirect {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    void this.router.navigate(['/results'], {
      queryParams: this.route.snapshot.queryParams,
      replaceUrl: true,
    });
  }
}
