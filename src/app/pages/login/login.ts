import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth/auth.service';

@Component({ selector: 'nk-login', imports: [FormsModule, RouterLink], templateUrl: './login.html', styleUrl: './login.scss' })
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly email = signal('admin@nakshatra.local');
  readonly password = signal('');
  readonly errors = signal<string[]>([]);
  readonly loading = signal(false);

  login(): void {
    this.errors.set([]);
    this.loading.set(true);
    const result = this.auth.login(this.email(), this.password());
    this.loading.set(false);
    if (!result.success) { this.errors.set(result.errors); return; }
    void this.router.navigateByUrl('/dashboard');
  }
}
