import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';

import { Event as CatalogueEvent, Participant } from '../../core/models';
import { canEditModule } from '../../core/permissions/role-matrix';
import { AuthService } from '../../core/services/auth/auth.service';
import {
  WinnerRow,
  WinnersEventGroup,
  WinnersService,
} from '../../core/services/certificates/winners.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { ProgramContextService } from '../../core/services/program/program-context.service';
import { ShelterDataService } from '../../core/services/shelter-homes/shelter-data.service';
import { ViewOnlyBannerComponent } from '../../shared/view-only-banner/view-only-banner.component';
import { DEMO_DATA_NOTICE, DEMO_SLIDES } from './demo-slides';
import { SlideshowPlayer, SlideshowTimer } from './slideshow';
import { StageDeckService } from './stage-deck.service';
import {
  PrizePosition,
  SlideSource,
  StageMode,
  StageSlide,
  POSITION_LABELS,
  validateSlide,
} from './stage-slide';
import { StageSlideView } from './stage-slide-view.component';

/** Official result ranks -> prize positions. Manual slides may also use
 *  SPECIAL_MENTION / PARTICIPATION, which official results never emit. */
const POSITION_BY_RANK: Record<number, PrizePosition> = {
  1: 'FIRST',
  2: 'SECOND',
  3: 'THIRD',
};

interface OfficialCandidate {
  key: string;
  label: string;
  slide: Omit<StageSlide, 'id'>;
}

interface ChildOption {
  participantId: string;
  fullName: string;
  participantCode: string;
  homeName: string;
}

/**
 * Organizer workspace for the prize-distribution slide deck.
 *
 * Left panel: slide list + slide editor. Right panel: 16:9 preview,
 * playback controls and thumbnails. Presentation mode projects the slide
 * full-screen with a subtle auto-hiding toolbar.
 *
 * Winner honesty rules (see stage-slide.ts): official finalized results
 * (listWinners) are the only slides badged as verified; manually created
 * slides are badged as manual and demo slides carry the DEMO DATA notice.
 * Registration is never treated as winning - nothing here ranks or infers
 * a winner from registration order or scores.
 */
