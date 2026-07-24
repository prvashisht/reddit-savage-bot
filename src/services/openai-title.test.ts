import { describe, expect, it } from 'vitest';
import {
  sanitizePhrase,
  composeFullTitle,
  parseIsoDate,
  toIsoDate,
  resolveChosenIndex,
  parseCartoonExtract,
  TITLE_BRAND,
  MAX_PHRASE_CHARS,
} from './openai';

describe('sanitizePhrase', () => {
  it('trims and collapses whitespace', () => {
    const result = sanitizePhrase('  Lotus   in the   blender  ');
    expect(result).toEqual({ ok: true, phrase: 'Lotus in the blender' });
  });

  it('strips wrapping quotes and trailing punctuation', () => {
    expect(sanitizePhrase('"Power play"')).toEqual({ ok: true, phrase: 'Power play' });
    expect(sanitizePhrase('Lotus wilts!')).toEqual({ ok: true, phrase: 'Lotus wilts' });
  });

  it('rejects empty / non-strings / too long', () => {
    expect(sanitizePhrase('').ok).toBe(false);
    expect(sanitizePhrase(null).ok).toBe(false);
    expect(sanitizePhrase('x'.repeat(MAX_PHRASE_CHARS + 1)).ok).toBe(false);
  });
});

describe('composeFullTitle', () => {
  it('composes catchy-first title with ISO date and brand', () => {
    expect(composeFullTitle('Lotus in the blender', '2026-07-24')).toBe(
      `Lotus in the blender | 2026-07-24 | ${TITLE_BRAND}`,
    );
  });
});

describe('parseIsoDate / toIsoDate / resolveChosenIndex', () => {
  it('parses ISO dates', () => {
    expect(parseIsoDate('2026-07-24')).toBe('2026-07-24');
    expect(parseIsoDate('07-24-2026')).toBeNull();
  });

  it('converts Date and locale speakout titles to Asia/Kolkata calendar day', () => {
    expect(toIsoDate(new Date('2026-07-24T12:00:00Z'))).toBe('2026-07-24');
    // Locale midnight must not slip a day via UTC toISOString()
    expect(toIsoDate('Friday, July 24, 2026')).toBe('2026-07-24');
  });

  it('resolves chosen indices', () => {
    expect(resolveChosenIndex(1, 3)).toBe(1);
    expect(resolveChosenIndex(3, 3)).toBeNull();
  });
});

describe('parseCartoonExtract', () => {
  it('parses speaker vs about', () => {
    const raw = JSON.stringify({
      statement: 'Modi will take action',
      speaker: { name: 'Manik Saha', kind: 'politician' },
      about: [{ name: 'Narendra Modi', kind: 'politician' }],
      satire: 'After the exam, wisdom',
      satireAuthor: 'EP Unny',
    });
    expect(parseCartoonExtract(raw)).toEqual({
      statement: 'Modi will take action',
      speaker: { name: 'Manik Saha', kind: 'politician' },
      about: [{ name: 'Narendra Modi', kind: 'politician' }],
      satire: 'After the exam, wisdom',
      satireAuthor: 'EP Unny',
    });
  });

  it('normalizes nullish fields', () => {
    const raw = JSON.stringify({
      statement: 'null',
      speaker: null,
      about: [],
      satire: '',
      satireAuthor: null,
    });
    expect(parseCartoonExtract(raw)).toEqual({
      statement: null,
      speaker: null,
      about: [],
      satire: null,
      satireAuthor: null,
    });
  });

  it('drops about entries without names', () => {
    const raw = JSON.stringify({
      statement: 'x',
      speaker: { name: 'A', kind: 'weird' },
      about: [{ name: null, kind: 'politician' }, { name: 'B', kind: 'personality' }],
      satire: null,
      satireAuthor: null,
    });
    expect(parseCartoonExtract(raw)).toEqual({
      statement: 'x',
      speaker: { name: 'A', kind: 'unknown' },
      about: [{ name: 'B', kind: 'personality' }],
      satire: null,
      satireAuthor: null,
    });
  });
});
