export type SpeakOutMeta = {
  title: string;
  imageUrl: string;
  pageUrl: string;
  /** YYYY-MM-DD from the article URL slug (authoritative). */
  isoDate: string;
};

const TAG_SLUGS = ['speak-out', 'opinion', 'dh-speak-out'] as const;
const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/** Parse YYYY-MM-DD from URLs like .../dh-speak-out-july-30-2026-4092593 */
export function isoDateFromSpeakOutUrl(pageUrl: string): string | null {
  const m = pageUrl.match(/speak-out-([a-z]+)-(\d{1,2})-(\d{4})(?:-|\b)/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = m[2].padStart(2, '0');
  const year = m[3];
  const iso = `${year}-${month}-${day}`;
  // Reject impossible calendar days without bringing in a full date lib.
  const probe = new Date(`${iso}T12:00:00+05:30`);
  if (Number.isNaN(probe.getTime())) return null;
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(probe);
  return check === iso ? iso : null;
}

function localeTitleFromIso(isoDate: string): string {
  // Noon IST avoids UTC midnight off-by-one when formatting.
  const d = new Date(`${isoDate}T12:00:00+05:30`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function extractSpeakOutPaths(listHtml: string): string[] {
  const paths: string[] = [];
  const re = /href="(\/opinion\/speak-out\/[^"#?]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listHtml)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

async function collectCandidateUrls(): Promise<string[]> {
  const found = new Map<string, string>(); // isoDate -> url (first wins; tags ordered freshest-first)

  await Promise.all(
    TAG_SLUGS.map(async (tag) => {
      const listUrl = `https://www.deccanherald.com/tags/${tag}`;
      // Short TTL: tag pages go stale, and dh-speak-out especially lags.
      const listResp = await fetch(listUrl, { cf: { cacheTtl: 60 } });
      if (!listResp.ok) {
        console.warn(`Tag fetch failed for "${tag}": ${listResp.status}`);
        return;
      }
      const listHtml = await listResp.text();
      const paths = extractSpeakOutPaths(listHtml);
      if (!paths.length) {
        console.warn(`No Speak Out links found under tag "${tag}"`);
        return;
      }

      let newestOnTag: string | null = null;
      for (const path of paths) {
        const url = new URL(path, 'https://www.deccanherald.com').toString();
        const iso = isoDateFromSpeakOutUrl(url);
        if (!iso) continue;
        if (!found.has(iso)) found.set(iso, url);
        if (!newestOnTag || iso > newestOnTag) newestOnTag = iso;
      }
      console.log(
        `Tag "${tag}": ${paths.length} speak-out link(s), newest slug date ${newestOnTag ?? 'unknown'}`,
      );
    }),
  );

  return [...found.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, url]) => url);
}

async function fetchSpeakOutMeta(pageUrl: string, isoDate: string): Promise<SpeakOutMeta | null> {
  const articleResp = await fetch(pageUrl, { cf: { cacheTtl: 60 } });
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

  if (!imageUrl) {
    console.warn(`Could not extract og:image from ${pageUrl}`);
    return null;
  }

  // Prefer slug date for the locale title so Workers/local TZ cannot drift.
  let title = localeTitleFromIso(isoDate);
  const parsed = rawTitle.trim().split('|').pop()?.trim() ?? rawTitle.trim();
  if (parsed) {
    const fromH1 = new Date(parsed);
    if (!Number.isNaN(fromH1.getTime())) {
      // Keep h1 wording only when it agrees with the slug day.
      const h1Iso = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(fromH1);
      if (h1Iso === isoDate) {
        title = fromH1.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'Asia/Kolkata',
        });
      } else {
        console.warn(
          `H1 date "${parsed}" (${h1Iso}) disagrees with URL slug ${isoDate} — using slug`,
        );
      }
    }
  }

  return { title, imageUrl, pageUrl, isoDate };
}

export async function getLatestSpeakOut(): Promise<SpeakOutMeta> {
  // Collect every dated Speak Out URL across tags, then fetch meta for the newest
  // slug date. The dh-speak-out tag often lags (stuck on an older cartoon) while
  // speak-out / opinion already list the current day — taking only the first link
  // per tag used to let that stale URL win when fresher tags failed or were empty.
  const candidates = await collectCandidateUrls();
  if (!candidates.length) {
    throw new Error('Could not find latest Speak Out link across all tag pages');
  }

  const ranked = candidates
    .map((url) => ({ url, isoDate: isoDateFromSpeakOutUrl(url)! }))
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate));

  console.log(
    `Speak Out candidates by slug date: ${ranked
      .slice(0, 5)
      .map((c) => c.isoDate)
      .join(', ')}${ranked.length > 5 ? `, …(+${ranked.length - 5})` : ''}`,
  );

  for (const { url, isoDate } of ranked.slice(0, 5)) {
    const meta = await fetchSpeakOutMeta(url, isoDate);
    if (meta) {
      console.log(`Using Speak Out ${meta.isoDate}: "${meta.title}" (${meta.pageUrl})`);
      return meta;
    }
    console.warn(`Skipping Speak Out candidate ${isoDate} — meta extract failed`);
  }

  throw new Error('Could not extract metadata from any Speak Out article');
}
