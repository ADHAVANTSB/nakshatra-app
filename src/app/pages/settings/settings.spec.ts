import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService, type GoogleAuthenticatedUser } from '../../core/services/auth/auth.service';
import {
  UserAdminService,
  type UserAdminServiceRole,
} from '../../core/services/users/user-admin.service';
import type { ApiResponse, ApplicationUser, UserMutationData } from '../../core/models';
import { Settings } from './settings';

const ADMIN_SESSION_USER: GoogleAuthenticatedUser = {
  id: 'spec-admin-session',
  googleId: 'spec-google-admin-session',
  email: 'asha.admin@nakshatra.local',
  displayName: 'Asha Rao',
  role: 'ADMIN',
  accessStatus: 'APPROVED',
  version: 1,
};

function backendUser(overrides: Partial<ApplicationUser> = {}): ApplicationUser {
  return {
    id: 'spec-user-1',
    displayName: 'Vikram Menon',
    email: 'vikram.menon@nakshatra.local',
    role: 'SUPPORT',
    accessStatus: 'APPROVED',
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'backend',
    updatedAt: '2026-01-02T00:00:00.000Z',
    updatedBy: 'backend',
    ...overrides,
  };
}

const APPROVED_USER = backendUser();
const PENDING_USER = backendUser({
  id: 'spec-user-2',
  displayName: 'Meera Iyer',
  email: 'meera.iyer@nakshatra.local',
  role: 'CERTIFICATE_TEAM',
  accessStatus: 'PENDING',
  requestedRole: 'EVENTS_TEAM',
  requestedAt: '2026-01-03T00:00:00.000Z',
});

type ListUsersStub = () => Promise<ApiResponse<{ users: ApplicationUser[] }>>;

/**
 * In-memory stand-in for UserAdminService. No network access from unit tests;
 * `listUsers` is swappable per test to reproduce loading and error paths.
 */
function stubUserAdminService(listUsers: ListUsersStub): UserAdminService {
  const mutationFailure = (): Promise<ApiResponse<UserMutationData>> =>
    Promise.resolve({ success: false, error: { code: 'SPEC_UNUSED', message: 'Not used in this spec.' } });

  return {
    listUsers,
    createUser: () => mutationFailure(),
    approveUser: () => mutationFailure(),
    rejectUser: () => mutationFailure(),
    disableUser: () => mutationFailure(),
    enableUser: () => mutationFailure(),
    updateUserRole: (_userId: string, _version: number, _role: UserAdminServiceRole) => mutationFailure(),
  } as unknown as UserAdminService;
}

function host(fixture: ComponentFixture<Settings>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('Settings — access management loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function createFixture(listUsers: ListUsersStub): Promise<ComponentFixture<Settings>> {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Network access is disabled for Settings unit tests.')));

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([]),
        { provide: UserAdminService, useValue: stubUserAdminService(listUsers) },
      ],
    }).compileComponents();

    TestBed.inject(AuthService).setGoogleAuthenticatedUser(ADMIN_SESSION_USER);

    const fixture = TestBed.createComponent(Settings);
    return fixture;
  }

  it('sends the first listUsers request and renders the backend users', async () => {
    let listUsersCalls = 0;
    const fixture = await createFixture(() => {
      listUsersCalls += 1;
      return Promise.resolve({ success: true, data: { users: [APPROVED_USER, PENDING_USER] } });
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = host(fixture);

    // Reproduction for the reported bug: the initial reload() call bailed out
    // because `loading` was initialized to true, so no request was ever sent
    // and the page stayed on "Loading users…" forever.
    expect(listUsersCalls).toBe(1);
    expect(element.textContent).not.toContain('Loading users');

    expect(element.textContent).toContain('Vikram Menon');
    expect(element.textContent).toContain('Meera Iyer');
    expect(fixture.componentInstance.loaded()).toBe(true);
  });

  it('shows the load error state instead of a spinner when the backend refuses', async () => {
    const fixture = await createFixture(() =>
      Promise.resolve({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'The backend refused the user list request.' },
      })
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = host(fixture);

    expect(element.textContent).not.toContain('Loading users');
    expect(element.textContent).toContain('The backend refused the user list request.');
    expect(fixture.componentInstance.loadError()).toBe('The backend refused the user list request.');
  });

  it('re-reads the backend when Refresh is clicked', async () => {
    let listUsersCalls = 0;
    const fixture = await createFixture(() => {
      listUsersCalls += 1;
      return Promise.resolve({ success: true, data: { users: [APPROVED_USER] } });
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const refreshButton = Array.from(host(fixture).querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Refresh');

    if (!refreshButton) {
      throw new Error('Refresh button must be rendered');
    }

    refreshButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listUsersCalls).toBe(2);
    expect(host(fixture).textContent).toContain('Vikram Menon');
    expect(host(fixture).textContent).not.toContain('Loading users');
  });
});
