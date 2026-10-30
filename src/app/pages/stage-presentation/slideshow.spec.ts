import { describe, expect, it } from 'vitest';

import { SlideshowPlayer, SlideshowTimer } from './slideshow';
import { StageSlide } from './stage-slide';

/**
 * SlideshowPlayer tests with an injected fake timer: navigation
 * clamping/wrapping, play/pause/toggle, one-slide-per-tick autoplay
 * (no catch-up after a stall), duration switching, stop-at-final vs
 * repeat wrap, degenerate decks and timer-leak guarantees. No real
 * timers, no TestBed, no network.
 */

interface FakeTick {
  ms: number;
  callback: () => void;
  handle: number;
}

class FakeTimer implements SlideshowTimer {
  /** Every schedule() call, in order - includes cancelled ticks. */
  readonly log: FakeTick[] = [];
  /** cancel() bookkeeping - every cancelled handle, in order. */
  readonly cancelled: unknown[] = [];
  /** Ticks that would actually fire (not cancelled). */
  pending: FakeTick[] = [];
  private nextHandle = 1;

  schedule(ms: number, callback: () => void): unknown {
    const tick: FakeTick = { ms, callback, handle: this.nextHandle++ };
    this.log.push(tick);
    this.pending.push(tick);
    return tick.handle;
  }

  cancel(handle: unknown): void {
    this.cancelled.push(handle);
    this.pending = this.pending.filter((tick) => tick.handle !== handle);
  }

  /** Fires the oldest pending tick, like the event loop would. */
  fireNext(): void {
    const tick = this.pending.shift();
    if (tick) {
      tick.callback();
    }
  }

