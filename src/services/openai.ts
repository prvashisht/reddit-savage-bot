export const KNOWN_PARTIES = ['BJP', 'INC', 'UPA', 'NDA', 'AAP', 'SP', 'BSP', 'TMC'] as const;
export type KnownParty = (typeof KNOWN_PARTIES)[number];

export type PartyDetectionResult =
  | { party: KnownParty; person: string; confidence: 'high' | 'low' }
  | { party: null; reason: string };

const VISION_SYSTEM_PROMPT = `You are an expert on Indian politics and political cartoons.
Given an editorial cartoon image, identify the main Indian politician or political figure depicted.
Respond with JSON only, no markdown, in one of these two shapes:
{"person":"<full name>","confidence":"high"|"low"}
{"person":null,"reason":"<why you cannot identify anyone>"}`;

const PARTY_SEARCH_PROMPT = (person: string) =>
  `Which Indian political party does ${person} currently belong to as of 2026? ` +
  `Choose exactly one from this list: BJP, INC, UPA, NDA, AAP, SP, BSP, TMC. ` +
  `NDA and UPA are alliances — use them only if the person represents the alliance as a whole, not a member party. ` +
  `Reply with a single JSON object: {"party":"<name>","reason":"<one sentence>"}`;

async function identifyPersonFromImage(
  apiKey: string,
  imageUrl: string,
): Promise<{ person: string; confidence: 'high' | 'low' } | { person: null; reason: string }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
            { type: 'text', text: 'Who is the main politician in this cartoon?' },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI vision error: ${response.status} ${await response.text()}`);
  const data: any = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';

  try {
    const parsed = JSON.parse(content);
    if (parsed.person) {
      return { person: parsed.person, confidence: parsed.confidence === 'low' ? 'low' : 'high' };
    }
    return { person: null, reason: parsed.reason ?? 'Could not identify person' };
  } catch {
    return { person: null, reason: `Could not parse response: ${content}` };
  }
}

async function lookupPartyViaWebSearch(
  apiKey: string,
  person: string,
): Promise<KnownParty | null> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search_preview' }],
      input: PARTY_SEARCH_PROMPT(person),
    }),
  });

  if (!response.ok) throw new Error(`OpenAI search error: ${response.status} ${await response.text()}`);
  const data: any = await response.json();

  // Responses API returns output as an array of content blocks
  const textBlock = data.output?.find((b: any) => b.type === 'message')
    ?.content?.find((c: any) => c.type === 'output_text');
  const text: string = textBlock?.text ?? '';

  // Extract JSON from the response (model may wrap it in prose)
  const match = text.match(/\{[^}]+\}/);
  if (!match) {
    console.warn('Web search party lookup: no JSON in response:', text);
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    const party = parsed.party as string;
    if (KNOWN_PARTIES.includes(party as KnownParty)) {
      console.log(`Web search party for "${person}": ${party} — ${parsed.reason}`);
      return party as KnownParty;
    }
    return null;
  } catch {
    return null;
  }
}

export async function detectPartyFromImage(
  apiKey: string,
  imageUrl: string,
): Promise<PartyDetectionResult> {
  // Step 1: identify the person from the cartoon
  const identification = await identifyPersonFromImage(apiKey, imageUrl);
  if (!identification.person) {
    return { party: null, reason: 'reason' in identification ? identification.reason : 'Could not identify person' };
  }

  const { person, confidence } = identification;
  console.log(`Identified politician: "${person}" (confidence: ${confidence})`);

  // Step 2: look up their current party via web search
  const party = await lookupPartyViaWebSearch(apiKey, person);
  if (!party) {
    return { party: null, reason: `Could not determine party for "${person}" via web search` };
  }

  return { party, person, confidence };
}

// --- Catchy title generation (3-call: vision extract → text n=3 phrases → judge+party) ---

export const TITLE_MODEL = 'gpt-4o-mini';
export const MAX_PHRASE_CHARS = 80;
export const REDDIT_TITLE_MAX_CHARS = 300;
export const TITLE_BRAND = 'DH Speakout';
export const TITLE_CANDIDATE_COUNT = 3;

export type PersonKind = 'politician' | 'personality' | 'unknown';

export type NamedPerson = {
  name: string;
  kind: PersonKind;
};

/** Call 1 output: faithful layout extract (no phrase). */
export type CartoonExtract = {
  statement: string | null;
  /** Who said / is credited with the statement (not who the statement is about). */
  speaker: NamedPerson | null;
  /** People mentioned / depicted as the topic of the statement (e.g. Modi when CM quotes him). */
  about: NamedPerson[];
  satire: string | null;
  satireAuthor: string | null;
};

/** Default Call 1: vision extract only. */
export const DEFAULT_EXTRACT_PROMPT = `You extract text and attribution from Indian political editorial cartoons (Deccan Herald Speak Out).

