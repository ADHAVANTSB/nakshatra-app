import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EventCategory, EventStatus } from '../../core/models';
import { EventService } from '../../core/services/events/event.service';
import { ShelterHomeService } from '../../core/services/shelter-homes/shelter-home.service';
import { ReportService } from '../../core/services/reports/report.service';

type ReportTab = 'SUMMARY' | 'HOMES' | 'EVENTS' | 'PARTICIPANTS';

@Component({
  selector: 'nk-reports',
  imports: [FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports {
  private readonly reportService = inject(ReportService);
  private readonly eventService = inject(EventService);
  private readonly homeService = inject(ShelterHomeService);

  readonly tab = signal<ReportTab>('SUMMARY');
  readonly category = signal<EventCategory | ''>('');
  readonly eventId = signal('');
  readonly homeId = signal('');
  readonly eventStatus = signal<EventStatus | ''>('');
  readonly participantSearch = signal('');
  readonly events = this.eventService.events$;
  readonly homes = this.homeService.homes$;
  readonly summary = computed(() => this.reportService.getSummary());
  readonly homeReports = computed(() => this.reportService.getHomeReports(this.eventId())
    .filter(report => !this.homeId() || report.home.id === this.homeId()));
  readonly eventReports = computed(() => this.reportService.getEventReports(this.category(), this.eventId())
    .filter(item => !this.eventStatus() || item.event.status === this.eventStatus()));
  readonly participantReports = computed(() => this.reportService.getParticipantReports(this.homeId(), this.eventId(), this.participantSearch()));

  setTab(tab: ReportTab): void { this.tab.set(tab); }
  setCategory(category: EventCategory | ''): void { this.category.set(category); this.clearEventIfFilteredOut(); }
  setEvent(eventId: string): void { this.eventId.set(eventId); }
  setHome(homeId: string): void { this.homeId.set(homeId); }
  setEventStatus(status: EventStatus | ''): void { this.eventStatus.set(status); }
  setParticipantSearch(value: string): void { this.participantSearch.set(value); }

  private clearEventIfFilteredOut(): void {
    if (this.eventId() && !this.events().some(event => event.id === this.eventId() && (!this.category() || event.category === this.category()))) {
      this.eventId.set('');
    }
  }
}