@Component({
  selector: 'nk-stage-presentation',
  imports: [ViewOnlyBannerComponent, StageSlideView],
  templateUrl: './stage-presentation.html',
  styleUrl: './stage-presentation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StagePresentation implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly shelterData = inject(ShelterDataService);
  private readonly winners = inject(WinnersService);
  private readonly notifications = inject(NotificationService);

  readonly deck = inject(StageDeckService);
  readonly notice = DEMO_DATA_NOTICE;
  readonly positionLabels = POSITION_LABELS;
  readonly positionOptions = Object.keys(POSITION_LABELS) as PrizePosition[];

  /** Edit permission: the team that runs the ceremony materials (plus
   *  Support/Admin). Presentation-only - the backend authorizes writes. */
  readonly canEdit = computed(() =>
    canEditModule(this.auth.currentUser()?.role ?? null, 'DISTRIBUTION'),
  );

  // ------------------------------------------------------------------
  // Data state
  // ------------------------------------------------------------------

  readonly loading = this.shelterData.loading;
  readonly events = computed<CatalogueEvent[]>(() => this.shelterData.events());
  readonly homes = computed(() =>
    [...this.shelterData.homes()]
      .map(home => home.homeName)
      .filter((name, index, all) => name && all.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b)),
  );

  readonly winnersLoading = this.winners.loading$;
  readonly winnersError = this.winners.error$;

  /** Time of the last successful official-results read ('' before the first). */
  readonly lastRefreshedAt = signal('');

  /** Result identities the organizer removed; a refresh never resurrects them. */
  private readonly dismissedResultKeys = new Set<string>();

  /**
   * Finalized rows whose prize position carries no label. Surfaced in the
   * workspace instead of being silently dropped; zero unless the results
   * schema grows beyond the supported prize positions.
   */
  readonly skippedOfficialResults = computed(() => {
    let skipped = 0;

    for (const group of this.winners.report$()?.events ?? []) {
      for (const row of group.winners) {
        if (!POSITION_BY_RANK[row.position]) {
          skipped += 1;
        }
      }
    }

    return skipped;
  });

  /**
   * Status of the official-results read for the status strip: the three
   * failure modes are told apart - a failed read (error), no finalized
   * results yet (empty), and nothing loaded for the current scope
   * (unloaded, e.g. after a programme switch mid-read).
   */
  readonly resultsStatus = computed<
    'loading' | 'error' | 'unloaded' | 'empty' | 'ready'
  >(() => {
    if (this.winnersLoading()) {
      return 'loading';
    }

    if (this.winnersError()) {
      return 'error';
    }

    const report = this.winners.report$();

    if (!report) {
      return 'unloaded';
    }

    return this.officialCandidates().length ? 'ready' : 'empty';
  });

  /** Slides that can be created from official finalized results. */
  readonly officialCandidates = computed<OfficialCandidate[]>(() => {
    const report = this.winners.report$();
    const candidates: OfficialCandidate[] = [];

    for (const group of report?.events ?? []) {
      for (const row of group.winners) {
        const slide = this.slideFromWinner(group, row);

        if (slide) {
          candidates.push({
            key: group.eventId + '|' + row.scoreId,
            label:
              group.eventName + ' · ' + POSITION_LABELS[slide.position] +
              ' · ' + (slide.mode === 'GROUP'
                ? slide.homeName + (slide.teamName ? ' (' + slide.teamName + ')' : '')
                : slide.childName + ' (' + slide.homeName + ')'),
            slide,
          });
        }
      }
    }

    return candidates;
  });

  // ------------------------------------------------------------------
  // Preview + selection
  // ------------------------------------------------------------------

  private readonly player = new SlideshowPlayer(this.uiTimer());
  readonly playerIndex = signal(0);
  readonly playerPlaying = signal(false);

  /** Editor draft preview overrides the selected slide until cleared. */
  readonly draftPreview = signal<StageSlide | null>(null);

  readonly previewSlide = computed<StageSlide | null>(() => {
    const draft = this.draftPreview();
    return draft ?? this.deck.slides()[this.playerIndex()] ?? null;
  });

  readonly currentSlideLabel = computed(() => {
    const total = this.deck.slides().length;
    return total === 0 ? '0 / 0' : this.playerIndex() + 1 + ' / ' + total;
  });

  // ------------------------------------------------------------------
  // Slide editor
  // ------------------------------------------------------------------

  readonly editingId = signal<string | null>(null);
  readonly editorOpen = signal(false);
  readonly editorErrors = signal<string[]>([]);

  readonly editorEventId = signal('');
  readonly editorHomeName = signal('');
  readonly editorChildId = signal('');
  readonly editorTeamName = signal('');
  readonly editorPosition = signal<PrizePosition>('FIRST');
  readonly editorSubtitle = signal('');
  readonly editorSource = signal<SlideSource>('MANUAL_ADMIN');
  readonly editorSearch = signal('');

  /** Result identity behind the slide being edited ('' for manual/demo). */
  readonly editorResultKey = signal('');

  /** Validation renders only after an explicit save attempt - never on open. */
  readonly editorSubmitAttempted = signal(false);

  /** True while the organizer is previewing the demo sample set. */
  readonly demoPreviewing = signal(false);

  readonly editorEvent = computed(() =>
    this.events().find(event => event.id === this.editorEventId()) ?? null,
  );

  readonly editorMode = computed<StageMode>(() =>
    this.editorEvent()?.mode === 'GROUP' ? 'GROUP' : 'SOLO',
  );

  readonly homeOptions = computed(() => {
    const query = this.editorSearch().trim().toLowerCase();
    const homes = this.homes();
    return query
      ? homes.filter(name => name.toLowerCase().includes(query))
      : homes;
  });

  /** Registered participants of the chosen event (and home, when picked).
   *  The only selectable children - registration data, never invented. */
  readonly childOptions = computed<ChildOption[]>(() => {
    const event = this.editorEvent();

    if (!event) {
      return [];
    }

    const participantsById = new Map(
      this.shelterData.participants().map(participant => [participant.id, participant]),
    );
    const homeName = this.editorHomeName();
    const query = this.editorSearch().trim().toLowerCase();

    return this.shelterData
      .registrationsForEvent(event.id)
      .filter(registration => registration.registrationStatus === 'REGISTERED')
      .map(registration => participantsById.get(registration.participantId))
      .filter((participant): participant is Participant => participant !== undefined)
      .filter(participant => {
        const participantHome = this.homeNameOf(participant);
        return !homeName || participantHome === homeName;
      })
      .filter(participant => {
        if (!query) {
          return true;
        }
        return (
          participant.fullName.toLowerCase().includes(query) ||
          participant.participantCode.toLowerCase().includes(query)
        );
      })
      .map(participant => ({
        participantId: participant.id,
        fullName: participant.fullName,
        participantCode: participant.participantCode,
        homeName: this.homeNameOf(participant),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  });

  readonly editorChildName = computed(
    () =>
      this.childOptions().find(option => option.participantId === this.editorChildId())
        ?.fullName ?? this.editorChildNameFallback(),
  );

  /**
   * Child name carried by the slide being edited/picked (official result
   * or demo slide) when its registrations are not (yet) in the picker -
   * the name is real data from the slide, never invented.
   */
  private readonly editorChildNameFallback = signal('');

  // ------------------------------------------------------------------
  // Presentation (projector) mode
  // ------------------------------------------------------------------

  readonly presenting = signal(false);
  readonly zoomPercent = signal(100);
  readonly controlsVisible = signal(true);
  private controlsHideHandle: ReturnType<typeof setTimeout> | undefined;
  private dragFrom = -1;

  constructor() {
    void this.shelterData.ensureLoaded();
    void this.shelterData.loadEvents();
    // Official results are the initial source of the presentation: the
    // deck is reconciled with them as soon as the read lands.
    void this.loadOfficialResults();
    this.syncDeck();
  }

  /**
   * Fetches the official finalized results and reconciles the deck with
   * them. Called on open and by the Refresh Results button.
   */
  async refreshOfficialResults(): Promise<void> {
    await this.winners.load(true);
    this.applyOfficialResults();
    this.syncDeck();
    this.lastRefreshedAt.set(new Date().toLocaleTimeString());
  }

  private async loadOfficialResults(): Promise<void> {
    await this.winners.load();
    this.applyOfficialResults();
    this.syncDeck();
    this.lastRefreshedAt.set(new Date().toLocaleTimeString());
  }

  /**
   * Reconciles the deck with the latest official results. Every eligible
   * finalized result becomes exactly one OFFICIAL_RESULT slide, matched
   * by result identity (`resultKey`) so a refresh never duplicates slides
   * and never disturbs organizer ordering or the display-only subtitle
   * edits. A result that is no longer finalized is removed from the deck
   * with an explicit notification instead of silently staying on stage
   * as an official winner. Manual and demo slides are never touched, and
   * demo slides never end up mixed with real results.
   */
  private applyOfficialResults(): void {
    // An explicit demo preview never mixes with real results: the
    // organizer asked for sample slides and gets exactly those.
    if (this.demoPreviewing()) {
      return;
    }

    const candidates = this.officialCandidates();
    const report = this.winners.report$();

    if (!report) {
      // The read failed or has not landed: never touch the organizer's
      // deck on a failed read and never fall back to demo slides.
      return;
    }

    // Sample slides left over from an earlier session never mix with
    // real results either.
    const demoSlides = this.deck
      .slides()
      .filter((slide) => slide.source === 'DEMO');

    if (demoSlides.length && candidates.length) {
      demoSlides.forEach((slide) => this.deck.deleteSlide(slide.id));
      this.notifications.success(
        'Demo slides removed',
        'Official results are now loaded; sample slides never mix with real data.',
      );
    }

    const vanished: string[] = [];
    const updatedKeys = new Set<string>();

    // Update matched official slides in place (ordering and the
    // organizer's subtitle survive), and retire vanished ones.
    for (const slide of [...this.deck.slides()]) {
      if (slide.source !== 'OFFICIAL_RESULT') {
        continue;
      }

      const key = slide.resultKey ?? '';

      if (!key) {
        // Pre-identity official slide (stale browser data): replaced by
        // the fresh result below instead of being trusted.
        this.deck.deleteSlide(slide.id);
        continue;
      }

      if (this.dismissedResultKeys.has(key)) {
        // The organizer removed this slide from the presentation on
        // purpose; a refresh must not resurrect it.
        updatedKeys.add(key);
        continue;
      }

      const fresh = candidates.find((candidate) => candidate.key === key);

      if (!fresh) {
        vanished.push(slide.eventName + ' · ' + this.whoLabel(slide));
        this.deck.deleteSlide(slide.id);
        continue;
      }

      this.deck.updateSlide(slide.id, {
        ...fresh.slide,
        // Display-only edits survive; official fields follow the backend.
        subtitle: slide.subtitle,
      });
      updatedKeys.add(key);
    }

    // Append results that are not in the deck yet (never duplicating,
    // never resurrecting a slide the organizer removed).
    for (const candidate of candidates) {
      if (updatedKeys.has(candidate.key)) {
        continue;
      }

      if (this.dismissedResultKeys.has(candidate.key)) {
        continue;
      }

      this.deck.addSlide({ ...candidate.slide, id: '' });
    }

    if (vanished.length) {
      this.notifications.warning(
        'Official results changed',
        vanished.join('; ') +
          ' — no longer finalized results and removed from the presentation.',
      );
    }

    if (this.deck.slides().length) {
      this.selectSlide(Math.min(this.playerIndex(), this.deck.slides().length - 1));
    }
  }

  ngOnDestroy(): void {
    this.player.dispose();
    clearTimeout(this.controlsHideHandle);
  }

  // ------------------------------------------------------------------
  // Deck operations
  // ------------------------------------------------------------------

  startAdd(): void {
    this.editingId.set(null);
    this.editorOpen.set(true);
    this.resetEditor('MANUAL_ADMIN');
  }
  startEdit(slide: StageSlide): void {
    this.editingId.set(slide.id);
    this.editorOpen.set(true);
    this.editorErrors.set([]);
    this.editorSubmitAttempted.set(false);
    this.editorResultKey.set(slide.resultKey ?? '');
    this.editorEventId.set(slide.eventId);
    this.editorHomeName.set(slide.homeName);
    this.editorTeamName.set(slide.teamName);
    this.editorPosition.set(slide.position);
    this.editorSubtitle.set(slide.subtitle);
    this.editorSource.set(slide.source);
    this.editorSearch.set('');
    this.editorChildNameFallback.set(slide.childName);
    this.editorChildId.set(
      this.childOptionsFor(slide.eventId, slide.homeName).find(
        option => option.fullName === slide.childName,
      )?.participantId ?? '',
    );
  }

  cancelEdit(): void {
    this.editorOpen.set(false);
    this.editingId.set(null);
    this.editorErrors.set([]);
    this.draftPreview.set(null);
  }

  saveSlide(): void {
    // Validation runs only here: on an explicit save attempt. Nothing is
    // ever flagged before the organizer submits the form.
    this.editorSubmitAttempted.set(true);
    const composed = this.composeSlide();

    if (!composed) {
      return;
    }

    const errors = validateSlide(composed);

    if (composed.source === 'MANUAL_ADMIN' && composed.mode === 'SOLO') {
      // Security rule: a manual slide may only name a participant who is
      // actually registered for the chosen event and home.
      const validChild = this.childOptionsFor(composed.eventId, composed.homeName).some(
        option => option.fullName === composed.childName,
      );

      if (!validChild) {
        errors.push('Child name must be a participant registered for this event and home.');
      }
    }

    if (errors.length) {
      this.editorErrors.set(errors);
      return;
    }

    const editingId = this.editingId();

    if (editingId) {
      this.deck.updateSlide(editingId, composed);
      this.notifications.success('Slide updated', composed.eventName + ' updated.');
    } else {
      // A result picked from the official list may already be in the deck
      // (it was auto-loaded); saving it again updates that slide instead of
      // creating a duplicate.
      const existing = composed.resultKey
        ? this.deck.slides().find(item => item.resultKey === composed.resultKey)
        : undefined;

      if (existing) {
        this.deck.updateSlide(existing.id, composed);
        this.notifications.success('Slide updated', composed.eventName + ' updated.');
      } else {
        this.deck.addSlide(composed);
        this.notifications.success('Slide added', composed.eventName + ' added to the deck.');
        this.selectSlide(this.deck.slides().length - 1);
      }
    }

    this.cancelEdit();
    this.syncDeck();
  }

  deleteSlide(id: string): void {
    const slide = this.deck.slides().find(item => item.id === id);
    this.deck.deleteSlide(id);

    // Removing an official slide is a presentation-deck decision only -
    // the result itself is never touched, and a later refresh must not
    // silently put the slide back on stage.
    if (slide?.source === 'OFFICIAL_RESULT' && slide.resultKey) {
      this.dismissedResultKeys.add(slide.resultKey);
    }

    if (slide) {
      this.notifications.success('Slide deleted', slide.eventName + ' removed from the deck.');
    }

    if (this.editingId() === id) {
      this.cancelEdit();
    }

    this.syncDeck();
    this.selectSlide(Math.min(this.playerIndex(), this.deck.slides().length - 1));
  }

  deleteFromEditor(): void {
    const id = this.editingId();

    if (id) {
      this.deleteSlide(id);
    } else {
      this.cancelEdit();
    }
  }

  moveUp(index: number): void {
    this.deck.moveUp(index);
    this.syncDeck();
    this.selectSlide(index - 1);
  }

  moveDown(index: number): void {
    this.deck.moveDown(index);
    this.syncDeck();
    this.selectSlide(index + 1);
  }

  /** Drag reorder (slide list and thumbnails share this). */
  onDragStart(index: number): void {
    this.dragFrom = index;
  }

  onDrop(index: number): void {
    if (this.dragFrom >= 0 && this.dragFrom !== index) {
      this.deck.moveSlide(this.dragFrom, index);
      this.syncDeck();
      this.selectSlide(index);
    }

    this.dragFrom = -1;
  }

  selectSlide(index: number): void {
    this.draftPreview.set(null);
    this.player.select(index);
    this.syncFromPlayer();
  }

  /** Event change: fetch that event's registrations so the child picker
   *  lists actual registered participants, and drop any stale child. */
  onEditorEventChange(eventId: string): void {
    this.editorEventId.set(eventId);
    this.editorChildId.set('');
    this.editorChildNameFallback.set('');
    this.editorTeamName.set('');

    if (eventId) {
      void this.shelterData.loadEventRegistrations(eventId);
    }
  }

  previewDraft(): void {
    const composed = this.composeSlide();

    if (!composed) {
      return;
    }

    // A draft preview is not a save attempt: it shows the draft as typed
    // without flagging problems - validation runs on save only.
    this.draftPreview.set({ ...composed, id: 'draft-preview' });
  }

  // ------------------------------------------------------------------
  // Demo data
  // ------------------------------------------------------------------

  loadDemoSlides(): void {
    this.demoPreviewing.set(true);
    this.deck.setSlides([...DEMO_SLIDES]);
    this.syncDeck();
    this.selectSlide(0);
    this.notifications.success('Demo slides loaded', DEMO_DATA_NOTICE);
  }

  removeDemoSlides(): void {
    this.demoPreviewing.set(false);
    const kept = this.deck.slides().filter(slide => slide.source !== 'DEMO');
    this.deck.setSlides(kept);
    this.syncDeck();
    this.selectSlide(Math.min(this.playerIndex(), kept.length - 1));
    this.notifications.success('Demo slides removed', 'Demo slides are gone; real slides are untouched.');
  }

  // ------------------------------------------------------------------
  // Official results -> editor
  // ------------------------------------------------------------------

  applyOfficialCandidate(key: string): void {
    const candidate = this.officialCandidates().find(item => item.key === key);

    if (!candidate) {
      return;
    }

    const slide = candidate.slide;
    this.editingId.set(null);
    this.editorOpen.set(true);
    this.editorErrors.set([]);
    this.editorSubmitAttempted.set(false);
    this.editorResultKey.set(candidate.key);
    this.editorSource.set('OFFICIAL_RESULT');
    this.editorEventId.set(slide.eventId);
    this.editorHomeName.set(slide.homeName);
    this.editorTeamName.set(slide.teamName);
    this.editorPosition.set(slide.position);
    this.editorSubtitle.set(slide.subtitle);
    this.editorSearch.set('');
    this.editorChildNameFallback.set(slide.childName);
    this.editorChildId.set(
      this.childOptionsFor(slide.eventId, slide.homeName).find(
        option => option.fullName === slide.childName,
      )?.participantId ?? '',
    );
    this.draftPreview.set({ ...slide, id: 'draft-preview' });
  }

  // ------------------------------------------------------------------
  // Slideshow + projector mode
  // ------------------------------------------------------------------

  previewCurrent(): void {
    this.enterPresentation(this.playerIndex(), false);
  }

  previewSlideshow(): void {
    this.enterPresentation(0, false);
  }

  startPresentation(): void {
    this.enterPresentation(this.playerIndex(), true);
  }

  exitPresentation(): void {
    this.player.pause();
    this.presenting.set(false);
    this.syncFromPlayer();
    this.exitFullscreenSafely();
    clearTimeout(this.controlsHideHandle);
    this.controlsVisible.set(true);
  }

  previousSlide(): void {
    this.player.prev();
    this.syncFromPlayer();
  }

  nextSlide(): void {
    this.player.next();
    this.syncFromPlayer();
  }

  togglePlay(): void {
    this.player.toggle();
    this.syncFromPlayer();
  }

  setAutoPlay(enabled: boolean): void {
    if (enabled) {
      this.player.play();
    } else {
      this.player.pause();
    }

    this.syncFromPlayer();
  }

  setDuration(seconds: number): void {
    this.player.setDurationSeconds(seconds as 5 | 10 | 15 | 20);
    this.syncFromPlayer();
  }

  setRepeat(enabled: boolean): void {
    this.player.setRepeat(enabled);
    this.syncFromPlayer();
  }

  setZoom(percent: number): void {
    this.zoomPercent.set(percent);
  }

  fitToScreen(): void {
    this.zoomPercent.set(100);
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      this.exitFullscreenSafely();
    } else {
      void this.requestFullscreenSafely();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'SELECT' ||
      target?.tagName === 'TEXTAREA';

    if (event.key === 'Escape' && this.presenting()) {
      event.preventDefault();
      this.exitPresentation();
      return;
    }

    if (typing) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousSlide();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextSlide();
    } else if (event.key === ' ') {
      event.preventDefault();
      this.togglePlay();
    }
  }

  @HostListener('document:mousemove')
  onMouseMove(): void {
    if (!this.presenting()) {
      return;
    }

    this.controlsVisible.set(true);
    clearTimeout(this.controlsHideHandle);
    this.controlsHideHandle = setTimeout(() => this.controlsVisible.set(false), 3000);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  homeNameOf(participant: Participant): string {
    return this.shelterData.getHomeById(participant.shelterHomeId)?.homeName ?? '';
  }

  whoLabel(slide: StageSlide): string {
    return slide.mode === 'GROUP'
      ? slide.homeName + (slide.teamName ? ' · ' + slide.teamName : '')
      : slide.childName + ' · ' + slide.homeName;
  }

  private childOptionsFor(eventId: string, homeName: string): ChildOption[] {
    const participantsById = new Map(
      this.shelterData.participants().map(participant => [participant.id, participant]),
    );

    return this.shelterData
      .registrationsForEvent(eventId)
      .filter(registration => registration.registrationStatus === 'REGISTERED')
      .map(registration => participantsById.get(registration.participantId))
      .filter((participant): participant is Participant => participant !== undefined)
      .filter(participant => !homeName || this.homeNameOf(participant) === homeName)
      .map(participant => ({
        participantId: participant.id,
        fullName: participant.fullName,
        participantCode: participant.participantCode,
        homeName: this.homeNameOf(participant),
      }));
  }

  private slideFromWinner(
    group: WinnersEventGroup,
    row: WinnerRow,
  ): Omit<StageSlide, 'id'> | null {
    const position = POSITION_BY_RANK[row.position];

    if (!position) {
      return null;
    }

    const isGroup = group.mode === 'GROUP';

    return {
      resultKey: group.eventId + '|' + row.scoreId,
      eventId: group.eventId,
      eventCode: group.eventCode,
      eventName: group.eventName,
      mode: isGroup ? 'GROUP' : 'SOLO',
      position,
      // A group winner is a home/team: its roster members are NEVER shown
      // on the stage screen - `row.name` for teams carries the member list,
      // so only the plain team name (recovered from the structured member
      // roster, never guessed from text) may reach a slide.
      homeName: row.shelterHomeName,
      childName: isGroup ? '' : row.name,
      teamName: isGroup ? this.teamNameOf(row) : '',
      subtitle: '',
      source: 'OFFICIAL_RESULT',
    };
  }

  /**
   * The winners report composes a team winner's `name` as
   * "TeamName (Kid One, Kid Two)" for the certificates page. The stage
   * screen must never list group children, so that exact member suffix -
   * rebuilt from the structured member list, never fuzzy-matched - is
   * removed to recover the plain team name.
   */
  private teamNameOf(row: WinnerRow): string {
    const suffix = row.members.length
      ? ' (' + row.members.map(member => member.name).join(', ') + ')'
      : '';

    return suffix && row.name.endsWith(suffix)
      ? row.name.slice(0, -suffix.length)
      : row.name;
  }

  private composeSlide(): StageSlide | null {
    const event = this.editorEvent();

    if (!event) {
      this.editorErrors.set(['Event is required.']);
      return null;
    }

    return {
      id: this.editingId() ?? '',
      resultKey: this.editorResultKey(),
      eventId: event.id,
      eventCode: event.eventCode,
      eventName: event.name,
      mode: this.editorMode(),
      position: this.editorPosition(),
      homeName: this.editorHomeName(),
      childName: this.editorMode() === 'SOLO' ? this.editorChildName() : '',
      teamName: this.editorMode() === 'GROUP' ? this.editorTeamName().trim() : '',
      subtitle: this.editorSubtitle().trim(),
      source: this.editorSource(),
    };
  }

  private resetEditor(source: SlideSource): void {
    this.editorErrors.set([]);
    this.editorSubmitAttempted.set(false);
    this.editorResultKey.set('');
    this.editorEventId.set('');
    this.editorHomeName.set('');
    this.editorChildId.set('');
    this.editorChildNameFallback.set('');
    this.editorTeamName.set('');
    this.editorPosition.set('FIRST');
    this.editorSubtitle.set('');
    this.editorSource.set(source);
    this.editorSearch.set('');
    this.draftPreview.set(null);
  }

  private syncDeck(): void {
    this.player.setSlides(this.deck.slides());
    this.syncFromPlayer();
  }

  private syncFromPlayer(): void {
    this.playerIndex.set(this.player.index);
    this.playerPlaying.set(this.player.playing);
  }

  private enterPresentation(index: number, autoplay: boolean): void {
    this.draftPreview.set(null);
    this.presenting.set(true);
    this.controlsVisible.set(true);
    this.player.select(index);

    if (autoplay) {
      this.player.play();
    } else {
      this.player.pause();
    }

    this.syncFromPlayer();
    void this.requestFullscreenSafely();
    this.onMouseMove();
  }

  /** UI timer: each tick resyncs the signals so auto-advance is visible. */
  private uiTimer(): SlideshowTimer {
    return {
      schedule: (ms, callback) =>
        setTimeout(() => {
          callback();
          this.syncFromPlayer();
        }, ms),
      cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  private async requestFullscreenSafely(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen can be denied (permissions/embedded frame) - the
      // projector overlay still covers the viewport.
    }
  }

  private exitFullscreenSafely(): void {
    try {
      void document.exitFullscreen?.();
    } catch {
      // Already out of fullscreen.
    }
  }
}
