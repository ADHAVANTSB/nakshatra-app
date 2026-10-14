import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PROGRAMS } from '../../core/constants/program-context.config';
import { ProgramContextService } from '../../core/services/program/program-context.service';
import { SelectProgram } from './select-program';

@Component({ selector: 'zone-route-stub', template: 'zone-route-stub' })
class ZoneRouteStub {}

/** Program selection page: first step of the post-sign-in scope flow. */
describe('SelectProgram', () => {
  let fixture: ComponentFixture<SelectProgram>;

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [SelectProgram, ZoneRouteStub],
      providers: [provideRouter([{ path: 'select-zone', component: ZoneRouteStub }])],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectProgram);
    fixture.detectChanges();
  });

  it('renders one card per configured program', () => {
    const element = fixture.nativeElement as HTMLElement;
    const cards = Array.from(element.querySelectorAll('.nk-program-card'));

    expect(cards.length).toBe(PROGRAMS.length);
    const cardText = cards.map(card => card.textContent ?? '').join('\n');
    for (const program of PROGRAMS) {
      expect(cardText).toContain(program.label);
    }
  });

  it('renders every program choice as a real button for keyboard access', () => {
    const element = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll('.nk-program-card'));

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
    }
  });

  it('stores the chosen program and continues to zone selection', async () => {
    const element = fixture.nativeElement as HTMLElement;
    const artsCard = Array.from(element.querySelectorAll<HTMLButtonElement>('.nk-program-card'))
      .find(card => card.textContent?.includes('Arts'));

    expect(artsCard).toBeDefined();
    artsCard!.click();
    await fixture.whenStable();

    const context = TestBed.inject(ProgramContextService);
    expect(context.program()?.id).toBe('ARTS');
    expect(context.zone()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/select-zone');
  });
});