Typical layout:
- Upper area: a statement / quote / claim (often attributed to a speaker by name, title, or byline)
- Lower area: a satire reply / punchline
- Optional cartoonist credit / signature

Reply with JSON only, no markdown, exactly this shape:
{"statement":"<verbatim upper statement or null>","speaker":{"name":"<who SAID the statement or null>","kind":"politician"|"personality"|"unknown"},"about":[{"name":"<person the statement is about>","kind":"politician"|"personality"|"unknown"}],"satire":"<verbatim lower satire text or null>","satireAuthor":"<cartoonist if shown else null>"}

Critical rules:
- Transcribe statement and satire VERBATIM from the image. Do not paraphrase, summarize, or invent.
- speaker = the person who spoke or is credited with the statement (byline, "says X", label next to the quote). NOT the person mentioned inside the quote.
  Example: if a CM says something about Modi, speaker is the CM; Modi goes in about[].
- about = people the statement is about / roasting / depicting (may be empty).
- kind=politician for office-holders/party figures; personality for celebrities/others; unknown if unclear.
- satireAuthor = cartoonist signature/credit if visible, else null.
- use null (not empty string) for missing scalar fields; use [] when about is empty.`;

/** @deprecated Use DEFAULT_EXTRACT_PROMPT. Kept for older dashboard localStorage keys. */
export const DEFAULT_CATCHY_TITLE_PROMPT = DEFAULT_EXTRACT_PROMPT;

/** Default Call 2: text-only catchy phrases from extracted fields. */
export const DEFAULT_PHRASE_PROMPT = `You write short, punchy Reddit titles for Indian political editorial cartoons (Deccan Herald Speak Out).

You receive extracted cartoon text (no image). Prefer wordplay/ideas from the satire / punchline.

Rules:
- Reply with JSON only, no markdown: {"phrase":"<title>"}
- witty headline, not a caption or full paraphrase
- 3 to 8 words, under 80 characters
- no quotation marks, hashtags, emojis, or trailing punctuation
- prefer sharp irony; naming a well-known figure is fine when it helps
- do not include dates, "DH Speakout", or "Speak Out"`;

/** Default Call 3: pick best phrase; party via web search for the SPEAKER when politician. */
export const DEFAULT_CHOOSE_TITLE_PROMPT = `You finalize a Reddit title for an Indian political editorial cartoon (Deccan Herald Speak Out).

You receive extracted cartoon text and a numbered list of candidate phrases (no image).

Tasks:
1) Choose the single best phrase: punchiest, clearest joke/irony, most natural as a Reddit headline.
   Prefer wit over bland description. Prefer short over long when quality is close.
   Use statement/satire to judge which phrase best lands the joke.
2) If the SPEAKER kind is "politician" and a speaker name is provided, use web search to find their CURRENT party affiliation as of 2026.
   Choose exactly one party from: BJP, INC, UPA, NDA, AAP, SP, BSP, TMC.
   NDA/UPA only if they represent the alliance as a whole.
   Party is for the SPEAKER (who said the statement), not people in about[].
   If speaker is personality/unknown/missing, set party to null.

Rules:
- Reply with JSON only, no markdown:
  {"index":<0-based index>,"reason":"<one short sentence>","party":"<party or null>","partyReason":"<one short sentence or null>"}
