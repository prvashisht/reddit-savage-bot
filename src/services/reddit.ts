const USER_AGENT = 'web:com.pratyushvashisht.reddit-savage-bot (by /u/prvashisht)';

type RedditTokenResponse = {
  access_token: string;
};

export type RedditPostContent = {
  title: string;
  url: string;
};

type UploadResult = { assetId: string; imageUrlForSubmit: string };

type RedditSubmitError = [string, string?, unknown?];

type RedditSubmitData = {
  id?: string;
  name?: string;
  url?: string;
  websocket_url?: string;
  user_submitted_page?: string;
};

type RedditSubmitResponse = {
  json: {
    errors: RedditSubmitError[];
    data: RedditSubmitData;
  };
};

export async function authenticateWithReddit(env: Env): Promise<string> {
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.REDDIT_APP_ID}:${env.REDDIT_APP_SECRET}`)}`,
      'User-Agent': USER_AGENT,
    },
    body: `grant_type=password&username=${env.REDDIT_USERNAME}&password=${env.REDDIT_PASSWORD}`,
  });
  const data = (await response.json()) as RedditTokenResponse;
  return data.access_token;
}

export async function getFirstPostTitle(token: string, subreddit: string): Promise<string> {
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/new`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch subreddit posts: ${response.statusText}`);
  }

  const data: any = await response.json();
  return data.data.children[0]?.data.title || '';
}

export type RedditPost = {
  name: string; // Reddit thing_id, e.g. "t3_xxxxxx"
  title: string;
  url: string;
  permalink: string;
  createdUtc: number;
  imageUrl?: string;
  score?: number;
};

function extractImageUrl(child: any): string | undefined {
  const d = child.data;
  if (d.post_hint === 'image' && d.url) return d.url;
  const previewUrl = d.preview?.images?.[0]?.source?.url;
  if (previewUrl) return previewUrl.replace(/&amp;/g, '&');
  if (d.thumbnail && d.thumbnail.startsWith('http')) return d.thumbnail;
  return undefined;
}

export async function getRecentPosts(token: string, subreddit: string, limit = 25): Promise<RedditPost[]> {
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch recent posts: ${response.statusText}`);
  }

  const data: any = await response.json();
  return (data.data.children ?? []).map((child: any) => ({
    name: child.data.name,
    title: child.data.title,
    url: child.data.url,
    permalink: `https://reddit.com${child.data.permalink}`,
    createdUtc: child.data.created_utc,
    imageUrl: extractImageUrl(child),
    score: child.data.score,
  }));
}

export async function getTopPosts(
  token: string,
  subreddit: string,
  limit = 25,
  timeframe: 'day' | 'week' | 'month' | 'year' | 'all' = 'week',
): Promise<RedditPost[]> {
  const response = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/top?limit=${limit}&t=${timeframe}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch top posts: ${response.statusText}`);
  }

  const data: any = await response.json();
  return (data.data.children ?? []).map((child: any) => ({
    name: child.data.name,
    title: child.data.title,
    url: child.data.url,
    permalink: `https://reddit.com${child.data.permalink}`,
    createdUtc: child.data.created_utc,
    imageUrl: extractImageUrl(child),
    score: child.data.score,
  }));
}

export type RedditComment = {
  author: string;
  body: string;
};

