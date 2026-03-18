export type SpeakOutMeta = {
  title: string;
  imageUrl: string;
  pageUrl: string;
};

const TAG_SLUGS = ['opinion', 'dh-speak-out', 'speak-out'];

export async function getLatestSpeakOut(): Promise<SpeakOutMeta> {
  let pageUrl = '';

  for (const tag of TAG_SLUGS) {
    const listUrl = `https://www.deccanherald.com/tags/${tag}`;
    const listResp = await fetch(listUrl, { cf: { cacheTtl: 300 } });
    if (!listResp.ok) {
      console.warn(`Tag fetch failed for "${tag}": ${listResp.status}, trying next`);
      continue;
    }
    const listHtml = await listResp.text();
    const m = listHtml.match(/href="(\/opinion\/speak-out\/[^"]+)"/i);
    if (!m) {
      console.warn(`No Speak Out link found under tag "${tag}", trying next`);
      continue;
    }
    pageUrl = new URL(m[1], 'https://www.deccanherald.com').toString();
    console.log(`Found Speak Out link via tag "${tag}": ${pageUrl}`);
    break;
  }

  if (!pageUrl) throw new Error('Could not find latest Speak Out link across all tag pages');

  let title = '';
  let imageUrl = '';

  const articleResp = await fetch(pageUrl, { cf: { cacheTtl: 300 } });
  if (!articleResp.ok) throw new Error(`Failed article fetch ${pageUrl}: ${articleResp.status}`);

  await new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(e) {
        const u = e.getAttribute('content');
        if (u) imageUrl = u.trim().split('?')[0];
      },
    })
    .on('h1', {
      text(t) {
        if (!title) title += t.text;
      },
    })
    .transform(articleResp)
    .arrayBuffer();

  title = title.trim().split('|').pop()?.trim() ?? title;
  title = new Date(title).toLocaleDateString('en-us', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  if (!title) throw new Error('Could not extract title from article page');
  if (!imageUrl) throw new Error('Could not extract og:image from article page');

  return { title, imageUrl, pageUrl };
}
