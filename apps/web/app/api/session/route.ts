import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { apiFetch } from '../../lib/api.js';
import { SESSION_COOKIE_NAME } from '../../lib/session.js';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const email = isString(body?.email) ? body.email : undefined;
  const password = isString(body?.password) ? body.password : undefined;
  if (!email || !password) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const response = await apiFetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const session = (await response.json()) as { accessToken: string; expiresAt: string };
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, session.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(session.expiresAt),
  });

  return NextResponse.json({ status: 'ok' });
}

export async function DELETE(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ status: 'ok' });
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
