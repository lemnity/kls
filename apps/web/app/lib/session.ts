import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = 'kulisa_session';

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}
