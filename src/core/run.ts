import { getLatestSpeakOut } from '../services/deccan-herald';
import {
  authenticateWithReddit,
  getFirstPostTitle,
  getRecentPosts,
  getPostComments,
  getFlairTemplates,
  setPostFlair,
  uploadImageToReddit,
  submitImagePost,
  postOnReddit,
  commentOnPost,
  type RedditPostContent,
} from '../services/reddit';
import {
  detectPartyFromImage,
  generateCatchyTitle,
  parseIsoDate,
  toIsoDate,
  TITLE_BRAND,
  type KnownParty,
} from '../services/openai';
import { putRunState, type RunState, type CommentResult, type FlairResult, type LogLevel, type LogEntry } from '../store/run-state';

function envFlagOn(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/** Precomputed flair from the AI title pipeline.
 *  - object: reuse this party (skip vision flair)
 *  - null: intentionally no flair (non-politician / no speaker)
 *  - undefined: run dedicated detectPartyFromImage (legacy path, title failed, or politician party unresolved)
 */
type TitleFlairHint = { party: KnownParty; person: string } | null | undefined;

/** True if a Reddit title looks like it already covers this Speak Out day. */
function titleMatchesSpeakout(redditTitle: string, speakoutLocaleTitle: string, isoDate: string | null): boolean {
  if (redditTitle.includes(speakoutLocaleTitle)) return true;
  if (isoDate && redditTitle.includes(isoDate)) return true;
  return false;
}

/** Cartoon date from titles we actually post: `phrase | 2026-08-14 | DH Speakout` or the old locale form. */
export function isoDateFromRedditTitle(redditTitle: string): string | null {
  const isoHits = [...redditTitle.matchAll(/\d{4}-\d{2}-\d{2}/g)]
    .map((m) => parseIsoDate(m[0]))
    .filter((iso): iso is string => iso != null);
  if (isoHits.length) return isoHits[isoHits.length - 1];

  const localeHit = redditTitle.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+ \d{1,2}, \d{4}/,
  );
  if (!localeHit) return null;
  try {
    return toIsoDate(localeHit[0]);
  } catch {
    return null;
  }
}

/** Skip if this day is already up, or if /new is already a later cartoon. */
export function speakoutAlreadyOnReddit(
  redditTitle: string,
  speakoutLocaleTitle: string,
  isoDate: string | null,
): boolean {
  if (titleMatchesSpeakout(redditTitle, speakoutLocaleTitle, isoDate)) return true;
  if (!isoDate) return false;
  const postedIso = isoDateFromRedditTitle(redditTitle);
  return postedIso != null && postedIso >= isoDate;
}

function legacyPostTitle(speakoutLocaleTitle: string): string {
  return `DH Speakout | ${speakoutLocaleTitle}`;
}

function fallbackIsoTitle(isoDate: string): string {
  return `${isoDate} | ${TITLE_BRAND}`;
}

function makeLogger() {
  const entries: LogEntry[] = [];
  const add = (level: LogLevel, args: unknown[]): void => {
    const msg = args
      .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
      .join(' ');
    entries.push({ level, msg, ts: new Date().toISOString() });
    // eslint-disable-next-line no-console
    console[level](...(args as [unknown, ...unknown[]]));
  };
  return {
    entries,
    log: (...args: unknown[]) => add('log', args),
    warn: (...args: unknown[]) => add('warn', args),
    error: (...args: unknown[]) => add('error', args),
  };
}

const SUBREDDIT = 'DHSavagery';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RunOptions = {
  skipLatestCheck?: boolean;
  dryRun?: boolean;
  source?: 'scheduled' | 'manual';
};

