import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth/auth.service';

@Component({ selector: 'nk-register', imports: [FormsModule, RouterLink], templateUrl: './register.html', styleUrl: './register.scss' })
export class Register {
  private readonly auth = inject(AuthService);
  readonly name = signal(''); readonly email = signal(''); readonly password = signal(''); readonly errors = signal<string[]>([]); readonly submitted = signal(false);
  register(): void {
    this.errors.set([]); this.submitted.set(false);
    if (!this.password()) { this.errors.set(['Password is required for the future login experience.']); return; }
    const result = this.auth.register(this.name(), this.email());
    if (!result.success) { this.errors.set(result.errors); return; }
    this.password.set(''); this.submitted.set(true);
  }
}
