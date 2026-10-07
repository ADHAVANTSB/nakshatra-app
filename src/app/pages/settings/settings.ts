import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AccessStatus,
  ApiError,
  ApiResponse,
  ApplicationRole,
  ApplicationUser,
  UserMutationData,
} from '../../core/models';
import { AuthService } from '../../core/services/auth/auth.service';
import { NotificationService } from '../../core/services/notifications/notification.service';
import { UserAdminService } from '../../core/services/users/user-admin.service';

/** The five application roles the backend accepts. */
const ROLES: readonly ApplicationRole[] = [
  'ADMIN',
  'SUPPORT',
  'EVENTS_TEAM',
  'LIAISON_TEAM',
  'CERTIFICATE_TEAM',
];

/** Access statuses the backend reports for an application user. */
const ACCESS_STATUSES: readonly AccessStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'DISABLED',
];

const ROLE_LABELS: Readonly<Record<ApplicationRole, string>> = {
  ADMIN: 'Admin',
  SUPPORT: 'Support',
  EVENTS_TEAM: 'Events Team',
  LIAISON_TEAM: 'Liaison Team',
  CERTIFICATE_TEAM: 'Certificate Team',
};

/**
 * Pill tone per status token.
 *
 * The token itself is always rendered exactly as the backend sent it; this map
 * only chooses a colour. Anything the backend reports outside this table falls
 * through to a neutral pill rather than being mapped onto a state the backend
 * did not send. No transition is inferred from any other field.
 */
