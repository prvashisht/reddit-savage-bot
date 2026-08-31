export type SpeakOutMeta = {
  title: string;
  imageUrl: string;
  pageUrl: string;
  /** YYYY-MM-DD from the URL slug, or a strict Speak Out H1 fallback. */
  isoDate: string;
};

const TAG_SLUGS = ['speak-out', 'opinion', 'dh-speak-out'] as const;
const MONTHS: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sept: '09',
  sep: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

/** How many undated slugs to open for an H1 date. Tag pages list newest first. */
const MAX_UNDATED_H1_FETCHES = 5;

type SpeakOutCandidate = {
  url: string;
  isoDate: string;
  /** Set when the date came from an article fetch (undated slug). */
  meta?: SpeakOutMeta;
};

function calendarIso(monthName: string, dayRaw: string, year: string): string | null {
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  const day = dayRaw.padStart(2, '0');
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

/** Parse YYYY-MM-DD from URLs like .../dh-speak-out-july-30-2026-4092593 */
export function isoDateFromSpeakOutUrl(pageUrl: string): string | null {
  const m = pageUrl.match(/speak-out-([a-z]+)-(\d{1,2})-(\d{4})(?:-|\b)/i);
  if (!m) return null;
  return calendarIso(m[1], m[2], m[3]);
}

/**
 * Strict cartoon date from an article H1 / headline.
 * Accepts only "DH Speak Out | August 31, 2026" or "Speak Out | Aug 6, 2025".
 * Rejects SEO suffixes, colons, yearless strings, and raw Date.parse.
 */
export function isoDateFromHeadline(headline: string): string | null {
  const m = headline
    .trim()
    .match(/^(?:dh\s+)?speak\s*out\s*\|\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/i);
  if (!m) return null;
  return calendarIso(m[1], m[2], m[3]);
}

/** Slug date wins; H1 is used only when the slug has no date. */
export function resolveSpeakOutIsoDate(pageUrl: string, headline?: string | null): string | null {
  return isoDateFromSpeakOutUrl(pageUrl) ?? (headline ? isoDateFromHeadline(headline) : null);
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

async function collectCandidates(): Promise<SpeakOutCandidate[]> {
  const found = new Map<string, SpeakOutCandidate>(); // isoDate -> candidate (first wins)
  const undated: string[] = [];
  const seenUrls = new Set<string>();

  const tagResults = await Promise.all(
    TAG_SLUGS.map(async (tag) => {
      const listUrl = `https://www.deccanherald.com/tags/${tag}`;
      // Short TTL: tag pages go stale, and dh-speak-out especially lags.
      const listResp = await fetch(listUrl, { cf: { cacheTtl: 60 } });
      if (!listResp.ok) {
        console.warn(`Tag fetch failed for "${tag}": ${listResp.status}`);
        return { tag, paths: [] as string[] };
      }
      const listHtml = await listResp.text();
      const paths = extractSpeakOutPaths(listHtml);
      if (!paths.length) {
        console.warn(`No Speak Out links found under tag "${tag}"`);
      }
      return { tag, paths };
    }),
  );

  // Merge in tag order (speak-out first) so dedicated listings win ties.
  for (const { tag, paths } of tagResults) {
    let newestSlugOnTag: string | null = null;
    let undatedOnTag = 0;
    for (const path of paths) {
      const url = new URL(path, 'https://www.deccanherald.com').toString();
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      const iso = isoDateFromSpeakOutUrl(url);
      if (iso) {
        if (!found.has(iso)) found.set(iso, { url, isoDate: iso });
        if (!newestSlugOnTag || iso > newestSlugOnTag) newestSlugOnTag = iso;
      } else {
        undated.push(url);
        undatedOnTag += 1;
      }
    }
    console.log(
      `Tag "${tag}": ${paths.length} speak-out link(s), newest slug date ${newestSlugOnTag ?? 'none'}, ${undatedOnTag} undated slug(s)`,
    );
  }

  const toResolve = undated.slice(0, MAX_UNDATED_H1_FETCHES);
  if (undated.length > toResolve.length) {
    console.warn(
      `Skipping ${undated.length - toResolve.length} extra undated Speak Out slug(s) (cap ${MAX_UNDATED_H1_FETCHES})`,
    );
  }

  const h1Metas = await Promise.all(toResolve.map((url) => fetchSpeakOutMeta(url, null)));
  for (let i = 0; i < toResolve.length; i++) {
    const url = toResolve[i];
    const meta = h1Metas[i];
    if (!meta) {
      console.warn(`Undated Speak Out slug has no strict H1 date — skipping ${url}`);
      continue;
    }
    if (found.has(meta.isoDate)) {
      console.log(
        `H1 date ${meta.isoDate} from ${url} already has a dated slug — keeping slug URL`,
      );
      continue;
    }
    found.set(meta.isoDate, { url, isoDate: meta.isoDate, meta });
    console.log(`H1 date ${meta.isoDate} from undated slug ${url}`);
  }

  return [...found.values()].sort((a, b) => b.isoDate.localeCompare(a.isoDate));
}

async function fetchSpeakOutMeta(pageUrl: string, slugIso: string | null): Promise<SpeakOutMeta | null> {
  const articleResp = await fetch(pageUrl, { cf: { cacheTtl: 60 } });
  if (!articleResp.ok) {
    console.warn(`Failed article fetch ${pageUrl}: ${articleResp.status}`);
    return null;
  }

  let rawTitle = '';
  let imageUrl = '';
  let h1Done = false;

  await new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(e) {
        const u = e.getAttribute('content');
        if (u) imageUrl = u.trim().split('?')[0];
      },
    })
    .on('h1', {
      text(t) {
        if (h1Done) return;
        rawTitle += t.text;
        if (t.lastInTextNode) h1Done = true;
      },
    })
    .transform(articleResp)
    .arrayBuffer();

  if (!imageUrl) {
    console.warn(`Could not extract og:image from ${pageUrl}`);
    return null;
  }

  const headline = rawTitle.trim();
  const h1Iso = isoDateFromHeadline(headline);
  const isoDate = slugIso ?? h1Iso;
  if (!isoDate) {
    console.warn(`Could not parse Speak Out date from H1 "${headline}" (${pageUrl})`);
    return null;
  }
  if (slugIso && h1Iso && h1Iso !== slugIso) {
    console.warn(`H1 date ${h1Iso} disagrees with URL slug ${slugIso} — using slug`);
  }

  return { title: localeTitleFromIso(isoDate), imageUrl, pageUrl, isoDate };
}

export async function getLatestSpeakOut(): Promise<SpeakOutMeta> {
  // Collect Speak Out URLs across tags, rank by slug date, and only then use a
  // strict H1 date for slugs like speak-2-4129540 that omit month/day/year.
  const candidates = await collectCandidates();
  if (!candidates.length) {
    throw new Error('Could not find latest Speak Out link across all tag pages');
  }

  console.log(
    `Speak Out candidates by date: ${candidates
      .slice(0, 5)
      .map((c) => c.isoDate)
      .join(', ')}${candidates.length > 5 ? `, …(+${candidates.length - 5})` : ''}`,
  );

  for (const candidate of candidates.slice(0, 5)) {
    const meta = candidate.meta ?? (await fetchSpeakOutMeta(candidate.url, candidate.isoDate));
    if (meta) {
      console.log(`Using Speak Out ${meta.isoDate}: "${meta.title}" (${meta.pageUrl})`);
      return meta;
    }
    console.warn(`Skipping Speak Out candidate ${candidate.isoDate} — meta extract failed`);
  }

  throw new Error('Could not extract metadata from any Speak Out article');
}
