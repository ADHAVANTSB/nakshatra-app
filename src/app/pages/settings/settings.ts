import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessStatus, ApplicationRole, ApplicationUser } from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';

@Component({
  selector: 'nk-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly auth = inject(AuthService);
  readonly users = this.auth.users$;
  readonly search = signal('');
  readonly status = signal<AccessStatus | ''>('');
  readonly role = signal<ApplicationRole | ''>('');
  readonly errors = signal<string[]>([]);
  readonly message = signal('');
  readonly pendingRole = signal<Record<string, ApplicationRole>>({});
  readonly confirmation = signal<{ user: ApplicationUser; action: 'REJECT' | 'DISABLE' } | null>(null);
  readonly filteredUsers = computed(() => {
    const query = this.search().toLowerCase().trim();
    return this.users().filter(user => (!this.status() || user.accessStatus === this.status()) && (!this.role() || user.role === this.role()) && (!query || [user.displayName, user.email].some(value => value.toLowerCase().includes(query))));
  });

  setSearch(value: string): void { this.search.set(value); }
  setStatus(value: AccessStatus | ''): void { this.status.set(value); }
  setRole(value: ApplicationRole | ''): void { this.role.set(value); }
  setPendingRole(userId: string, role: ApplicationRole): void { this.pendingRole.update(current => ({ ...current, [userId]: role })); }
  selectedRole(user: ApplicationUser): ApplicationRole { return this.pendingRole()[user.id] ?? user.role ?? 'SUPPORT'; }
  approve(user: ApplicationUser): void { this.apply(this.auth.approve(user.id, this.selectedRole(user)), `${user.displayName} approved.`); }
  assignRole(user: ApplicationUser): void { this.apply(this.auth.assignRole(user.id, this.selectedRole(user)), `${user.displayName}'s role updated.`); }
  enable(user: ApplicationUser): void { this.apply(this.auth.enable(user.id), `${user.displayName} enabled.`); }
  requestConfirmation(user: ApplicationUser, action: 'REJECT' | 'DISABLE'): void { this.confirmation.set({ user, action }); }
  cancelConfirmation(): void { this.confirmation.set(null); }
  confirm(): void { const item = this.confirmation(); if (!item) return; this.confirmation.set(null); this.apply(item.action === 'REJECT' ? this.auth.reject(item.user.id) : this.auth.disable(item.user.id), `${item.user.displayName} ${item.action === 'REJECT' ? 'rejected' : 'disabled'}.`); }
  roleLabel(role?: ApplicationRole): string { return role?.replace('_', ' ') ?? 'Unassigned'; }

  private apply(result: { success: boolean; errors: string[] }, successMessage: string): void { this.errors.set(result.errors); this.message.set(result.success ? successMessage : ''); }
}