const STATUS_TONES: Readonly<Record<string, string>> = {
  PENDING: 'pill pending',
  APPROVED: 'pill approved',
  UNLOCKED: 'pill approved',
  PASSED: 'pill approved',
  REJECTED: 'pill rejected',
  DISABLED: 'pill rejected',
  LOCKED: 'pill rejected',
  FAILED: 'pill rejected',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERSION_CONFLICT_CODE = 'VERSION_CONFLICT';
const VERSION_CONFLICT_MESSAGE = 'This user was updated elsewhere. Refresh and try again.';

/** A destructive or consequential action awaiting explicit confirmation. */
type PendingConfirmation =
  | { kind: 'REJECT'; user: ApplicationUser }
  | { kind: 'DISABLE'; user: ApplicationUser }
  | { kind: 'ENABLE'; user: ApplicationUser }
  | { kind: 'ROLE'; user: ApplicationUser; role: ApplicationRole };

/** Inline field messages for the add-user form. */
interface NewUserFieldErrors {
  email: string;
  displayName: string;
  role: string;
}

/** A rejected write because the stored row moved on underneath us. */
interface VersionClash {
  displayName: string;
  message: string;
}

function toRole(value: string): ApplicationRole | null {
  return (ROLES as readonly string[]).includes(value) ? (value as ApplicationRole) : null;
}

function toAccessStatus(value: string): AccessStatus | null {
  return (ACCESS_STATUSES as readonly string[]).includes(value) ? (value as AccessStatus) : null;
}

/**
 * Access management.
 *
 * Application users are owned by the backend. `UserAdminService` is the only
 * source for this page: it is read once on init, and re-read from the server
 * after every mutation, so no row is ever patched locally and reported as
 * saved. There is no frontend user dataset and no seeded account.
 *
 * Every mutation carries the row `version` as `expectedVersion`. A stale write
 * comes back as VERSION_CONFLICT, which is surfaced as a refresh prompt instead
 * of being retried or overwritten.
 *
 * `canAccess('ACCESS_MANAGEMENT')` decides whether mutation controls are
 * rendered. Hiding a control is a user-interface affordance only — the Apps
 * Script backend re-checks every action and is the authoritative guard.
 */
@Component({
  selector: 'nk-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly admin = inject(UserAdminService);
  private readonly notifications = inject(NotificationService);

  // ---------------------------------------------------------
  // CONSTANTS
  // ---------------------------------------------------------

  readonly roles = ROLES;
  readonly accessStatuses = ACCESS_STATUSES;

  // ---------------------------------------------------------
  // BACKEND STATE
  // ---------------------------------------------------------

  readonly users = signal<ApplicationUser[]>([]);
  /** First read; drives the page-level loading state. */
  readonly loading = signal(true);
  /** Re-read of an already-loaded list; keeps the table on screen. */
  readonly refreshing = signal(false);
  /** A failed list read, and the only page-level error state. */
  readonly loadError = signal('');
  /** The backend answered at least once. */
  readonly loaded = signal(false);
  /** Id of the user whose mutation is in flight, if any. */
  readonly busyUserId = signal('');

  readonly busy = computed(() => this.busyUserId() !== '');

  // ---------------------------------------------------------
  // SESSION
  // ---------------------------------------------------------

  readonly signedInUser = this.auth.currentUser;

  /**
   * Read-only unless the signed-in user may access access management. This is
   * UX only: the backend re-authorizes every call it receives.
   */
  readonly canManage = computed(() => this.auth.canAccess('ACCESS_MANAGEMENT'));

  // ---------------------------------------------------------
  // FILTERS
  // ---------------------------------------------------------

  readonly search = signal('');
  readonly status = signal<AccessStatus | ''>('');
  readonly role = signal<ApplicationRole | ''>('');

  readonly hasFilters = computed(
    () => this.search().trim() !== '' || this.status() !== '' || this.role() !== ''
  );

  readonly filteredUsers = computed<ApplicationUser[]>(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.status();
    const role = this.role();

    return this.users().filter(user => {
      if (status && user.accessStatus !== status) {
        return false;
      }

      if (role && user.role !== role) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [user.displayName, user.email].some(value => value.toLowerCase().includes(query));
    });
  });

  /** Awaiting an administrator decision; never derived from another status. */
  readonly pendingUsers = computed<ApplicationUser[]>(() =>
    this.users().filter(user => user.accessStatus === 'PENDING')
  );

  // ---------------------------------------------------------
  // ROW ROLE DRAFTS
  // ---------------------------------------------------------

  /**
   * Per-row role selection. Changing a select only moves the draft; it never
   * mutates the stored role. A separate confirmation sends the write.
   */
  readonly roleDrafts = signal<Record<string, ApplicationRole>>({});

  // ---------------------------------------------------------
  // APPROVAL
  // ---------------------------------------------------------

  readonly approval = signal<{ user: ApplicationUser; role: ApplicationRole } | null>(null);

  // ---------------------------------------------------------
  // CONFIRMATION
  // ---------------------------------------------------------

  readonly confirmation = signal<PendingConfirmation | null>(null);

  // ---------------------------------------------------------
  // VERSION CONFLICT
  // ---------------------------------------------------------

  readonly conflict = signal<VersionClash | null>(null);

  // ---------------------------------------------------------
  // ADD USER
  // ---------------------------------------------------------

  readonly addOpen = signal(false);
  readonly newEmail = signal('');
  readonly newDisplayName = signal('');
  /** Held as a raw string so the empty selection can be validated. */
  readonly newRole = signal('');
  readonly newFieldErrors = signal<NewUserFieldErrors>({ email: '', displayName: '', role: '' });
  readonly newFormError = signal('');
  readonly newSuccess = signal('');
  readonly newSubmitting = signal(false);

  // ---------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------

  ngOnInit(): void {
    void this.reload();
  }

  // ---------------------------------------------------------
  // READING
  // ---------------------------------------------------------

  /**
   * Reads the user list from the backend.
   *
   * A failed read before anything has loaded replaces the page body, because
   * there is nothing truthful to show. A failed re-read keeps the rows already
   * on screen and reports through a notification instead of blanking the page.
   */
  async reload(): Promise<void> {
    if (this.loading() || this.refreshing()) {
      return;
    }

    if (this.loaded()) {
      this.refreshing.set(true);
    } else {
      this.loading.set(true);
    }

    this.loadError.set('');

    const result = await this.admin.listUsers();

    this.loading.set(false);
    this.refreshing.set(false);

    if (!result.success) {
      if (this.loaded() && this.users().length) {
        this.notifications.error('The user list could not be refreshed.', result.error.message);
      } else {
        this.users.set([]);
        this.loadError.set(result.error.message);
      }

      return;
    }

    this.users.set(result.data.users);
    this.loaded.set(true);
    // Drafts are keyed by row and would otherwise survive a role change.
    this.roleDrafts.set({});
    this.conflict.set(null);
  }

  dismissConflict(): void {
    this.conflict.set(null);
  }

  // ---------------------------------------------------------
  // FILTERS
  // ---------------------------------------------------------

  setSearch(value: string): void {
    this.search.set(value);
  }

  setStatus(value: string): void {
    this.status.set(toAccessStatus(value) ?? '');
  }

  setRole(value: string): void {
    this.role.set(toRole(value) ?? '');
  }

  clearFilters(): void {
    this.search.set('');
    this.status.set('');
    this.role.set('');
  }

  // ---------------------------------------------------------
  // ROW ROLE DRAFT
  // ---------------------------------------------------------

  roleDraft(user: ApplicationUser): ApplicationRole {
    return this.roleDrafts()[user.id] ?? user.role ?? 'SUPPORT';
  }

  setRoleDraft(userId: string, value: string): void {
    const role = toRole(value);

    if (!role) {
      return;
    }

    this.roleDrafts.update(current => ({ ...current, [userId]: role }));
  }

  /** True only when the draft differs from the role the backend returned. */
  roleChangePending(user: ApplicationUser): boolean {
    return this.roleDraft(user) !== (user.role ?? 'SUPPORT');
  }

  clearRoleDraft(user: ApplicationUser): void {
    this.roleDrafts.update(current => {
      const next = { ...current };
      delete next[user.id];
      return next;
    });
  }

  // ---------------------------------------------------------
  // APPROVAL
  // ---------------------------------------------------------

  /** Opens the approval panel with the requested role pre-selected. */
  openApproval(user: ApplicationUser): void {
    if (!this.canManage() || this.busy() || user.accessStatus !== 'PENDING') {
      return;
    }

    this.approval.set({
      user,
      role: user.requestedRole ?? user.role ?? 'SUPPORT',
    });
  }

  setApprovalRole(value: string): void {
    const role = toRole(value);

    if (!role) {
      return;
    }

    this.approval.update(current => (current ? { ...current, role } : current));
  }

  closeApproval(): void {
    if (this.busy()) {
      return;
    }

    this.approval.set(null);
  }

  /**
   * Approves the pending request with the role selected in the panel.
   *
   * The email is only reported as sent when the backend confirms it with
   * `notified: true`; an absent or false flag never claims a delivery.
   */
  async confirmApproval(): Promise<void> {
    const pending = this.approval();

    if (!pending || this.busy()) {
      return;
    }

    const { user, role } = pending;
    const result = await this.mutate(
      user,
      () => this.admin.approveUser(user.id, user.version, role),
      'Approval failed'
    );

    // The panel closes either way, so the outcome is never left hidden behind
    // the overlay: success refreshes the list, and a refusal shows the
    // page-level conflict or error report.
    this.approval.set(null);

    if (!result.success) {
      return;
    }

    if (result.data.notified === true) {
      this.notifications.success('User approved. An email has been sent.');
    } else {
      this.notifications.success('User approved.', 'The backend did not confirm that an email was sent.');
    }

    await this.reload();
  }

  // ---------------------------------------------------------
  // CONFIRMATION
  // ---------------------------------------------------------

  requestRejection(user: ApplicationUser): void {
    if (!this.canManage() || this.busy() || user.accessStatus !== 'PENDING') {
      return;
    }

    this.confirmation.set({ kind: 'REJECT', user });
  }

  requestDisable(user: ApplicationUser): void {
    // Disabling the signed-in user is never offered, here or on the row.
    if (!this.canManage() || this.busy() || this.isSelf(user) || user.accessStatus !== 'APPROVED') {
      return;
    }

    this.confirmation.set({ kind: 'DISABLE', user });
  }

  requestEnable(user: ApplicationUser): void {
    if (!this.canManage() || this.busy() || user.accessStatus !== 'DISABLED') {
      return;
    }

    this.confirmation.set({ kind: 'ENABLE', user });
  }

  requestRoleChange(user: ApplicationUser): void {
    if (!this.canManage() || this.busy() || !this.roleChangePending(user)) {
      return;
    }

    this.confirmation.set({ kind: 'ROLE', user, role: this.roleDraft(user) });
  }

  cancelConfirmation(): void {
    if (this.busy()) {
      return;
    }

    this.confirmation.set(null);
  }

  confirmationTitle(action: PendingConfirmation): string {
    switch (action.kind) {
      case 'REJECT':
        return `Reject ${action.user.displayName}`;
      case 'DISABLE':
        return `Disable ${action.user.displayName}`;
      case 'ENABLE':
        return `Enable ${action.user.displayName}`;
      case 'ROLE':
        return `Change role for ${action.user.displayName}`;
    }
  }

  confirmationBody(action: PendingConfirmation): string {
    switch (action.kind) {
      case 'REJECT':
        return `${action.user.displayName}'s pending request will be rejected and no access will be granted.`;

      case 'DISABLE':
        return `The backend will terminate ${action.user.displayName}'s current access. They cannot sign in until they are enabled again.`;

      case 'ENABLE':
        return `The backend will return ${action.user.displayName} to approved access.`;

      case 'ROLE':
        return `${action.user.displayName}'s role changes from ${this.roleLabel(action.user.role)} to ${this.roleLabel(action.role)}.`;
    }
  }

  confirmationCta(action: PendingConfirmation): string {
    switch (action.kind) {
      case 'REJECT':
        return 'Reject';
      case 'DISABLE':
        return 'Disable';
      case 'ENABLE':
        return 'Enable';
      case 'ROLE':
        return 'Save role';
    }
  }

  /** The destructive or role-changing confirmation is the only way to write. */
  async confirmAction(): Promise<void> {
    const action = this.confirmation();

    if (!action || this.busy()) {
      return;
    }

    const { user } = action;

    this.confirmation.set(null);

    switch (action.kind) {
      case 'REJECT':
        await this.runRejection(user);
        break;

      case 'DISABLE':
        await this.runDisable(user);
        break;

      case 'ENABLE':
        await this.runEnable(user);
        break;

      case 'ROLE':
        await this.runRoleChange(user, action.role);
        break;
    }
  }

  private async runRejection(user: ApplicationUser): Promise<void> {
    const result = await this.mutate(
      user,
      () => this.admin.rejectUser(user.id, user.version),
      'Rejection failed'
    );

    if (!result.success) {
      return;
    }

    this.notifications.success(`${user.displayName} was rejected.`);
    await this.reload();
  }

  private async runDisable(user: ApplicationUser): Promise<void> {
    if (this.isSelf(user)) {
      this.notifications.warning('You cannot disable your own account.', 'Ask another administrator to do it.');
      return;
    }

    const result = await this.mutate(
      user,
      () => this.admin.disableUser(user.id, user.version),
      'Disable failed'
    );

    if (!result.success) {
      return;
    }

    this.notifications.success(`${user.displayName} was disabled.`);
    await this.reload();
  }

  private async runEnable(user: ApplicationUser): Promise<void> {
    const result = await this.mutate(
      user,
      () => this.admin.enableUser(user.id, user.version),
      'Enable failed'
    );

    if (!result.success) {
      return;
    }

    this.notifications.success(`${user.displayName} was enabled.`);
    await this.reload();
  }

  private async runRoleChange(user: ApplicationUser, role: ApplicationRole): Promise<void> {
    const result = await this.mutate(
      user,
      () => this.admin.updateUserRole(user.id, user.version, role),
      'Role change failed'
    );

    if (!result.success) {
      return;
    }

    this.clearRoleDraft(user);
    this.notifications.success(`${user.displayName}'s role was set to ${this.roleLabel(role)}.`);
    await this.reload();
  }

  // ---------------------------------------------------------
  // ADD USER
  // ---------------------------------------------------------

  openAddUser(): void {
    if (!this.canManage() || this.newSubmitting()) {
      return;
    }

    this.newFormError.set('');
    this.newSuccess.set('');
    this.addOpen.set(true);
  }

  closeAddUser(): void {
    if (this.newSubmitting()) {
      return;
    }

    this.addOpen.set(false);
    this.newSuccess.set('');
  }

  setNewEmail(value: string): void {
    this.newEmail.set(value);
  }

  setNewDisplayName(value: string): void {
    this.newDisplayName.set(value);
  }

  setNewRole(value: string): void {
    this.newRole.set(value);
  }

  /**
   * Creates a backend user.
   *
   * No password is collected or sent: the backend owns credentials entirely.
   * The email, display name and role are validated here before the call, and
   * the field messages come straight from the backend when it refuses.
   */
  async submitNewUser(): Promise<void> {
    if (!this.canManage() || this.newSubmitting()) {
      return;
    }

    const email = this.newEmail().trim().toLowerCase();
    const displayName = this.newDisplayName().trim();
    const role = toRole(this.newRole());

    const errors: NewUserFieldErrors = { email: '', displayName: '', role: '' };

    if (!email) {
      errors.email = 'Email is required.';
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address.';
    }

    if (!displayName) {
      errors.displayName = 'Display name is required.';
    }

    if (!role) {
      errors.role = 'Choose a role.';
    }

    this.newFieldErrors.set(errors);
    this.newFormError.set('');
    this.newSuccess.set('');

    if (!role || errors.email || errors.displayName || errors.role) {
      this.newFormError.set('Correct the highlighted fields and try again.');
      return;
    }

    this.newSubmitting.set(true);

    const result = await this.admin.createUser(email, displayName, role);

    this.newSubmitting.set(false);

    if (!result.success) {
      this.newFormError.set(result.error.message);
      this.notifications.error('The user could not be created.', result.error.message);
      return;
    }

    const emailNote =
      result.data.notified === true
        ? 'An email has been sent.'
        : 'The backend did not confirm that an email was sent.';

    this.newEmail.set('');
    this.newDisplayName.set('');
    this.newRole.set('');
    this.newFieldErrors.set({ email: '', displayName: '', role: '' });
    this.newSuccess.set(`User created. ${emailNote}`);
    this.notifications.success('User created.', emailNote);

    await this.reload();
  }

  // ---------------------------------------------------------
  // MUTATION PLUMBING
  // ---------------------------------------------------------

  /**
   * Sends one user mutation and reports the outcome.
   *
   * The stored version travels as `expectedVersion`, so a concurrent change is
   * refused by the backend rather than overwritten here. Success is only ever
   * reported when the backend returned it; the caller then re-reads the list.
   */
  private async mutate(
    user: ApplicationUser,
    call: () => Promise<ApiResponse<UserMutationData>>,
    failureTitle: string
  ): Promise<ApiResponse<UserMutationData>> {
    this.busyUserId.set(user.id);
    this.conflict.set(null);

    const result = await call();

    this.busyUserId.set('');

    if (!result.success) {
      this.reportFailure(failureTitle, user, result.error);
    }

    return result;
  }

  /** A stale row is never retried automatically; the user is asked to refresh. */
  private reportFailure(title: string, user: ApplicationUser, error: ApiError): void {
    if (error.code === VERSION_CONFLICT_CODE) {
      this.conflict.set({ displayName: user.displayName, message: VERSION_CONFLICT_MESSAGE });
      this.notifications.warning(title, VERSION_CONFLICT_MESSAGE);
      return;
    }

    this.notifications.error(title, error.message);
  }

  // ---------------------------------------------------------
  // LABELS
  // ---------------------------------------------------------

  isSelf(user: ApplicationUser): boolean {
    return this.signedInUser()?.id === user.id;
  }

  /** Colour only. The status token itself is rendered verbatim by the template. */
  statusTone(status: string): string {
    return STATUS_TONES[status] ?? 'pill unknown';
  }

  roleLabel(role?: ApplicationRole): string {
    return role ? ROLE_LABELS[role] : 'Unassigned';
  }
}
