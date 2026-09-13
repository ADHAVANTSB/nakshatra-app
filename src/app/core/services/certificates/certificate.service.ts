import { Injectable, inject, signal } from '@angular/core';
import { Certificate, Score } from '../../models';
import { EventService } from '../events/event.service';
import { ScoringService } from '../scoring/scoring.service';

export interface CertificateResult {
  success: boolean;
  certificate?: Certificate;
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class CertificateService {
  private readonly eventService = inject(EventService);
  private readonly scoringService = inject(ScoringService);
  private readonly certificates = signal<Certificate[]>([]);

  readonly certificates$ = this.certificates.asReadonly();
  readonly workflowConfigured = signal(false).asReadonly();

  getByEvent(eventId: string): Certificate[] {
    return this.certificates().filter(certificate => certificate.eventId === eventId);
  }

  getByScoreId(scoreId: string): Certificate | undefined {
    return this.certificates().find(certificate => certificate.scoreId === scoreId);
  }

  generate(scoreId: string, createdBy = 'ADMIN'): CertificateResult {
    const errors = this.validateGeneration(scoreId);
    if (errors.length) return { success: false, errors };

    const score = this.scoringService.getByEvent(
      this.findScoreEventId(scoreId)!
    ).find(item => item.id === scoreId)!;
    const now = new Date().toISOString();
    const certificate: Certificate = {
      id: crypto.randomUUID(),
      eventId: score.eventId,
      participantId: score.participantId,
      teamId: score.teamId,
      scoreId: score.id,
      status: 'GENERATED',
      version: 1,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy,
    };
    this.certificates.update(current => [...current, certificate]);
    return { success: true, certificate, errors: [] };
  }

  private validateGeneration(scoreId: string): string[] {
    const score = this.findScore(scoreId);
    if (!score) return ['Finalized score not found.'];
    if (score.status !== 'FINALIZED') return ['Certificates can only be generated from finalized scores.'];
    const event = this.eventService.getById(score.eventId);
    if (!event) return ['Event not found.'];
    if (event.status !== 'ACTIVE') return ['Certificates cannot be generated for a non-active event.'];
    if ((!score.participantId && !score.teamId) || (score.participantId && score.teamId)) {
      return ['Certificate target must be exactly one participant or team.'];
    }
    if (this.getByScoreId(score.id)) return ['A certificate record already exists for this finalized score.'];
    if (!this.workflowConfigured()) {
      return ['Certificate generation is unavailable until official eligibility rules and a certificate template are configured.'];
    }
    return [];
  }

  private findScore(scoreId: string): Score | undefined {
    return this.eventService.getAll()
      .flatMap(event => this.scoringService.getByEvent(event.id))
      .find(score => score.id === scoreId);
  }

  private findScoreEventId(scoreId: string): string | undefined {
    return this.findScore(scoreId)?.eventId;
  }
}
