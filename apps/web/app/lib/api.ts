function getApiUrl(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error('API_URL is required');
  return url;
}

export async function apiFetch(
  path: string,
  init: Omit<RequestInit, 'headers'> & { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;
  return fetch(`${getApiUrl()}${path}`, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });
}
