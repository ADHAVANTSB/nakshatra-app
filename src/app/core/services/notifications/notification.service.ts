import { Injectable, signal } from '@angular/core';

export type NotificationTone = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: number;
  tone: NotificationTone;
  message: string;
  detail?: string;
}

const DEFAULT_DURATION_MS = 6000;

/**
 * Compact, non-blocking notifications.
 *
 * A normal mutation outcome — a save, a registration, an approval, or a skipped
 * source write-back — is reported here instead of replacing page content. Only a
 * genuine read failure is surfaced as a page-level error state.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly items = signal<AppNotification[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly notifications = this.items.asReadonly();

  success(message: string, detail?: string): void {
    this.push('success', message, detail);
  }

  error(message: string, detail?: string): void {
    this.push('error', message, detail);
  }

  warning(message: string, detail?: string): void {
    this.push('warning', message, detail);
  }

  info(message: string, detail?: string): void {
    this.push('info', message, detail);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.items.update(current => current.filter(item => item.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.items.set([]);
  }

  private push(tone: NotificationTone, message: string, detail?: string): void {
    const id = this.nextId++;

    this.items.update(current => [...current, { id, tone, message, detail }]);

    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), tone === 'error' ? DEFAULT_DURATION_MS * 2 : DEFAULT_DURATION_MS)
    );
  }
}