export async function getPostComments(
  token: string,
  subreddit: string,
  postId: string,
): Promise<RedditComment[]> {
  const response = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/comments/${postId}?limit=100`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } },
  );
  if (!response.ok) throw new Error(`Failed to fetch comments: ${response.statusText}`);
  const data: any = await response.json();
  const children = data?.[1]?.data?.children ?? [];
  return children
    .filter((c: any) => c.kind === 't1')
    .map((c: any) => ({ author: c.data.author as string, body: c.data.body as string }));
}

export async function uploadImageToReddit(token: string, sourceImageUrl: string): Promise<UploadResult> {
  const leaseRes = await fetch('https://oauth.reddit.com/api/media/asset.json?raw_json=1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ filepath: 'speakout.jpg', mimetype: 'image/jpeg' }),
  });
  if (!leaseRes.ok) throw new Error(`Lease request failed: ${leaseRes.status} ${await leaseRes.text()}`);
  const lease: any = await leaseRes.json();

  const action = String(lease?.args?.action || '');
  const actionUrl = action.startsWith('http') ? action : `https:${action}`;
  const fields = lease?.args?.fields;
  const assetId: string = String(lease?.asset?.asset_id || '');

  const form = new FormData();
  if (Array.isArray(fields)) {
    for (const { name, value } of fields) form.append(name, value);
  } else {
    for (const [k, v] of Object.entries(fields || {})) form.append(k, String(v));
  }

  const imgResp = await fetch(sourceImageUrl);
  if (!imgResp.ok) throw new Error(`Image download failed: ${imgResp.status}`);
  const mime = imgResp.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const bytes = await imgResp.arrayBuffer();
  form.append('file', new Blob([bytes], { type: mime }), `upload.${mime.includes('png') ? 'png' : 'jpg'}`);

  const s3Res = await fetch(actionUrl, { method: 'POST', body: form });
  if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status} ${await s3Res.text()}`);

  const key = (Array.isArray(fields)
    ? fields.find((field: any) => field.name === 'key')?.value
    : fields?.key) as string | undefined;
  const s3Url = key ? `https://reddit-uploaded-media.s3-accelerate.amazonaws.com/${key}` : '';
  const previewUrl = `https://i.redd.it/${assetId}.${mime.includes('png') ? 'png' : 'jpg'}`;
  const imageUrlForSubmit = s3Url || previewUrl;

  return { assetId, imageUrlForSubmit };
}

export async function submitImagePost(
  token: string,
  subreddit: string,
  title: string,
  imageUrl: string,
): Promise<RedditSubmitData> {
  const postUrl = 'https://oauth.reddit.com/api/submit?raw_json=1';
  const body = new URLSearchParams({
    sr: subreddit,
    title,
    kind: 'image',
    url: imageUrl,
    resubmit: 'true',
    sendreplies: 'true',
    api_type: 'json',
  });

  const resp = await fetch(postUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  });

  const data = await resp.json<RedditSubmitResponse>();

  const errors = data.json?.errors ?? [];
  if (!resp.ok || errors.length > 0) {
    throw new Error(`Submit failed: ${resp.status} ${JSON.stringify(errors)}`);
  }
  return data.json.data;
}

export async function commentOnPost(token: string, postName: string, text: string): Promise<void> {
  const response = await fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ thing_id: postName, text, api_type: 'json' }),
  });

  const data: any = await response.json();
  const errors: unknown[][] = data?.json?.errors ?? [];
  if (!response.ok || errors.length > 0) {
    throw new Error(`Failed to comment on post: ${response.status} ${JSON.stringify(errors)}`);
  }
}

export async function postOnReddit(
  token: string,
  subreddit: string,
  content: RedditPostContent,
): Promise<any> {
  const postUrl = 'https://oauth.reddit.com/api/submit';

  const postBody = new URLSearchParams({
    sr: subreddit,
    title: content.title,
    url: content.url,
    kind: 'link',
    resubmit: 'true',
    api_type: 'json',
  }).toString();

  const response = await fetch(postUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: postBody,
  });

  if (!response.ok) {
    throw new Error(`Failed to post on Reddit: ${response.statusText}`);
  }

  const data: any = await response.json();
  return data.json.data;
}

export type FlairTemplate = {
  id: string;
  text: string;
};

export async function getFlairTemplates(token: string, subreddit: string): Promise<FlairTemplate[]> {
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/api/link_flair_v2`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Failed to fetch flair templates: ${response.statusText}`);
  const data: any = await response.json();
  return (data ?? []).map((f: any) => ({ id: f.id as string, text: f.text as string }));
}

export async function setPostFlair(
  token: string,
  subreddit: string,
  postName: string,
  flairTemplateId: string,
): Promise<void> {
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/api/selectflair`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ link: postName, flair_template_id: flairTemplateId, api_type: 'json' }),
  });
  if (!response.ok) throw new Error(`Failed to set flair: ${response.statusText}`);
}
