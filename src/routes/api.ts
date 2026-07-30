import { getRunState, getRunHistory } from '../store/run-state';
import { authenticateWithReddit, getRecentPosts, getTopPosts, getFlairTemplates } from '../services/reddit';
import { runBot, ensureCommentOnLatestPost } from '../core/run';
import {
  detectPartyFromImage,
  generateCatchyTitle,
  DEFAULT_EXTRACT_PROMPT,
  DEFAULT_PHRASE_PROMPT,
  DEFAULT_CHOOSE_TITLE_PROMPT,
  toIsoDate,
} from '../services/openai';
import { getLatestSpeakOut } from '../services/deccan-herald';

export async function handleApiStatus(env: Env): Promise<Response> {
  const state = await getRunState(env.REDDIT_POSTER_STATE);
  return new Response(JSON.stringify(state ?? { message: 'No runs recorded yet' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApiHistory(env: Env): Promise<Response> {
  const history = await getRunHistory(env.REDDIT_POSTER_STATE);
  return new Response(JSON.stringify(history), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApiPosts(env: Env): Promise<Response> {
  const token = await authenticateWithReddit(env);
  const posts = await getRecentPosts(token, 'DHSavagery', 50);
  return new Response(JSON.stringify(posts), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApiTopPosts(env: Env, timeframe = 'week'): Promise<Response> {
  const valid = ['day', 'week', 'month', 'year', 'all'];
  const t = valid.includes(timeframe) ? (timeframe as 'day' | 'week' | 'month' | 'year' | 'all') : 'week';
  const token = await authenticateWithReddit(env);
  const posts = await getTopPosts(token, 'DHSavagery', 50, t);
  return new Response(JSON.stringify(posts), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApiDefaultTitlePrompt(): Promise<Response> {
  return new Response(
    JSON.stringify({
      extractPrompt: DEFAULT_EXTRACT_PROMPT,
      phrasePrompt: DEFAULT_PHRASE_PROMPT,
      choosePrompt: DEFAULT_CHOOSE_TITLE_PROMPT,
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

export async function handleApiTestTitle(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  let body: {
    imageUrl?: string;
    extractPrompt?: string;
    phrasePrompt?: string;
    choosePrompt?: string;
    /** @deprecated */ prompt?: string;
    date?: string;
    originalTitle?: string;
  } = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch {}

  let imageUrl = body.imageUrl?.trim() ?? '';
  let speakoutTitle: string | undefined;
  let speakoutPageUrl: string | undefined;
  let isoDate = body.date?.trim() || '';

  if (!imageUrl) {
    const speakout = await getLatestSpeakOut();
    imageUrl = speakout.imageUrl;
    speakoutTitle = speakout.title;
    speakoutPageUrl = speakout.pageUrl;
    if (!isoDate) {
      isoDate = speakout.isoDate || (() => {
        try {
          return toIsoDate(speakout.title);
        } catch {
          return toIsoDate();
        }
      })();
    }
  } else if (!isoDate) {
    isoDate = toIsoDate();
  }

  try {
    const result = await generateCatchyTitle(env.OPENAI_API_KEY, imageUrl, {
      extractPrompt: body.extractPrompt || body.prompt,
      phrasePrompt: body.phrasePrompt,
      choosePrompt: body.choosePrompt,
      date: isoDate,
    });
    return new Response(
      JSON.stringify({
        imageUrl,
        speakoutTitle,
        speakoutPageUrl,
        originalTitle: body.originalTitle,
        date: isoDate,
        ...result,
      }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error, imageUrl, speakoutTitle, speakoutPageUrl }), {
      status: 422,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export async function handleApiComment(env: Env): Promise<Response> {
  const result = await ensureCommentOnLatestPost(env);
  const ok = result.status === 'commented' || result.status === 'already_exists';
  return new Response(JSON.stringify(result), {
    status: ok ? 200 : 422,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleApiTestFlair(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  let body: { imageUrl?: string } = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch {}

  // Use provided imageUrl or fall back to today's speakout
  let imageUrl = body.imageUrl ?? '';
  let speakoutTitle: string | undefined;
  let speakoutPageUrl: string | undefined;
  if (!imageUrl) {
    const speakout = await getLatestSpeakOut();
    imageUrl = speakout.imageUrl;
    speakoutTitle = speakout.title;
    speakoutPageUrl = speakout.pageUrl;
  }

  const detection = await detectPartyFromImage(env.OPENAI_API_KEY, imageUrl);

  let matchedFlair: { id: string; text: string } | null = null;
  if (detection.party) {
    const token = await authenticateWithReddit(env);
    const templates = await getFlairTemplates(token, 'DHSavagery');
    matchedFlair = templates.find((t) => t.text.trim().toUpperCase() === detection.party!.toUpperCase()) ?? null;
  }

  return new Response(
    JSON.stringify({ imageUrl, speakoutTitle, speakoutPageUrl, detection, matchedFlair }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

export async function handleApiRun(request: Request, env: Env): Promise<Response> {
  let body: { dryRun?: boolean; skipLatestCheck?: boolean } = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
  } catch {
    // no body or invalid JSON — use defaults
  }

  const state = await runBot(env, {
    source: 'manual',
    // Default false for manual runs — don't inherit env vars meant for dev/testing
    dryRun: body.dryRun ?? false,
    skipLatestCheck: body.skipLatestCheck ?? false,
  });

  return new Response(JSON.stringify(state), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
