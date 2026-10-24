import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZONES } from '../../core/constants/program-context.config';
import { ApiClientService } from '../../core/services/api/api-client.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { ProgramContextService } from '../../core/services/program/program-context.service';
import { SelectZone } from './select-zone';

@Component({ selector: 'program-route-stub', template: 'program-route-stub' })
class ProgramRouteStub {}

@Component({ selector: 'dashboard-route-stub', template: 'dashboard-route-stub' })
class DashboardRouteStub {}

const ADMIN_SESSION = {
  id: 'spec-session-zone',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

/** Zone selection page: second step of the post-sign-in scope flow. */
describe('SelectZone', () => {
  let fixture: ComponentFixture<SelectZone>;
  let context: ProgramContextService;

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [SelectZone, ProgramRouteStub, DashboardRouteStub],
      providers: [
        provideRouter([
          { path: 'select-program', component: ProgramRouteStub },
          { path: 'dashboard', component: DashboardRouteStub },
        ]),
      ],
    }).compileComponents();

    context = TestBed.inject(ProgramContextService);
    fixture = TestBed.createComponent(SelectZone);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    TestBed.inject(AuthService).logout();
    context.clear();
  });

  function signIn(): void {
    TestBed.inject(AuthService).setGoogleAuthenticatedUser({
      id: 'spec-user',
      googleId: 'spec-google',
      email: 'admin@nakshatra.local',
      displayName: 'Admin',
      role: 'ADMIN',
      accessStatus: 'APPROVED',
      version: 1,
    });
    TestBed.inject(AuthService).setApplicationSession(ADMIN_SESSION);
  }

  function stubScopeEndpoint(body: object): void {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify(body),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
  }

  it('renders only the event card — Zone 1 and Zone 2 stay hidden', () => {
    context.selectProgram('ARTS');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const cards = Array.from(element.querySelectorAll('.nk-zone-card'));

    // Zone 1 / Zone 2 cards were removed from this page (organiser decision);
    // their scopes remain valid, they are just not selectable here.
    expect(cards.length).toBe(ZONES.filter(zone => !zone.hidden).length);
    const cardText = cards.map(card => card.textContent ?? '').join('\n');
    expect(cardText).toContain('Nakshatra Arts 25OCT');
    expect(cardText).not.toContain('Zone 1');
    expect(cardText).not.toContain('Zone 2');
  });

  it('shows no date and none of the removed copy on the event card', () => {
    context.selectProgram('ARTS');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const cardText = Array.from(element.querySelectorAll('.nk-zone-card'))
      .map(card => card.textContent ?? '')
      .join('\n');

    // Zone 1 / Zone 2 (the dated cards) are hidden, and the event card has
    // no date — nothing is invented and the removed copy stays gone.
    expect(cardText).not.toContain('2026');
    expect(cardText).not.toContain('to be confirmed');
    expect(cardText).not.toContain('Rehearsal scope');
    expect(element.querySelector('.nk-zone-date')).toBeNull();
  });

  it('renders the event badge on the only offered card', () => {
    context.selectProgram('ARTS');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const badges = Array.from(element.querySelectorAll('.nk-zone-card .nk-zone-environment'))
      .map(badge => badge.textContent?.trim() ?? '');

    // The hidden live zones leave no 'Live' badge on this page any more.
    expect(badges).toEqual(['Nakshatra Arts 25OCT']);
  });

  it('persists the scope on the server session and enters the dashboard', async () => {
    signIn();
    const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
    stubScopeEndpoint({
      success: true,
      data: { scope: { programId: 'ARTS', environmentId: 'TEST' } },
    });
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      calls.push({ action: JSON.parse(init.body).action, payload: JSON.parse(init.body).payload });
      return Promise.resolve(new Response(
        JSON.stringify({ success: true, data: { scope: { programId: 'ARTS', environmentId: 'TEST' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    });

    context.selectProgram('ARTS');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const zoneCard = Array.from(element.querySelectorAll<HTMLButtonElement>('.nk-zone-card'))
      .find(card => card.textContent?.includes('Nakshatra Arts 25OCT'));

    zoneCard!.click();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(calls.some(c => c.action === 'selectScope' &&
      c.payload['programId'] === 'ARTS' && c.payload['environmentId'] === 'TEST')).toBe(true);
    expect(context.hasCompleteScope()).toBe(true);
    expect(context.zone()?.id).toBe('TEST');
    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('stays on the page and reports the error when the server rejects the scope', async () => {
    signIn();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: 'ENVIRONMENT_INVALID', message: 'Environment must be one of: TEST, ZONE_1, ZONE_2' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    context.selectProgram('ARTS');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const zoneCard = Array.from(element.querySelectorAll<HTMLButtonElement>('.nk-zone-card'))
      .find(card => card.textContent?.includes('Nakshatra Arts 25OCT'));

    zoneCard!.click();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 10));

    // The unconfirmed scope is reverted and the backend message is surfaced.
    expect(context.zone()).toBeNull();
    expect(context.scopeSaveError()).toBeTruthy();
    fixture.detectChanges();
    expect(element.textContent).toContain('Environment must be one of');
    // The user is never navigated into the app on a failed scope save.
    expect(TestBed.inject(Router).url).not.toBe('/dashboard');
  });

  it('returns to program selection via the change-program action', async () => {
    context.selectProgram('ARTS');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const change = Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => /change program/i.test(button.textContent ?? ''));

    expect(change).toBeDefined();
    change!.click();
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/select-program');
  });

  it('offers a way back to program selection when the page is opened without a program', () => {
    // Defensive: the route guard normally prevents this, but the page must not
    // render a broken zone list without a program.
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.nk-zone-card').length).toBe(0);
    expect(element.textContent ?? '').toContain('program');
  });
});
