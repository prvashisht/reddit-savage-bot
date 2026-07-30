import { describe, expect, it } from 'vitest';
import { isoDateFromSpeakOutUrl } from './deccan-herald';

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
  });

  it('rejects non-speak-out or malformed slugs', () => {
    expect(isoDateFromSpeakOutUrl('https://www.deccanherald.com/opinion/other')).toBeNull();
    expect(isoDateFromSpeakOutUrl('dh-speak-out-july-32-2026-1')).toBeNull();
  });
});