- index must refer to one of the provided candidates
- Do not invent a new phrase
- For politician speakers, party MUST come from web search, not model memory alone`;

export type CatchyTitleResult = {
  phrase: string;
  fullTitle: string;
  model: string;
  candidates: string[];
  chosenIndex: number;
  reason: string;
  extract: CartoonExtract;
  party: KnownParty | null;
  partyReason: string | null;
  extractPromptUsed: string;
  phrasePromptUsed: string;
  choosePromptUsed: string;
};

export type SanitizePhraseResult =
  | { ok: true; phrase: string }
  | { ok: false; reason: string };

/** Strip model fluff and validate phrase length/content. */
export function sanitizePhrase(raw: unknown): SanitizePhraseResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'Phrase is not a string' };
  }

  let phrase = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '')
    .trim();

  if (!phrase) {
    return { ok: false, reason: 'Phrase is empty' };
  }
  if (phrase.length > MAX_PHRASE_CHARS) {
    return { ok: false, reason: `Phrase exceeds ${MAX_PHRASE_CHARS} characters` };
  }
  if (/[\n\r]/.test(phrase)) {
    return { ok: false, reason: 'Phrase contains newlines' };
  }

  return { ok: true, phrase };
}

function sanitizeOptionalText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t || /^null$/i.test(t) || t === '—') return null;
  return t;
}

function sanitizePersonKind(raw: unknown): PersonKind {
  if (raw === 'politician' || raw === 'personality' || raw === 'unknown') return raw;
  return 'unknown';
}

function sanitizeNamedPerson(raw: unknown): NamedPerson | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name = sanitizeOptionalText(obj.name);
  if (!name) return null;
  return { name, kind: sanitizePersonKind(obj.kind) };
}

/** Compose final Reddit title. Date must already be YYYY-MM-DD. */
export function composeFullTitle(phrase: string, isoDate: string): string {
  const full = `${phrase} | ${isoDate} | ${TITLE_BRAND}`;
  if (full.length > REDDIT_TITLE_MAX_CHARS) {
    throw new Error(`Composed title exceeds Reddit's ${REDDIT_TITLE_MAX_CHARS}-character limit`);
  }
  return full;
}

