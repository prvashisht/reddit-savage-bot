export type SpeakOutMeta = {
  title: string;
  imageUrl: string;
  pageUrl: string;
};

const TAG_SLUGS = ['opinion', 'dh-speak-out', 'speak-out'];

async function fetchSpeakOutMeta(pageUrl: string): Promise<SpeakOutMeta | null> {
  const articleResp = await fetch(pageUrl, { cf: { cacheTtl: 300 } });
  if (!articleResp.ok) {
    console.warn(`Failed article fetch ${pageUrl}: ${articleResp.status}`);
    return null;
  }

  let rawTitle = '';
  let imageUrl = '';

  await new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(e) {
        const u = e.getAttribute('content');
        if (u) imageUrl = u.trim().split('?')[0];
      },
    })
    .on('h1', {
      text(t) {
        if (!rawTitle) rawTitle += t.text;
      },
    })
    .transform(articleResp)
    .arrayBuffer();

  const parsed = rawTitle.trim().split('|').pop()?.trim() ?? rawTitle.trim();
  const title = new Date(parsed).toLocaleDateString('en-us', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (!title || title === 'Invalid Date') {
    console.warn(`Could not parse title from ${pageUrl} — raw: "${rawTitle}"`);
    return null;
  }
  if (!imageUrl) {
    console.warn(`Could not extract og:image from ${pageUrl}`);
    return null;
  }

  return { title, imageUrl, pageUrl };
}

export async function getLatestSpeakOut(): Promise<SpeakOutMeta> {
  // Fetch all tag pages in parallel and collect every candidate speak-out URL.
  // A newer article may appear under one tag before it shows up under another,
  // so we check all of them rather than stopping at the first hit.
  const tagResults = await Promise.all(
    TAG_SLUGS.map(async (tag) => {
      const listUrl = `https://www.deccanherald.com/tags/${tag}`;
      const listResp = await fetch(listUrl, { cf: { cacheTtl: 300 } });
      if (!listResp.ok) {
        console.warn(`Tag fetch failed for "${tag}": ${listResp.status}`);
        return null;
      }
      const listHtml = await listResp.text();
      const m = listHtml.match(/href="(\/opinion\/speak-out\/[^"]+)"/i);
      if (!m) {
        console.warn(`No Speak Out link found under tag "${tag}"`);
        return null;
      }
      const url = new URL(m[1], 'https://www.deccanherald.com').toString();
      console.log(`Found Speak Out link via tag "${tag}": ${url}`);
      return url;
    }),
  );

  const candidates = [...new Set(tagResults.filter((u): u is string => u !== null))];
  if (!candidates.length) throw new Error('Could not find latest Speak Out link across all tag pages');

  // Fetch article metadata for every unique candidate in parallel.
  const metas = (await Promise.all(candidates.map(fetchSpeakOutMeta))).filter(
    (m): m is SpeakOutMeta => m !== null,
  );
  if (!metas.length) throw new Error('Could not extract metadata from any Speak Out article');

  if (metas.length === 1) return metas[0];

  // Multiple distinct articles found — pick the most recently dated one.
  metas.sort((a, b) => new Date(b.title).getTime() - new Date(a.title).getTime());
  console.log(`Multiple Speak Out candidates found; using most recent: "${metas[0].title}" (${metas[0].pageUrl})`);
  return metas[0];
}