  /** Fires a recorded tick even if it was cancelled (stale callback). */
  fireStale(logIndex: number): void {
    this.log[logIndex].callback();
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

function makeSlide(id: string): StageSlide {
  return {
    id,
    eventId: 'E-' + id,
    eventCode: 'C-' + id,
    eventName: 'Event ' + id,
    mode: 'SOLO',
    position: 'FIRST',
    homeName: 'Sunrise Home',
    childName: 'Child ' + id,
    teamName: '',
    subtitle: '',
    source: 'OFFICIAL_RESULT',
  };
}

function deck(count: number): StageSlide[] {
  return Array.from({ length: count }, (_, i) => makeSlide('S' + (i + 1)));
}

function playerWith(count: number): { player: SlideshowPlayer; timer: FakeTimer } {
  const timer = new FakeTimer();
  const player = new SlideshowPlayer(timer);
  player.setSlides(deck(count));
  return { player, timer };
}

describe('navigation without repeat', () => {
  it('clamps at the last slide', () => {
    const { player } = playerWith(3);

    player.next();
    player.next();
    player.next();
    player.next();

    expect(player.index).toBe(2);
  });

  it('clamps at the first slide', () => {
    const { player } = playerWith(3);

    player.prev();
    player.prev();

    expect(player.index).toBe(0);
  });

  it('moves forward and back one slide at a time', () => {
    const { player } = playerWith(3);

    player.next();
    expect(player.index).toBe(1);
    player.prev();
    expect(player.index).toBe(0);
    expect(player.current?.id).toBe('S1');
    expect(player.total).toBe(3);
  });
});

describe('navigation with repeat', () => {
  it('wraps from the last slide to the first', () => {
    const { player } = playerWith(3);
    player.setRepeat(true);

    player.next();
    player.next();
    expect(player.index).toBe(2);
    player.next();
    expect(player.index).toBe(0);
  });

  it('wraps from the first slide to the last', () => {
    const { player } = playerWith(3);
    player.setRepeat(true);

    player.prev();
    expect(player.index).toBe(2);
  });

  it('keeps the repeat flag readable', () => {
    const { player } = playerWith(3);
    expect(player.repeat).toBe(false);
    player.setRepeat(true);
    expect(player.repeat).toBe(true);
    player.setRepeat(false);
    expect(player.repeat).toBe(false);
  });
});

describe('select', () => {
  it('jumps to any slide and clamps out-of-range indexes', () => {
    const { player } = playerWith(3);

    player.select(2);
    expect(player.index).toBe(2);
    player.select(99);
    expect(player.index).toBe(2);
    player.select(-5);
    expect(player.index).toBe(0);
    player.select(1);
    expect(player.index).toBe(1);
    expect(player.current?.id).toBe('S2');
  });
});

describe('play, pause and toggle', () => {
  it('play schedules exactly one tick at the default duration', () => {
    const { player, timer } = playerWith(3);

    player.play();

    expect(player.playing).toBe(true);
    expect(timer.pendingCount).toBe(1);
    expect(timer.log[0].ms).toBe(10000);
    expect(player.durationMs).toBe(10000);
  });

  it('pause cancels the pending tick', () => {
    const { player, timer } = playerWith(3);

    player.play();
    const handle = timer.pending[0].handle;
    player.pause();

    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
    expect(timer.cancelled).toContain(handle);
  });

  it('a fired-while-paused callback does not advance', () => {
    const { player, timer } = playerWith(3);

    player.play();
    const stale = timer.log[0];
    player.pause();
    stale.callback();

    expect(player.index).toBe(0);
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
  });

  it('toggle flips between playing and paused', () => {
    const { player, timer } = playerWith(3);

    player.toggle();
    expect(player.playing).toBe(true);
    expect(timer.pendingCount).toBe(1);

    player.toggle();
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
  });
});

describe('autoplay', () => {
  it('advances exactly one slide per tick - never skips', () => {
    const { player, timer } = playerWith(3);

    player.play();
    timer.fireNext();
    expect(player.index).toBe(1);
    timer.fireNext();
    expect(player.index).toBe(2);

    // Each fired tick left exactly one pending tick behind.
    expect(timer.pendingCount).toBe(1);
  });

  it('stops automatically at the final slide when repeat is off', () => {
    const { player, timer } = playerWith(3);

    player.play();
    timer.fireNext();
    timer.fireNext();
    expect(player.index).toBe(2);
    expect(player.playing).toBe(true);

    timer.fireNext();

    expect(player.index).toBe(2);
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
  });

  it('wraps to the first slide and keeps playing when repeat is on', () => {
    const { player, timer } = playerWith(2);
    player.setRepeat(true);

    player.play();
    timer.fireNext();
    expect(player.index).toBe(1);
    timer.fireNext();

    expect(player.index).toBe(0);
    expect(player.playing).toBe(true);
    expect(timer.pendingCount).toBe(1);
  });

  it('a manual move while playing restarts the timer at the full duration', () => {
    const { player, timer } = playerWith(3);

    player.play();
    timer.fireNext();
    player.next();

    expect(player.index).toBe(2);
    expect(timer.pendingCount).toBe(1);
    expect(timer.pending[0].ms).toBe(10000);
  });
});

describe('slide durations', () => {
  it('schedules the right tick for every supported duration', () => {
    const cases: Array<[5 | 10 | 15 | 20, number]> = [
      [5, 5000],
      [10, 10000],
      [15, 15000],
      [20, 20000],
    ];

    for (const [seconds, ms] of cases) {
      const { player, timer } = playerWith(3);
      player.setDurationSeconds(seconds);
      expect(player.durationMs).toBe(ms);

      player.play();
      expect(timer.pending[0].ms).toBe(ms);
    }
  });

  it('reschedules the pending tick at the new duration while playing', () => {
    const { player, timer } = playerWith(3);

    player.play();
    const firstHandle = timer.pending[0].handle;
    player.setDurationSeconds(15);

    expect(player.durationMs).toBe(15000);
    expect(timer.pendingCount).toBe(1);
    expect(timer.pending[0].ms).toBe(15000);
    expect(timer.cancelled).toContain(firstHandle);
    expect(timer.pending[0].handle).not.toBe(firstHandle);
  });

  it('rejects an unsupported duration', () => {
    const { player } = playerWith(3);

    expect(() => player.setDurationSeconds(7 as unknown as 5))
      .toThrow('Unsupported slide duration: 7');
  });
});

describe('degenerate decks', () => {
  it('a zero-slide deck never plays and every op is a no-op', () => {
    const { player, timer } = playerWith(0);

    player.play();
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);

    player.next();
    player.prev();
    player.select(3);

    expect(player.index).toBe(0);
    expect(player.total).toBe(0);
    expect(player.current).toBeNull();
  });

  it('a single-slide deck: next/prev are no-ops and autoplay stops at the end', () => {
    const { player, timer } = playerWith(1);

    player.next();
    player.prev();
    expect(player.index).toBe(0);

    player.play();
    timer.fireNext();

    expect(player.index).toBe(0);
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
  });
});

describe('timer leak guarantees', () => {
  it('holds at most one scheduled handle at any time', () => {
    const { player, timer } = playerWith(3);

    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    player.play();
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    player.next();
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    player.select(2);
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    player.setDurationSeconds(20);
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    timer.fireNext();
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
    player.toggle();
    expect(timer.pendingCount).toBeLessThanOrEqual(1);
  });

  it('rescheduling cancels the previous handle', () => {
    const { player, timer } = playerWith(3);

    player.play();
    const firstHandle = timer.pending[0].handle;
    player.next();

    expect(timer.cancelled).toContain(firstHandle);
    expect(timer.pendingCount).toBe(1);
    expect(timer.pending[0].handle).not.toBe(firstHandle);
  });

  it('a stale cancelled callback cannot double-advance', () => {
    const { player, timer } = playerWith(3);

    player.play(); // schedules tick A (log[0])
    player.next(); // reschedules: tick A cancelled, tick B pending
    expect(player.index).toBe(1);

    timer.fireStale(0);

    expect(player.index).toBe(1);
    expect(timer.pendingCount).toBe(1);
  });

  it('dispose cancels the pending tick and blocks play() forever', () => {
    const { player, timer } = playerWith(3);

    player.play();
    expect(timer.pendingCount).toBe(1);
    player.dispose();

    expect(player.disposed).toBe(true);
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);

    player.play();
    expect(player.playing).toBe(false);
    expect(timer.pendingCount).toBe(0);
  });
});
