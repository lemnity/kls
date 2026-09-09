import { NextResponse } from 'next/server';

import { apiFetch } from '../../../lib/api.js';
import { getSessionToken } from '../../../lib/session.js';

/**
 * Thin authenticated proxy from the browser to the NestJS API.
 *
 * The API expects `Authorization: Bearer <token>`, and the token lives only
 * in an httpOnly cookie the browser can't read — so client components call
 * `/api/proxy/<v1 path>` instead of the API directly, and this route reads
 * the cookie server-side and forwards the request with the header attached.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { path } = await params;
  const search = new URL(request.url).search;
  const bodyText =
    request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
  // Some mutating endpoints (e.g. accept/lead-decision-less actions) are
  // called with no body at all; forwarding an empty string with
  // `content-type: application/json` anyway makes Fastify's body parser
  // reject it ("Body cannot be empty..."), so only attach both when there
  // actually is a body.
  const hasBody = bodyText.length > 0;

  const response = await apiFetch(`/v1/${path.join('/')}${search}`, {
    method: request.method,
    token,
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    ...(hasBody ? { body: bodyText } : {}),
  });

  const responseText = await response.text();
  return new NextResponse(responseText || null, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
