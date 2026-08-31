import { describe, expect, it } from 'vitest';
import { isoDateFromRedditTitle, speakoutAlreadyOnReddit } from './run';
import { TITLE_BRAND } from '../services/openai';

describe('isoDateFromRedditTitle', () => {
  it('reads ISO dates from current titles', () => {
    expect(isoDateFromRedditTitle(`Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`)).toBe(
      '2026-08-14',
    );
    expect(isoDateFromRedditTitle(`2026-08-14 | ${TITLE_BRAND}`)).toBe('2026-08-14');
  });

  it('uses the date next to the brand when the phrase also looks like an ISO date', () => {
    expect(
      isoDateFromRedditTitle(`2026-01-01 leftovers | 2026-08-14 | ${TITLE_BRAND}`),
    ).toBe('2026-08-14');
  });

  it('reads the old locale titles', () => {
    expect(isoDateFromRedditTitle('DH Speakout | Monday, August 31, 2026')).toBe('2026-08-31');
  });

  it('returns null when there is no date', () => {
    expect(isoDateFromRedditTitle('random dump')).toBeNull();
  });
});

describe('speakoutAlreadyOnReddit', () => {
  it('treats the same day as already posted', () => {
    expect(
      speakoutAlreadyOnReddit(
        `Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`,
        'Friday, August 14, 2026',
        '2026-08-14',
      ),
    ).toBe(true);
  });

  it('skips when /new is already a later cartoon', () => {
    expect(
      speakoutAlreadyOnReddit(
        `Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`,
        'Thursday, August 13, 2026',
        '2026-08-13',
      ),
    ).toBe(true);
  });

  it('does not skip when Reddit is behind', () => {
    expect(
      speakoutAlreadyOnReddit(
        `Lotus in the blender | 2026-08-13 | ${TITLE_BRAND}`,
        'Friday, August 14, 2026',
        '2026-08-14',
      ),
    ).toBe(false);
  });

  it('skips a newer locale title too', () => {
    expect(
      speakoutAlreadyOnReddit(
        'DH Speakout | Friday, August 14, 2026',
        'Thursday, August 13, 2026',
        '2026-08-13',
      ),
    ).toBe(true);
  });
});
