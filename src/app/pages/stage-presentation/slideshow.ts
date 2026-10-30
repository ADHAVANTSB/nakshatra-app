/**
 * SlideshowPlayer - the projector slideshow state machine for the
 * stage presentation.
 *
 * Pure and dependency-free: the auto-advance timer is injected through
 * the SlideshowTimer interface so tests drive ticks deterministically.
 * The default timer wraps globalThis setTimeout/clearTimeout.
 *
 * Rules:
 *   - at most ONE pending timer handle ever; every reschedule cancels
 *     the previous handle, so a deck can never double-advance;
 *   - one tick advances exactly one slide - no catch-up after a
 *     tab-focus stall, a tick simply fires late and moves one slide;
 *   - a paused (or disposed) player never advances: tick callbacks
 *     check `playing` before doing anything;
 *   - manual navigation (next/prev/select) while playing restarts the
 *     auto-advance timer at the full duration - the operator takes
 *     control;
 *   - without repeat the player stops on the final slide; with repeat
 *     it wraps to the first slide and keeps playing;
 *   - dispose() cancels any pending tick and blocks play() forever, so
 *     component destroy can never leak a timer.
 */

import { StageSlide } from './stage-slide';

export interface SlideshowTimer {
  schedule(ms: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const defaultTimer: SlideshowTimer = {
  schedule: (ms, callback) => setTimeout(callback, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const DURATION_MS: Record<number, number> = {
  5: 5000,
  10: 10000,
  15: 15000,
  20: 20000,
};

export class SlideshowPlayer {
  private slides: StageSlide[] = [];
  private currentIndex = 0;
  private playingFlag = false;
  private duration = 10000;
  private repeatFlag = false;
  private disposedFlag = false;
  private timerHandle: unknown = null;
  /** Bumped on every reschedule so stale callbacks cannot double-advance. */
  private tickGeneration = 0;

  constructor(private readonly timer: SlideshowTimer = defaultTimer) {}

  /** Replaces the deck, resets to the first slide and pauses. */
  setSlides(slides: StageSlide[]): void {
    this.pause();
    this.slides = [...slides];
    this.currentIndex = 0;
  }

  /** Next slide. Wraps only with repeat, otherwise clamps at the end. */
  next(): void {
    if (!this.slides.length) {
      return;
    }

    if (this.currentIndex < this.slides.length - 1) {
      this.currentIndex += 1;
    } else if (this.repeatFlag) {
      this.currentIndex = 0;
    }

    this.restartTimerIfPlaying();
  }

  /** Previous slide. Wraps only with repeat, otherwise clamps at the start. */
  prev(): void {
    if (!this.slides.length) {
      return;
    }

    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    } else if (this.repeatFlag) {
      this.currentIndex = this.slides.length - 1;
    }

    this.restartTimerIfPlaying();
  }

  /** Jump to any slide (thumbnail click); clamped to the deck. */
  select(index: number): void {
    if (!this.slides.length) {
      return;
    }

    this.currentIndex = Math.min(Math.max(index, 0), this.slides.length - 1);
    this.restartTimerIfPlaying();
  }

  /** Starts auto-advance. No-op on an empty deck or after dispose(). */
  play(): void {
    if (this.disposedFlag || !this.slides.length) {
      return;
    }

    this.playingFlag = true;
    this.reschedule();
  }

  /** Stops auto-advance and cancels the pending tick. */
  pause(): void {
    this.playingFlag = false;
    this.cancelTimer();
  }

  toggle(): void {
    if (this.playingFlag) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Sets the per-slide duration. When playing, the pending tick is
   * rescheduled at the new duration. Any other value throws.
   */
  setDurationSeconds(seconds: 5 | 10 | 15 | 20): void {
    const ms = DURATION_MS[seconds];

    if (ms === undefined) {
      throw new Error('Unsupported slide duration: ' + seconds);
    }

    this.duration = ms;

    if (this.playingFlag) {
      this.reschedule();
    }
  }

  setRepeat(enabled: boolean): void {
    this.repeatFlag = enabled;
  }

  /**
   * Cancels any pending tick and permanently disables play(), so an
   * Angular component destroy can never leak a timer.
   */
  dispose(): void {
    this.pause();
    this.disposedFlag = true;
  }

  /** Cancels any pending tick and schedules exactly one new tick. */
  private reschedule(): void {
    this.cancelTimer();
    this.tickGeneration += 1;
    const generation = this.tickGeneration;
    this.timerHandle = this.timer.schedule(this.duration, () =>
      this.tick(generation),
    );
  }

  private restartTimerIfPlaying(): void {
    if (this.playingFlag) {
      this.reschedule();
    }
  }

  private cancelTimer(): void {
    if (this.timerHandle !== null) {
      this.timer.cancel(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /** One tick = exactly one slide; a stopped player never advances. */
  private tick(generation: number): void {
    if (
      generation !== this.tickGeneration ||
      !this.playingFlag ||
      this.disposedFlag
    ) {
      return;
    }

    this.timerHandle = null;

    const isLast = this.currentIndex >= this.slides.length - 1;

    if (isLast) {
      if (this.repeatFlag) {
        this.currentIndex = 0;
        this.reschedule();
      } else {
        this.pause();
      }
      return;
    }

    this.currentIndex += 1;
    this.reschedule();
  }

  get index(): number {
    return this.currentIndex;
  }

  get total(): number {
    return this.slides.length;
  }

  get current(): StageSlide | null {
    return this.slides[this.currentIndex] ?? null;
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  get durationMs(): number {
    return this.duration;
  }

  get repeat(): boolean {
    return this.repeatFlag;
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }
}