export async function runBot(env: Env, options: RunOptions = {}): Promise<RunState> {
  const dryRun = options.dryRun ?? (env.DRY_RUN === 'true' || env.DRY_RUN === '1');
  const skipLatestCheck =
    options.skipLatestCheck ?? (env.SKIP_LATEST_CHECK === 'true' || env.SKIP_LATEST_CHECK === '1');
  const source = options.source ?? 'scheduled';
  const logger = makeLogger();

  const save = async (state: RunState): Promise<RunState> => {
    try {
      await putRunState(env.REDDIT_POSTER_STATE, { ...state, logs: logger.entries });
    } catch (e) {
      logger.error('Failed to write run state to KV', e);
    }
    return { ...state, logs: logger.entries };
  };

  const tryComment = async (
    token: string,
    postName: string | undefined,
    sourceUrl: string,
    { skipDelay = false }: { skipDelay?: boolean } = {},
  ): Promise<CommentResult> => {
    if (!postName) return 'skipped';

    const attempt = async (): Promise<void> => {
      await commentOnPost(token, postName, `**Source:** ${sourceUrl}`);
    };

    if (!skipDelay) {
      // Wait a bit before commenting — Reddit rate-limits actions taken immediately after posting
      await sleep(5000);
    }

    try {
      await attempt();
      logger.log('Source comment posted on', postName);
      return 'posted';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('Comment attempt 1 failed, retrying in 30s:', msg);

      // One retry after a longer wait (covers Reddit's typical ratelimit window)
      await sleep(30000);
      try {
        await attempt();
        logger.log('Source comment posted on', postName, '(retry)');
        return 'posted';
      } catch (e2) {
        logger.error('Failed to post source comment after retry (non-fatal)', e2);
        return 'failed';
      }
    }
  };

  // Check if the bot has already commented on a post; if not, add the source comment.
  const tryEnsureComment = async (
    token: string,
    postName: string,
    sourceUrl: string,
  ): Promise<CommentResult> => {
    try {
      const postId = postName.replace(/^t3_/, '');
      const comments = await getPostComments(token, SUBREDDIT, postId);
      if (comments.some((c) => c.author === env.REDDIT_USERNAME)) {
        logger.log('Bot already commented on', postName, '— skipping');
        return 'skipped';
      }
    } catch (e) {
      logger.warn('Could not fetch comments to check for existing comment (will attempt anyway):', e);
    }
    return tryComment(token, postName, sourceUrl, { skipDelay: true });
  };

  const tryFlair = async (
    token: string,
    postName: string,
    imageUrl: string,
    titleFlair?: TitleFlairHint,
  ): Promise<FlairResult> => {
    // When USE_AI_TITLE already resolved a party, reuse it. null means skip (non-politician).
    // undefined means run the dedicated vision flair path.
    if (titleFlair === null) {
      logger.log('Flair: skipped — speaker is not a flairable politician from AI title extract');
      return { status: 'skipped', reason: 'Non-politician speaker from AI title pipeline' };
    }

    try {
      let party: string;
      let person: string;

      if (titleFlair) {
        party = titleFlair.party;
        person = titleFlair.person;
        logger.log(`Flair: reusing party from AI title pipeline — ${party} (${person})`);
      } else {
        if (!env.OPENAI_API_KEY) {
          return { status: 'skipped', reason: 'OPENAI_API_KEY not set' };
        }
        const detection = await detectPartyFromImage(env.OPENAI_API_KEY, imageUrl);
        if (!detection.party) {
          logger.log('Flair: could not identify party —', detection.reason);
          return { status: 'skipped', reason: detection.reason };
        }
        party = detection.party;
        person = detection.person;
      }

      const templates = await getFlairTemplates(token, SUBREDDIT);
      const template = templates.find((t) => t.text.trim().toUpperCase() === party.toUpperCase());
      if (!template) {
        logger.log(`Flair: no template found for party "${party}"`);
        return { status: 'skipped', reason: `No flair template for "${party}"` };
      }
      await setPostFlair(token, SUBREDDIT, postName, template.id);
      logger.log(`Flair set: ${party} (${person})`);
      return { status: 'set', party, person };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error('Failed to set flair (non-fatal):', error);
      return { status: 'failed', error };
    }
  };

  try {
    const { title, imageUrl, pageUrl, isoDate: slugIso } = await getLatestSpeakOut();
    const token = await authenticateWithReddit(env);

    // Prefer URL-slug ISO from DH; fall back to parsing the locale title.
    let isoDate: string | null = slugIso ?? null;
    if (!isoDate) {
      try {
        isoDate = toIsoDate(title);
      } catch {
        isoDate = null;
      }
    }

    if (!skipLatestCheck) {
      const recentPosts = await getRecentPosts(token, SUBREDDIT, 1);
      const latestPost = recentPosts[0];
      if (latestPost && speakoutAlreadyOnReddit(latestPost.title, title, isoDate)) {
        const redditIso = isoDateFromRedditTitle(latestPost.title);
        if (isoDate && redditIso && redditIso > isoDate) {
          logger.log(
            `Latest Reddit post (${redditIso}) is newer than DH "${title}" (${isoDate}) — skipping "${latestPost.title}"`,
          );
        } else {
          logger.log(
            `Latest speakout posted already: DH "${title}" (${isoDate ?? 'no-iso'}) matches Reddit "${latestPost.title}"`,
          );
        }
        const commentResult = await tryEnsureComment(token, latestPost.name, pageUrl);
        return save({
          lastRunAt: new Date().toISOString(),
          lastRunResult: 'skipped',
          lastPostedTitle: latestPost.title,
          lastPostedUrl: latestPost.permalink,
          commentResult,
          source,
        });
      }
    } else {
      logger.log('[SKIP_LATEST_CHECK] Skipping already-posted check');
    }

    const useAiTitle = envFlagOn(env.USE_AI_TITLE);
    let postTitle = legacyPostTitle(title);
    // undefined → legacy vision flair; null/object → reuse (or skip) title-pipeline party
    let titleFlair: TitleFlairHint = undefined;

    if (useAiTitle) {
      if (!env.OPENAI_API_KEY) {
        logger.warn('[USE_AI_TITLE] OPENAI_API_KEY not set — falling back to legacy title');
      } else if (!isoDate) {
        logger.warn('[USE_AI_TITLE] Could not derive ISO date — falling back to legacy title');
      } else {
        try {
          const generated = await generateCatchyTitle(env.OPENAI_API_KEY, imageUrl, { date: isoDate });
          postTitle = generated.fullTitle;
          const speaker = generated.extract.speaker;
          const isPolitician = speaker?.kind === 'politician' && !!speaker.name?.trim();

          if (generated.party) {
            titleFlair = {
              party: generated.party,
              person: speaker?.name?.trim() || 'unknown',
            };
          } else if (isPolitician) {
            // Politician lookup returned null/unrecognized — don't skip flair; fall back to vision path.
            titleFlair = undefined;
            logger.warn(
              `[USE_AI_TITLE] Party unresolved for politician "${speaker!.name}" (${generated.partyReason ?? 'n/a'}) — will use flair vision fallback`,
            );
          } else {
            titleFlair = null;
          }

          logger.log(
            `[USE_AI_TITLE] Chose "${generated.phrase}" from [${generated.candidates.join(' | ')}] — ${generated.reason}` +
              (generated.party
                ? ` · party ${generated.party}`
                : ` · party null (${generated.partyReason ?? 'n/a'})`),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[USE_AI_TITLE] Generation failed (${msg}) — falling back to ${fallbackIsoTitle(isoDate)}`);
          postTitle = fallbackIsoTitle(isoDate);
          // Title pipeline failed before party — fall back to dedicated flair vision call.
          titleFlair = undefined;
        }
      }
    }

    if (dryRun) {
      logger.log('[DRY_RUN] Would post:', postTitle);
      if (titleFlair) {
        logger.log(`[DRY_RUN] Would flair from title pipeline: ${titleFlair.party} (${titleFlair.person})`);
      } else if (titleFlair === null) {
        logger.log('[DRY_RUN] Would skip flair — non-politician speaker from AI title extract');
      } else if (useAiTitle) {
        logger.log('[DRY_RUN] Would flair via vision fallback (title party unresolved or title failed)');
      }
      return save({ lastRunAt: new Date().toISOString(), lastRunResult: 'dry_run', lastPostedTitle: postTitle, source });
    }

    let imageSubmitSucceeded = false;
    try {
      const { imageUrlForSubmit } = await uploadImageToReddit(token, imageUrl);
      if (!imageUrlForSubmit) throw new Error('Image upload did not return a usable URL');

      logger.log('Uploaded image to Reddit:', imageUrlForSubmit);
      const result = await submitImagePost(token, SUBREDDIT, postTitle, imageUrlForSubmit);
      imageSubmitSucceeded = true;
      logger.log('Submitted image post:', result);

      await sleep(3000);
      const newestPosts = await getRecentPosts(token, SUBREDDIT, 1);
      const newestPost = newestPosts[0];
      if (!newestPost || !titleMatchesSpeakout(newestPost.title, title, isoDate)) {
        throw new Error(
          `Image post verification failed: newest post is "${newestPost?.title}", expected to match speakout "${title}"` +
            (isoDate ? ` or ${isoDate}` : ''),
        );
      }
      logger.log('Image post verified in /new:', newestPost.name);

      // Reddit image submissions return the post name via WebSocket, not HTTP response.
      // We use the verified /new post to get the name for commenting.
      const postName = result.name ?? newestPost.name;
      const postUrl = result.url ?? newestPost.url ?? newestPost.permalink;
      const [commentResult, flairResult] = await Promise.all([
        tryEnsureComment(token, postName, pageUrl),
        tryFlair(token, postName, imageUrl, titleFlair),
      ]);
      return save({
        lastRunAt: new Date().toISOString(),
        lastRunResult: 'posted',
        lastPostedTitle: postTitle,
        lastPostedUrl: postUrl,
        commentResult,
        flairResult,
        source,
      });
    } catch (uploadErr) {
      if (!imageSubmitSucceeded) {
        logger.error('Image upload/post failed, falling back to link post', uploadErr);
        const postContent: RedditPostContent = { title: postTitle, url: imageUrl };
        const result = await postOnReddit(token, SUBREDDIT, postContent);
        logger.log('Submitted fallback link post:', result);

        await sleep(3000);
        const newestTitle = await getFirstPostTitle(token, SUBREDDIT);
        if (!titleMatchesSpeakout(newestTitle, title, isoDate)) {
          throw new Error(
            `Link post verification also failed: newest post is "${newestTitle}", expected to match speakout "${title}"` +
              (isoDate ? ` or ${isoDate}` : ''),
          );
        }
        logger.log('Link post verified in /new');

        const [commentResult, flairResult] = await Promise.all([
          result.name ? tryEnsureComment(token, result.name, pageUrl) : Promise.resolve<CommentResult>('skipped'),
          tryFlair(token, result.name ?? '', imageUrl, titleFlair),
        ]);
        return save({
          lastRunAt: new Date().toISOString(),
          lastRunResult: 'posted',
          lastPostedTitle: postTitle,
          lastPostedUrl: result.url,
          commentResult,
          flairResult,
          source,
        });
      } else {
        logger.error(
          'Image post was submitted but verification failed; not posting link to avoid duplicate',
          uploadErr,
        );
        return save({
          lastRunAt: new Date().toISOString(),
          lastRunResult: 'posted',
          lastPostedTitle: postTitle,
          lastError: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
          source,
        });
      }
    }
  } catch (error) {
    logger.error('Bot run failed', error);
    return save({
      lastRunAt: new Date().toISOString(),
      lastRunResult: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      source,
    });
  }
}

export type EnsureCommentResult =
  | { status: 'commented' }
  | { status: 'already_exists' }
  | { status: 'title_mismatch'; latestPostTitle: string; speakoutTitle: string }
  | { status: 'failed'; error: string };

export async function ensureCommentOnLatestPost(env: Env): Promise<EnsureCommentResult> {
  const saveEntry = async (result: RunState) => {
    try {
      await putRunState(env.REDDIT_POSTER_STATE, result);
    } catch (e) {
      console.error('Failed to write comment run state to KV', e);
    }
  };

  try {
    const { title, pageUrl, isoDate: slugIso } = await getLatestSpeakOut();
    const token = await authenticateWithReddit(env);

    let isoDate: string | null = slugIso ?? null;
    if (!isoDate) {
      try {
        isoDate = toIsoDate(title);
      } catch {
        isoDate = null;
      }
    }

    const posts = await getRecentPosts(token, SUBREDDIT, 1);
    const latestPost = posts[0];
    if (!latestPost) {
      return { status: 'failed', error: 'No posts found in subreddit' };
    }

    if (!titleMatchesSpeakout(latestPost.title, title, isoDate)) {
      return { status: 'title_mismatch', latestPostTitle: latestPost.title, speakoutTitle: title };
    }

    const postId = latestPost.name.replace(/^t3_/, '');
    const comments = await getPostComments(token, SUBREDDIT, postId);
    const alreadyCommented = comments.some((c) => c.author === env.REDDIT_USERNAME);

    if (alreadyCommented) {
      console.log('Bot already commented on', latestPost.name);
      await saveEntry({
        lastRunAt: new Date().toISOString(),
        lastRunResult: 'comment_skipped',
        lastPostedTitle: latestPost.title,
        lastPostedUrl: latestPost.permalink,
        source: 'manual',
      });
      return { status: 'already_exists' };
    }

    await commentOnPost(token, latestPost.name, `**Source:** ${pageUrl}`);
    console.log('Source comment posted on', latestPost.name);
    await saveEntry({
      lastRunAt: new Date().toISOString(),
      lastRunResult: 'comment_added',
      lastPostedTitle: latestPost.title,
      lastPostedUrl: latestPost.permalink,
      source: 'manual',
    });
    return { status: 'commented' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ensureCommentOnLatestPost failed:', message);
    return { status: 'failed', error: message };
  }
}
