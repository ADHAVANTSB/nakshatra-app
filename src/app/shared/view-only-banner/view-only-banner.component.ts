import { Component, computed, inject, input } from '@angular/core';

import { AuthService } from '../../core/services/auth/auth.service';
import {
  PermissionSection,
  VIEW_ONLY_MESSAGE,
  VIEW_ONLY_TITLE,
  canEditModule,
} from '../../core/permissions/role-matrix';

/**
 * Subtle information banner for pages the signed-in role can view but not
 * edit. Hidden entirely for roles with edit access. Presentation only — the
 * backend enforces authorization on every request regardless of this banner.
 */
@Component({
  selector: 'app-view-only-banner',
  template: `
    @if (visible()) {
      <div class="view-only-banner" role="note">
        <strong>{{ title }}</strong>
        <span>{{ message }}</span>
      </div>
    }
  `,
  styles: [`
    .view-only-banner {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      align-items: baseline;
      margin-bottom: 16px;
      padding: 12px 16px;
      border: 1px solid #dfebf1;
      border-radius: 10px;
      background: #f2f9fd;
      color: #17324d;
      font-size: 13px;
    }
    .view-only-banner strong { color: #066a8c; }
    .view-only-banner span { color: #4a6b85; }
  `],
})
export class ViewOnlyBannerComponent {
  private readonly auth = inject(AuthService);

  readonly section = input.required<PermissionSection>();

  readonly title = VIEW_ONLY_TITLE;
  readonly message = VIEW_ONLY_MESSAGE;

  /** Shown only to signed-in roles that can view but not edit this module. */
  readonly visible = computed(() => {
    const role = this.auth.currentUser()?.role;
    return !!role && !canEditModule(role, this.section());
  });
}
