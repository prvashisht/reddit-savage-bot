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
import { detectPartyFromImage } from '../services/openai';
import { putRunState, type RunState, type CommentResult, type FlairResult } from '../store/run-state';

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

  const save = async (state: RunState): Promise<RunState> => {
    try {
      await putRunState(env.REDDIT_POSTER_STATE, state);
    } catch (e) {
      console.error('Failed to write run state to KV', e);
    }
    return state;
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
      console.log('Source comment posted on', postName);
      return 'posted';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Comment attempt 1 failed, retrying in 30s:', msg);

      // One retry after a longer wait (covers Reddit's typical ratelimit window)
      await sleep(30000);
      try {
        await attempt();
        console.log('Source comment posted on', postName, '(retry)');
        return 'posted';
      } catch (e2) {
        console.error('Failed to post source comment after retry (non-fatal)', e2);
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
        console.log('Bot already commented on', postName, '— skipping');
        return 'skipped';
      }
    } catch (e) {
      console.warn('Could not fetch comments to check for existing comment (will attempt anyway):', e);
    }
    return tryComment(token, postName, sourceUrl, { skipDelay: true });
  };

  const tryFlair = async (token: string, postName: string, imageUrl: string): Promise<FlairResult> => {
    if (!env.OPENAI_API_KEY) {
      return { status: 'skipped', reason: 'OPENAI_API_KEY not set' };
    }
    try {
      const detection = await detectPartyFromImage(env.OPENAI_API_KEY, imageUrl);
      if (!detection.party) {
        console.log('Flair: could not identify party —', detection.reason);
        return { status: 'skipped', reason: detection.reason };
      }
      const templates = await getFlairTemplates(token, SUBREDDIT);
      const template = templates.find((t) => t.text.trim().toUpperCase() === detection.party!.toUpperCase());
      if (!template) {
        console.log(`Flair: no template found for party "${detection.party}"`);
        return { status: 'skipped', reason: `No flair template for "${detection.party}"` };
      }
      await setPostFlair(token, SUBREDDIT, postName, template.id);
      console.log(`Flair set: ${detection.party} (${detection.person})`);
      return { status: 'set', party: detection.party, person: detection.person };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error('Failed to set flair (non-fatal):', error);
      return { status: 'failed', error };
    }
  };

  try {
    const { title, imageUrl, pageUrl } = await getLatestSpeakOut();
    const token = await authenticateWithReddit(env);

    if (!skipLatestCheck) {
      const recentPosts = await getRecentPosts(token, SUBREDDIT, 1);
      const latestPost = recentPosts[0];
      if (latestPost?.title.includes(title)) {
        console.log(`Latest speakout posted already: ${title}`);
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
      console.log('[SKIP_LATEST_CHECK] Skipping already-posted check');
    }

    const postTitle = `DH Speakout | ${title}`;

    if (dryRun) {
      console.log('[DRY_RUN] Would post:', postTitle);
      return save({ lastRunAt: new Date().toISOString(), lastRunResult: 'dry_run', lastPostedTitle: title, source });
    }

    let imageSubmitSucceeded = false;
    try {
      const { imageUrlForSubmit } = await uploadImageToReddit(token, imageUrl);
      if (!imageUrlForSubmit) throw new Error('Image upload did not return a usable URL');

      console.log('Uploaded image to Reddit:', imageUrlForSubmit);
      const result = await submitImagePost(token, SUBREDDIT, postTitle, imageUrlForSubmit);
      imageSubmitSucceeded = true;
      console.log('Submitted image post:', result);

      await sleep(3000);
      const newestPosts = await getRecentPosts(token, SUBREDDIT, 1);
      const newestPost = newestPosts[0];
      if (!newestPost?.title.includes(title)) {
        throw new Error(
          `Image post verification failed: newest post is "${newestPost?.title}", expected to contain "${title}"`,
        );
      }
      console.log('Image post verified in /new:', newestPost.name);

      // Reddit image submissions return the post name via WebSocket, not HTTP response.
      // We use the verified /new post to get the name for commenting.
      const postName = result.name ?? newestPost.name;
      const postUrl = result.url ?? newestPost.url ?? newestPost.permalink;
      const [commentResult, flairResult] = await Promise.all([
        tryEnsureComment(token, postName, pageUrl),
        tryFlair(token, postName, imageUrl),
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
        console.error('Image upload/post failed, falling back to link post', uploadErr);
        const postContent: RedditPostContent = { title: postTitle, url: imageUrl };
        const result = await postOnReddit(token, SUBREDDIT, postContent);
        console.log('Submitted fallback link post:', result);

        await sleep(3000);
        const newestTitle = await getFirstPostTitle(token, SUBREDDIT);
        if (!newestTitle.includes(title)) {
          throw new Error(
            `Link post verification also failed: newest post is "${newestTitle}", expected to contain "${title}"`,
          );
        }
        console.log('Link post verified in /new');

        const [commentResult, flairResult] = await Promise.all([
          result.name ? tryEnsureComment(token, result.name, pageUrl) : Promise.resolve<CommentResult>('skipped'),
          tryFlair(token, result.name ?? '', imageUrl),
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
        console.error(
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
    console.error('Bot run failed', error);
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
    const { title, pageUrl } = await getLatestSpeakOut();
    const token = await authenticateWithReddit(env);

    const posts = await getRecentPosts(token, SUBREDDIT, 1);
    const latestPost = posts[0];
    if (!latestPost) {
      return { status: 'failed', error: 'No posts found in subreddit' };
    }

    if (!latestPost.title.includes(title)) {
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
