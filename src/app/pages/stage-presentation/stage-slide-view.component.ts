import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

import {
  POSITION_BANNER_LABELS,
  StageSlide,
} from './stage-slide';

/**
 * One 16:9 ceremony slide, styled after the Nakshatra Arts '26 artwork:
 * parchment field, marigold garland, terracotta edges, award banner and
 * a cream winner panel. Purely presentational - it never fetches or
 * infers anything; every value comes from the StageSlide passed in.
 *
 * Scaling: the wrapper is a container (`container-type: inline-size`) and
 * the slide typesets at `font-size: 1cqw`, so 1em equals 1% of the slide
 * width at ANY size - projector full-screen, preview panel or thumbnail
 * all render identical proportions with zero distortion (aspect ratio is
 * locked to 16:9 and the optional artwork uses `object-fit: cover`).
 *
 * Winner rules enforced here (and in validateSlide):
 *   - SOLO slides show Child Name, then the combined Home / Team line;
 *   - GROUP slides show Home / Team only - a group child list must never
 *     reach the stage screen;
 *   - the prize position is shown exactly once (the banner row);
 *   - DEMO slides carry the DEMO DATA notice, MANUAL_ADMIN slides carry a
 *     "not an official result" badge, and only OFFICIAL_RESULT slides are
 *     badged as verified.
 */
@Component({
  selector: 'nk-stage-slide-view',
  imports: [],
  templateUrl: './stage-slide-view.html',
  styleUrl: './stage-slide-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageSlideView {
  /** The slide to render. */
  readonly slide = input.required<StageSlide>();

  /** DEMO DATA notice text; rendered only for demo slides. */
  readonly demoNotice = input<string>('');

  /**
   * Drop-in replacement artwork (public/logo/stage-artwork.png). When the
   * file is absent the CSS/SVG recreation below is the background; the
   * artwork is never stretched (object-fit: cover).
   */
  readonly artworkAvailable = signal(true);

  readonly bannerLabel = computed(
    () => POSITION_BANNER_LABELS[this.slide().position],
  );

  /**
   * Home / team as one logical field: joined with ' · ' when both
   * exist, just the single value otherwise (never a leftover separator).
   */
  readonly homeTeamLabel = computed(() =>
    [this.slide().homeName, this.slide().teamName]
      .filter((part) => part.trim() !== '')
      .join(' · '),
  );

  /** Event category from the catalogue; '' when the slide carries none. */
  readonly categoryLabel = computed(() => this.slide().category?.trim() ?? '');

  readonly categoryMissing = computed(() => this.categoryLabel() === '');

  /** Marigold garland: flower centres along eight scalloped garland arcs. */
  readonly garlandFlowers = computed(() => {
    const flowers: { cx: number; cy: number; alternate: boolean }[] = [];

    for (let scallop = 0; scallop < 8; scallop++) {
      const x0 = scallop * 200;

      for (let step = 1; step <= 9; step++) {
        const t = step / 10;
        const u = 1 - t;
        // Quadratic bezier along the scallop (0,10) -> ctrl (100,180) -> (200,10).
        const cx = u * u * x0 + 2 * u * t * (x0 + 100) + t * t * (x0 + 200);
        const cy = u * u * 10 + 2 * u * t * 180 + t * t * 10;
        flowers.push({ cx, cy, alternate: (scallop + step) % 2 === 0 });
      }
    }

    return flowers;
  });

  /** Eight scallop arcs joined into one path (the garland string). */
  readonly garlandArcs = (() => {
    let path = '';

    for (let scallop = 0; scallop < 8; scallop++) {
      path += `M${scallop * 200} 10 Q${scallop * 200 + 100} 180 ${scallop * 200 + 200} 10 `;
    }

    return path;
  })();
}