/** Parse YYYY-MM-DD; returns null if invalid. */
export function parseIsoDate(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Convert a Date or parseable date string to YYYY-MM-DD (UTC calendar day). */
export function toIsoDate(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(input)}`);
  }
  return d.toISOString().slice(0, 10);
}

/** Resolve a 0-based chosen index from the judge response against candidates. */
export function resolveChosenIndex(rawIndex: unknown, candidateCount: number): number | null {
  const n = typeof rawIndex === 'number' ? rawIndex : typeof rawIndex === 'string' ? Number(rawIndex) : NaN;
  if (!Number.isInteger(n) || n < 0 || n >= candidateCount) return null;
  return n;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const match = content.match(/\{[\s\S]*\}/);
  return JSON.parse(match?.[0] ?? content);
}

export function parseCartoonExtract(content: string): CartoonExtract {
  const parsed = parseJsonObject(content);

  const aboutRaw = Array.isArray(parsed.about) ? parsed.about : [];
  const about = aboutRaw
    .map((item) => sanitizeNamedPerson(item))
    .filter((p): p is NamedPerson => p !== null);

  return {
    statement: sanitizeOptionalText(parsed.statement),
    speaker: sanitizeNamedPerson(parsed.speaker),
    about,
    satire: sanitizeOptionalText(parsed.satire),
    satireAuthor: sanitizeOptionalText(parsed.satireAuthor),
  };
}

function formatExtractContext(extract: CartoonExtract): string {
  const aboutStr = extract.about.length
    ? extract.about.map((p) => `${p.name} (${p.kind})`).join(', ')
    : '(none)';
  return [
    extract.statement ? `Statement: ${extract.statement}` : 'Statement: (none)',
    extract.speaker
      ? `Speaker: ${extract.speaker.name} (kind=${extract.speaker.kind})`
      : 'Speaker: (none)',
    `About: ${aboutStr}`,
    extract.satire ? `Satire: ${extract.satire}` : 'Satire: (none)',
    extract.satireAuthor ? `Satire author: ${extract.satireAuthor}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Call 1: vision extract (n=1, temp 0, detail auto). */
async function extractCartoon(
  apiKey: string,
  imageUrl: string,
  extractPrompt: string,
): Promise<CartoonExtract> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TITLE_MODEL,
      max_tokens: 400,
      temperature: 0,
      messages: [
        { role: 'system', content: extractPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'auto' } },
            {
              type: 'text',
              text:
                'Extract verbatim statement, speaker (who said it), about[], satire, and optional satire author. Do not write a title.',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI extract error: ${response.status} ${await response.text()}`);
  }

  const data: any = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';
  try {
    return parseCartoonExtract(content);
  } catch (e) {
    throw new Error(
      `Could not parse extract: ${e instanceof Error ? e.message : String(e)} — ${content}`,
    );
  }
}

/** Call 2: text-only n=3 phrase candidates (temp 0.9). */
async function generatePhraseCandidates(
  apiKey: string,
  extract: CartoonExtract,
  phrasePrompt: string,
): Promise<string[]> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TITLE_MODEL,
      n: TITLE_CANDIDATE_COUNT,
      max_tokens: 60,
      temperature: 0.9,
      messages: [
        { role: 'system', content: phrasePrompt },
        {
          role: 'user',
          content:
            `${formatExtractContext(extract)}\n\nWrite one catchy Reddit title phrase for this cartoon.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI phrase error: ${response.status} ${await response.text()}`);
  }

  const data: any = await response.json();
  const choices: any[] = data.choices ?? [];
  if (!choices.length) throw new Error('OpenAI phrase call returned no choices');

  const phrases: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < choices.length; i++) {
    const content: string = choices[i]?.message?.content ?? '';
    try {
      const parsed = parseJsonObject(content);
      const sanitized = sanitizePhrase(parsed.phrase);
      if (!sanitized.ok) throw new Error(sanitized.reason);
      phrases.push(sanitized.phrase);
    } catch (e) {
      errors.push(`#${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!phrases.length) {
    throw new Error(`Could not parse any phrases: ${errors.join('; ')}`);
  }
  return phrases;
}

async function judgePhraseAndParty(
  apiKey: string,
  extract: CartoonExtract,
  candidates: string[],
  choosePrompt: string,
): Promise<{ index: number; reason: string; party: KnownParty | null; partyReason: string | null }> {
  const list = candidates.map((p, i) => `${i}. ${p}`).join('\n');
  const needPartySearch = extract.speaker?.kind === 'politician' && !!extract.speaker.name;

  const context = [
    formatExtractContext(extract),
    needPartySearch
      ? `Party lookup required: YES — web-search current party for SPEAKER "${extract.speaker!.name}".`
      : 'Party lookup required: NO — set party to null.',
  ].join('\n');

  const userInput =
    `${context}\n\nCandidates:\n${list}\n\n` +
    `Pick the best phrase` +
    (needPartySearch ? ` and web-search the SPEAKER's current party` : ``) +
    `. Reply with JSON only: {"index":<0-based>,"reason":"<one sentence>","party":"<party or null>","partyReason":"<one sentence or null>"}.`;

  if (needPartySearch) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TITLE_MODEL,
        tools: [{ type: 'web_search_preview' }],
        instructions: choosePrompt,
        temperature: 0.1,
        input: userInput,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI judge/search error: ${response.status} ${await response.text()}`);
    }

    const data: any = await response.json();
    const textBlock = data.output?.find((b: any) => b.type === 'message')
      ?.content?.find((c: any) => c.type === 'output_text');
    const text: string = textBlock?.text ?? '';
    return parseJudgeResponse(text, candidates.length);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TITLE_MODEL,
      max_tokens: 120,
      temperature: 0.1,
      messages: [
        { role: 'system', content: choosePrompt },
        { role: 'user', content: userInput },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI judge error: ${response.status} ${await response.text()}`);
  }

  const data: any = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';
  return parseJudgeResponse(content, candidates.length);
}

