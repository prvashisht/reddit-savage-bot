import { describe, expect, it } from 'vitest';
import { isoDateFromRedditTitle, speakoutAlreadyOnReddit, coveringSpeakoutInWindow, weekdayTitle } from './run';
import { TITLE_BRAND } from '../services/openai';

describe('isoDateFromRedditTitle', () => {
  it('reads ISO dates from current titles', () => {
    expect(isoDateFromRedditTitle(`Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`)).toBe(
      '2026-08-14',
    );
    expect(isoDateFromRedditTitle(`Monday | 2026-08-31 | ${TITLE_BRAND}`)).toBe('2026-08-31');
    expect(isoDateFromRedditTitle(`2026-08-14 | ${TITLE_BRAND}`)).toBe('2026-08-14');
  });

  it('uses the date next to the brand when the phrase also looks like an ISO date', () => {
    expect(
      isoDateFromRedditTitle(`2026-01-01 leftovers | 2026-08-14 | ${TITLE_BRAND}`),
    ).toBe('2026-08-14');
  });

  it('ignores titles that are not the current Speak Out format', () => {
    expect(isoDateFromRedditTitle('Election schedule 2026-09-10')).toBeNull();
    expect(isoDateFromRedditTitle('DH Speakout | Monday, August 31, 2026')).toBeNull();
    expect(isoDateFromRedditTitle('random dump')).toBeNull();
  });
});

describe('weekdayTitle', () => {
  it('uses the weekday as the phrase', () => {
    expect(weekdayTitle('2026-08-31')).toBe(`Monday | 2026-08-31 | ${TITLE_BRAND}`);
    expect(weekdayTitle('2026-08-14')).toBe(`Friday | 2026-08-14 | ${TITLE_BRAND}`);
  });
});

describe('speakoutAlreadyOnReddit', () => {
  it('treats the same day as already posted', () => {
    expect(
      speakoutAlreadyOnReddit(`Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`, '2026-08-14'),
    ).toBe(true);
    expect(speakoutAlreadyOnReddit(`Friday | 2026-08-14 | ${TITLE_BRAND}`, '2026-08-14')).toBe(true);
  });

  it('skips when /new is already a later cartoon', () => {
    expect(
      speakoutAlreadyOnReddit(`Lotus in the blender | 2026-08-14 | ${TITLE_BRAND}`, '2026-08-13'),
    ).toBe(true);
  });

  it('does not skip when Reddit is behind', () => {
    expect(
      speakoutAlreadyOnReddit(`Lotus in the blender | 2026-08-13 | ${TITLE_BRAND}`, '2026-08-14'),
    ).toBe(false);
  });

  it('does not treat an unrelated ISO date as a Speak Out post', () => {
    expect(speakoutAlreadyOnReddit('Election schedule 2026-09-10', '2026-08-13')).toBe(false);
  });
});

describe('coveringSpeakoutInWindow', () => {
  const t = (phrase: string, iso: string) => `${phrase} | ${iso} | ${TITLE_BRAND}`;

  it('finds a branded Speak Out under a meta post', () => {
    const posts = [
      { title: '[meta] sticky' },
      { title: t('Lotus in the blender', '2026-08-14') },
    ];
    const covering = coveringSpeakoutInWindow(posts, '2026-08-14');
    expect(covering?.postedIso).toBe('2026-08-14');
    expect(covering?.post.title).toBe(t('Lotus in the blender', '2026-08-14'));
  });

  it('uses the latest cartoon date in the window, not post order', () => {
    const posts = [
      { title: t('older cartoon posted late', '2026-08-13') },
      { title: t('Lotus in the blender', '2026-08-14') },
    ];
    expect(coveringSpeakoutInWindow(posts, '2026-08-13')?.postedIso).toBe('2026-08-14');
    expect(coveringSpeakoutInWindow(posts, '2026-08-14')?.postedIso).toBe('2026-08-14');
  });

  it('does not skip when the window is behind DH', () => {
    const posts = [{ title: '[meta] sticky' }, { title: t('Lotus in the blender', '2026-08-13') }];
    expect(coveringSpeakoutInWindow(posts, '2026-08-14')).toBeNull();
  });

  it('ignores unrelated titles with ISO-looking dates', () => {
    const posts = [{ title: 'Election schedule 2026-09-10' }, { title: '[meta] sticky' }];
    expect(coveringSpeakoutInWindow(posts, '2026-08-13')).toBeNull();
  });
});
