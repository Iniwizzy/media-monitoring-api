import sanitizeHtml from 'sanitize-html';

export interface RawMention {
  external_id:  string;
  source:       string;
  title?:       string | null;
  content:      string;
  url:          string;
  author?:      string | null;
  published_at?: string | number | null;
  engagement?:  string | number | null;
}

export interface NormalizedMention {
  external_id:  string;
  source:       string;
  title:        string | null;
  content:      string;
  url:          string;
  author:       string | null;
  published_at: string | null; // ISO UTC or null
  engagement:   number;
}

// 1. Source: lowercase + trim
function normalizeSource(source: string): string {
  return source.toLowerCase().trim();
}

// 2. Engagement: strip commas, cast to int
function normalizeEngagement(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/,/g, '').trim();
  const parsed  = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

// 3. HTML sanitize: strip all tags (including dangerous ones like <script>)
function sanitizeContent(content: string): string {
  return sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });
}

// 4. Date parsing: ISO, "YYYY-MM-DD HH:mm:ss", "DD/MM/YYYY", Unix timestamp, null
function normalizeDate(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;

  // Unix timestamp (number)
  if (typeof raw === 'number') {
    return new Date(raw * 1000).toISOString();
  }

  const str = String(raw).trim();
  if (!str) return null;

  // DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Attempt generic parse (handles ISO 8601 with offsets, "YYYY-MM-DD HH:mm:ss", etc.)
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeMention(raw: RawMention): NormalizedMention {
  return {
    external_id:  raw.external_id,
    source:       normalizeSource(raw.source),
    title:        raw.title?.trim() || null,
    content:      sanitizeContent(raw.content ?? ''),
    url:          raw.url,
    author:       raw.author?.trim() || null,
    published_at: normalizeDate(raw.published_at),
    engagement:   normalizeEngagement(raw.engagement),
  };
}
