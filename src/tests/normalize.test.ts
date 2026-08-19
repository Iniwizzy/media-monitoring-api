import { describe, it, expect } from 'vitest';
import { normalizeMention, RawMention } from '../normalize';

// Base valid record — individual tests override specific fields
const base: RawMention = {
  external_id: 'test-001',
  source: 'The Star',
  title: 'Test Title',
  content: 'Plain content.',
  url: 'https://example.com/1',
  author: 'Author Name',
  published_at: '2026-08-10T08:15:00Z',
  engagement: 100,
};

function make(overrides: Partial<RawMention>): RawMention {
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------
describe('source normalisation', () => {
  it('lowercases mixed-case source', () => {
    const r = normalizeMention(make({ source: 'The Star' }));
    expect(r.source).toBe('the star');
  });

  it('trims trailing whitespace', () => {
    const r = normalizeMention(make({ source: 'malaysiakini ' }));
    expect(r.source).toBe('malaysiakini');
  });

  it('lowercases ALL-CAPS source', () => {
    const r = normalizeMention(make({ source: 'TWITTER' }));
    expect(r.source).toBe('twitter');
  });
});

// ---------------------------------------------------------------------------
// Engagement parsing
// ---------------------------------------------------------------------------
describe('engagement parsing', () => {
  it('parses string with comma', () => {
    const r = normalizeMention(make({ engagement: '1,204' }));
    expect(r.engagement).toBe(1204);
  });

  it('parses string with multiple commas', () => {
    const r = normalizeMention(make({ engagement: '3,402' }));
    expect(r.engagement).toBe(3402);
  });

  it('keeps plain number as-is', () => {
    const r = normalizeMention(make({ engagement: 412 }));
    expect(r.engagement).toBe(412);
  });

  it('defaults null to 0', () => {
    const r = normalizeMention(make({ engagement: null }));
    expect(r.engagement).toBe(0);
  });

  it('defaults undefined to 0', () => {
    const r = normalizeMention(make({ engagement: undefined }));
    expect(r.engagement).toBe(0);
  });

  it('defaults non-numeric string to 0', () => {
    const r = normalizeMention(make({ engagement: 'N/A' }));
    expect(r.engagement).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTML sanitisation
// ---------------------------------------------------------------------------
describe('HTML sanitisation', () => {
  it('strips <p> tags, keeps text', () => {
    const r = normalizeMention(make({ content: '<p>Hello world.</p>' }));
    expect(r.content).toBe('Hello world.');
  });

  it('strips <div> wrapper', () => {
    const r = normalizeMention(make({
      content: '<div class="article">Works on MRT3.</div>',
    }));
    expect(r.content).toBe('Works on MRT3.');
  });

  it('strips dangerous <script> tag — XSS prevention', () => {
    const r = normalizeMention(make({
      content: '<p>Safe text.</p><script>alert(1)</script>',
    }));
    expect(r.content).not.toContain('<script>');
    expect(r.content).not.toContain('alert(1)');
    expect(r.content).toContain('Safe text.');
  });

  it('decodes HTML entities like &quot; and &nbsp;', () => {
    const r = normalizeMention(make({
      content: '<p>citing &quot;balanced&quot; risks and&nbsp;growth.</p>',
    }));
    expect(r.content).toContain('"balanced"');
    expect(r.content).not.toContain('&quot;');
  });

  it('preserves plain text content unchanged', () => {
    const r = normalizeMention(make({ content: 'Just plain text.' }));
    expect(r.content).toBe('Just plain text.');
  });
});

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------
describe('date parsing', () => {
  it('parses ISO 8601 UTC', () => {
    const r = normalizeMention(make({ published_at: '2026-08-10T08:15:00Z' }));
    expect(r.published_at).toBe('2026-08-10T08:15:00.000Z');
  });

  it('parses ISO 8601 with positive timezone offset', () => {
    const r = normalizeMention(make({ published_at: '2026-08-11T14:02:33+08:00' }));
    // +08:00 → subtract 8h → 06:02:33 UTC
    expect(r.published_at).toBe('2026-08-11T06:02:33.000Z');
  });

  it('parses "YYYY-MM-DD HH:mm:ss" format', () => {
    const r = normalizeMention(make({ published_at: '2026-08-10 08:20:00' }));
    expect(r.published_at).not.toBeNull();
    expect(r.published_at).toMatch(/^2026-08-10/);
  });

  it('parses DD/MM/YYYY format', () => {
    const r = normalizeMention(make({ published_at: '11/08/2026' }));
    expect(r.published_at).toBe('2026-08-11T00:00:00.000Z');
  });

  it('parses Unix timestamp (number)', () => {
    // 1786435200 = 2026-08-11T08:00:00Z
    const r = normalizeMention(make({ published_at: 1786435200 }));
    expect(r.published_at).toBe('2026-08-11T08:00:00.000Z');
  });

  it('returns null for null input', () => {
    const r = normalizeMention(make({ published_at: null }));
    expect(r.published_at).toBeNull();
  });

  it('returns null for undefined input', () => {
    const r = normalizeMention(make({ published_at: undefined }));
    expect(r.published_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Title coercion
// ---------------------------------------------------------------------------
describe('title coercion', () => {
  it('converts empty string title to null', () => {
    const r = normalizeMention(make({ title: '' }));
    expect(r.title).toBeNull();
  });

  it('keeps null title as null', () => {
    const r = normalizeMention(make({ title: null }));
    expect(r.title).toBeNull();
  });

  it('trims whitespace from title', () => {
    const r = normalizeMention(make({ title: '  Hello  ' }));
    expect(r.title).toBe('Hello');
  });

  it('keeps valid title unchanged', () => {
    const r = normalizeMention(make({ title: 'Bank Negara holds OPR at 2.75%' }));
    expect(r.title).toBe('Bank Negara holds OPR at 2.75%');
  });
});

// ---------------------------------------------------------------------------
// Full record — seed data spot checks
// ---------------------------------------------------------------------------
describe('full seed record normalisation', () => {
  it('normalises str-99120 correctly', () => {
    const raw: RawMention = {
      external_id: 'str-99120',
      source: 'The Star',
      title: 'Ringgit strengthens against US dollar in early trade',
      content: '<p>The ringgit opened higher against the greenback on Monday, buoyed by&nbsp;improved sentiment.</p>',
      url: 'https://www.thestar.com.my/business/2026/08/10/ringgit-strengthens',
      author: 'Aisyah Rahman',
      published_at: '2026-08-10T08:15:00Z',
      engagement: 412,
    };
    const r = normalizeMention(raw);
    expect(r.source).toBe('the star');
    expect(r.content).not.toContain('<p>');
    expect(r.content).toContain('improved sentiment');
    expect(r.engagement).toBe(412);
    expect(r.published_at).toBe('2026-08-10T08:15:00.000Z');
  });

  it('normalises fb_772341 with comma engagement and offset date', () => {
    const raw: RawMention = {
      external_id: 'fb_772341',
      source: 'Facebook',
      title: '',
      content: 'OPR kekal 2.75% — apa maksudnya untuk pinjaman rumah anda?',
      url: 'https://facebook.com/finmy/posts/772341',
      author: 'Finance MY',
      published_at: '2026-08-12T23:45:10+08:00',
      engagement: '3,402',
    };
    const r = normalizeMention(raw);
    expect(r.source).toBe('facebook');
    expect(r.title).toBeNull();
    expect(r.engagement).toBe(3402);
    expect(r.published_at).toBe('2026-08-12T15:45:10.000Z');
  });
});