function parseJudgeResponse(
  content: string,
  candidateCount: number,
): { index: number; reason: string; party: KnownParty | null; partyReason: string | null } {
  let parsed: Record<string, unknown>;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? content);
  } catch {
    throw new Error(`Could not parse judge response: ${content}`);
  }

  const index = resolveChosenIndex(parsed.index, candidateCount);
  if (index === null) {
    throw new Error(`Judge index out of range: ${String(parsed.index)}`);
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().replace(/\s+/g, ' ')
      : 'No reason given';

  let party: KnownParty | null = null;
  if (typeof parsed.party === 'string' && KNOWN_PARTIES.includes(parsed.party as KnownParty)) {
    party = parsed.party as KnownParty;
  } else if (parsed.party === null || parsed.party === 'null' || parsed.party === undefined) {
    party = null;
  }

  const partyReason =
    typeof parsed.partyReason === 'string' && parsed.partyReason.trim()
      ? parsed.partyReason.trim().replace(/\s+/g, ' ')
      : party
        ? 'Party returned without reason'
        : null;

  return { index, reason, party, partyReason };
}

function skipPartyReason(extract: CartoonExtract): string {
  if (!extract.speaker?.name) return 'No speaker name to look up';
  if (extract.speaker.kind === 'personality') return 'Speaker is a personality — skipped party web search';
  return 'Speaker kind unknown — skipped party web search';
}

export type GenerateCatchyTitleOptions = {
  /** Override Call 1 extract system prompt. */
  extractPrompt?: string;
  /** Override Call 2 phrase system prompt. */
  phrasePrompt?: string;
  /** @deprecated Prefer extractPrompt; still accepted as extract override. */
  prompt?: string;
  /** Override Call 3 choose/party system prompt. */
  choosePrompt?: string;
  /** ISO date YYYY-MM-DD for the composed title. Defaults to today UTC. */
  date?: string;
};

export async function generateCatchyTitle(
  apiKey: string,
  imageUrl: string,
  options: GenerateCatchyTitleOptions = {},
): Promise<CatchyTitleResult> {
  const extractPromptUsed = (
    options.extractPrompt?.trim() ||
    options.prompt?.trim() ||
    DEFAULT_EXTRACT_PROMPT
  ).trim();
  const phrasePromptUsed = (options.phrasePrompt?.trim() || DEFAULT_PHRASE_PROMPT).trim();
  const choosePromptUsed = (options.choosePrompt?.trim() || DEFAULT_CHOOSE_TITLE_PROMPT).trim();
  const isoDate = options.date ? parseIsoDate(options.date) : toIsoDate();
  if (!isoDate) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${options.date}`);
  }

  // Call 1: vision extract
  const extract = await extractCartoon(apiKey, imageUrl, extractPromptUsed);

  // Call 2: text-only n=3 phrases
  const candidates = await generatePhraseCandidates(apiKey, extract, phrasePromptUsed);

  // Call 3: pick best (+ web search party for politician speaker)
  let chosenIndex = 0;
  let reason = 'All candidates were identical';
  let party: KnownParty | null = null;
  let partyReason: string | null = null;

  const unique = [...new Set(candidates)];
  const needPartySearch = extract.speaker?.kind === 'politician' && !!extract.speaker.name;

  if (unique.length === 1 && !needPartySearch) {
    chosenIndex = 0;
    partyReason = skipPartyReason(extract);
  } else {
    const judged = await judgePhraseAndParty(apiKey, extract, candidates, choosePromptUsed);
    chosenIndex = judged.index;
    reason = unique.length === 1 ? 'All candidates were identical' : judged.reason;
    if (needPartySearch) {
      party = judged.party;
      partyReason = judged.partyReason;
    } else {
      party = null;
      partyReason = skipPartyReason(extract);
    }
  }

  const phrase = candidates[chosenIndex];
  const fullTitle = composeFullTitle(phrase, isoDate);
  return {
    phrase,
    fullTitle,
    model: TITLE_MODEL,
    candidates,
    chosenIndex,
    reason,
    extract,
    party,
    partyReason,
    extractPromptUsed,
    phrasePromptUsed,
    choosePromptUsed,
  };
}
