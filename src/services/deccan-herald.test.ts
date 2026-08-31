import { describe, expect, it } from 'vitest';
import {
  isoDateFromHeadline,
  isoDateFromSpeakOutUrl,
  resolveSpeakOutIsoDate,
} from './deccan-herald';

describe('isoDateFromSpeakOutUrl', () => {
  it('parses DH Speak Out URL slugs', () => {
    expect(
      isoDateFromSpeakOutUrl(
        'https://www.deccanherald.com/opinion/speak-out/dh-speak-out-july-30-2026-4092593',
      ),
    ).toBe('2026-07-30');
    expect(
      isoDateFromSpeakOutUrl(
        'https://www.deccanherald.com/opinion/speak-out/dh-speak-out-july-25-2026-4086473',
      ),
    ).toBe('2026-07-25');
    expect(
      isoDateFromSpeakOutUrl('/opinion/speak-out/dh-speak-out-january-1-2026-1'),
    ).toBe('2026-01-01');
    expect(
      isoDateFromSpeakOutUrl(
        'https://www.deccanherald.com/opinion/speak-out/dh-speak-out-august-26-2026-2-4123033',
      ),
    ).toBe('2026-08-26');
  });

  it('parses abbreviated month names in the slug', () => {
    expect(
      isoDateFromSpeakOutUrl('/opinion/speak-out/dh-speak-out-aug-6-2025-3667485'),
    ).toBe('2025-08-06');
  });

  it('rejects undated or malformed slugs', () => {
    expect(isoDateFromSpeakOutUrl('https://www.deccanherald.com/opinion/other')).toBeNull();
    expect(isoDateFromSpeakOutUrl('dh-speak-out-july-32-2026-1')).toBeNull();
    expect(
      isoDateFromSpeakOutUrl('https://www.deccanherald.com/opinion/speak-out/speak-2-4129540'),
    ).toBeNull();
    expect(
      isoDateFromSpeakOutUrl('https://www.deccanherald.com/opinion/speak-out/speak-3461111'),
    ).toBeNull();
  });
});

describe('isoDateFromHeadline', () => {
  it('parses DH Speak Out | Month D, YYYY', () => {
    expect(isoDateFromHeadline('DH Speak Out | August 31, 2026')).toBe('2026-08-31');
    expect(isoDateFromHeadline('Speak Out | February 16, 2024')).toBe('2024-02-16');
    expect(isoDateFromHeadline('DH Speak Out | Aug 6, 2025')).toBe('2025-08-06');
    expect(isoDateFromHeadline('Speak Out | December 26,2023')).toBe('2023-12-26');
  });

  it('rejects headlines that are not a strict Speak Out date', () => {
    expect(
      isoDateFromHeadline('DH Speak Out | March 23, 2026: Daily Cartoon and Reader Views'),
    ).toBeNull();
    expect(isoDateFromHeadline('Speak Out: November 11, 2023')).toBeNull();
    expect(isoDateFromHeadline("Editor's Note: Best of Speak Out")).toBeNull();
    expect(isoDateFromHeadline('DH Speak Out is back!')).toBeNull();
    expect(isoDateFromHeadline('August 31, 2026')).toBeNull();
    expect(isoDateFromHeadline('Speak Out: October 24')).toBeNull();
    expect(isoDateFromHeadline('Speak Out | July 32, 2026')).toBeNull();
    expect(
      isoDateFromHeadline(
        "Today's Horoscope - October 16, 2021: Check horoscope for all sun signs",
      ),
    ).toBeNull();
  });
});

describe('resolveSpeakOutIsoDate', () => {
  it('prefers the slug date even when the H1 disagrees', () => {
    expect(
      resolveSpeakOutIsoDate(
        '/opinion/speak-out/dh-speak-out-july-2-2026-2-4060547',
        'DH Speak Out | July 3, 2026',
      ),
    ).toBe('2026-07-02');
  });

  it('falls back to a strict H1 date when the slug has no date', () => {
    expect(
      resolveSpeakOutIsoDate(
        'https://www.deccanherald.com/opinion/speak-out/speak-2-4129540',
        'DH Speak Out | August 31, 2026',
      ),
    ).toBe('2026-08-31');
    expect(
      resolveSpeakOutIsoDate(
        'https://www.deccanherald.com/opinion/speak-out/speak-2-4129540',
        'DH Speak Out | March 23, 2026: Daily Cartoon',
      ),
    ).toBeNull();
  });
});
