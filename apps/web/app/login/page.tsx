'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { LogoMark } from '../icons.js';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });

    setPending(false);
    if (!response.ok) {
      setError('Неверный email или пароль.');
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand brand--auth">
          <LogoMark />
          <span className="brand-name">КУЛИСА</span>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <p className="eyebrow">Платформа КУЛИСА</p>
          <h1>С возвращением</h1>
          <p className="muted auth-subtitle">Войдите, чтобы открыть пульт постановки.</p>

          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required data-testid="email-input" />

          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />

          {error ? (
            <p role="alert" data-testid="login-error" className="auth-error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-pill btn-pill--accent" disabled={pending} data-testid="login-submit">
            {pending ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </main>
  );
}
