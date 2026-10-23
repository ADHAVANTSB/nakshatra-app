import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from './dashboard';

/** Dashboard hero branding: greeting flow and the smiley welcome icon. */
describe('Dashboard hero', () => {
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    // The shell must never reach the network from a unit test.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Network access is disabled.')));

    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows Happy Volunteering before the time-of-day greeting', () => {
    const hero = (fixture.nativeElement as HTMLElement).querySelector('.welcome-content');
    expect(hero).not.toBeNull();

    const text = hero!.textContent ?? '';
    const volunteering = text.indexOf('Happy Volunteering');
    const greeting = text.indexOf(fixture.componentInstance.greeting);

    expect(volunteering).toBeGreaterThanOrEqual(0);
    expect(greeting).toBeGreaterThan(volunteering);
  });

  it('renders a smiley emoji as the welcome icon', () => {
    const icon = (fixture.nativeElement as HTMLElement).querySelector('.welcome-icon');
    expect(icon).not.toBeNull();
    expect(icon!.textContent ?? '').toContain('😊');
    expect(icon!.getAttribute('aria-hidden')).toBe('true');
  });
});
