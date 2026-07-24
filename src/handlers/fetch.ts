import { handleDashboard } from '../routes/dashboard';
import {
  handleApiStatus,
  handleApiHistory,
  handleApiPosts,
  handleApiTopPosts,
  handleApiRun,
  handleApiComment,
  handleApiTestFlair,
  handleApiTestTitle,
  handleApiDefaultTitlePrompt,
} from '../routes/api';
import {
  handleLoginPage,
  handleLoginSubmit,
  handleLogout,
  getSessionCookie,
} from '../routes/auth';

function isAuthorized(request: Request, env: Env): boolean {
  const secret = env.DASHBOARD_SECRET;
  if (!secret) return true;

  // Session cookie (browser login flow)
  if (getSessionCookie(request) === secret) return true;

  // Bearer token (programmatic / API access)
  const authHeader = request.headers.get('Authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  return false;
}

const redirectToLogin = () =>
  new Response(null, { status: 302, headers: { Location: '/login' } });

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export async function handleFetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  // Auth routes — always public
  if (pathname === '/login') {
    if (method === 'POST') return handleLoginSubmit(request, env);
    return handleLoginPage();
  }
  if (pathname === '/logout') {
    return handleLogout();
  }

  // Dashboard — redirect to login page when unauthenticated
  if (pathname === '/' || pathname === '/dashboard') {
    if (!isAuthorized(request, env)) return redirectToLogin();
    return handleDashboard(env);
  }

  // API routes — return JSON 401 when unauthenticated (used programmatically)
  if (pathname === '/api/status') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiStatus(env);
  }

  if (pathname === '/api/history') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiHistory(env);
  }

  if (pathname === '/api/posts') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiPosts(env);
  }

  if (pathname === '/api/top-posts') {
    if (!isAuthorized(request, env)) return unauthorized();
    const timeframe = new URL(request.url).searchParams.get('t') ?? 'week';
    return handleApiTopPosts(env, timeframe);
  }

  if (pathname === '/api/run' && method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiRun(request, env);
  }

  if (pathname === '/api/comment' && method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiComment(env);
  }

  if (pathname === '/api/test-flair' && method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiTestFlair(request, env);
  }

  if (pathname === '/api/default-title-prompt' && method === 'GET') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiDefaultTitlePrompt();
  }

  if (pathname === '/api/test-title' && method === 'POST') {
    if (!isAuthorized(request, env)) return unauthorized();
    return handleApiTestTitle(request, env);
  }

  return new Response('Not Found', { status: 404 });
}
