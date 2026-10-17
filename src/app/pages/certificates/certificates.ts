import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import { WinnersEventGroup, WinnersService } from '../../core/services/certificates/winners.service';

/**
 * Winners report for the Certificate Team.
 *
 * Every finalized event in the session's programme/environment is listed
 * automatically with its top-three ranked entries — individual winners show
 * name, class, level and shelter home; team winners show the team name and
 * its member names. Certificates are written by hand from this list; this
 * page generates nothing and has no event filter.
 */
@Component({
  selector: 'nk-certificates',
  imports: [ViewOnlyBannerComponent, ],
  templateUrl: './certificates.html',
  styleUrl: './certificates.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Certificates implements OnInit {
  private readonly winnersService = inject(WinnersService);

  readonly loading = this.winnersService.loading$;
  readonly loadError = this.winnersService.error$;
  readonly events = signal<WinnersEventGroup[]>([]);
  readonly totalWinners = signal(0);

  ngOnInit(): void {
    void this.load();
  }

  async retry(): Promise<void> {
    await this.load(true);
  }

  print(): void {
    window.print();
  }

  private async load(force = false): Promise<void> {
    const report = await this.winnersService.load(force);
    this.events.set(report ? report.events : []);
    this.totalWinners.set(report ? report.totalWinners : 0);
  }
}
