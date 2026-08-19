# Media Monitoring Backend

A backend service for ingesting, storing, and querying media mentions from various sources.

## Stack

- **Runtime:** Node.js v22 + TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL
- **Key libraries:** `pg` (raw SQL, no ORM), `sanitize-html`

---

## How to Run

### Prerequisites

- Node.js ≥ 18
- PostgreSQL running locally (or remote)

### 1. Clone & install

```bash
git clone <repo-url>
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=media_monitoring
DB_USER=postgres
DB_PASSWORD=your_password_here
PORT=3000
```

### 3. Create the database

```bash
psql -U postgres -c "CREATE DATABASE media_monitoring;"
```

### 4. Run the migration

```bash
psql -U postgres -d media_monitoring -f migrations/001_create_mentions.sql
```

### 5. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm run build && npm start
```

Server starts at `http://localhost:3000`.

### 6. Seed with sample data

```bash
curl -X POST http://localhost:3000/internal/mentions/bulk \
  -H "Content-Type: application/json" \
  -d @seed_mentions.json
```

---

## API Endpoints

### `POST /internal/mentions/bulk`

Accepts a JSON array of mention objects. Normalises and upserts into PostgreSQL.

**Request body:** JSON array (see `seed_mentions.json` for shape)

**Response:**
```json
{ "inserted": 13, "updated": 2, "total": 15 }
```

This endpoint is **idempotent** — posting the same payload twice produces the same database state.

---

### `GET /mentions`

Search and filter mentions.

| Query param | Type | Description |
|---|---|---|
| `q` | string | Full-text keyword search on title + content |
| `source` | string | Exact match on source (case-insensitive) |
| `from` | ISO date | Lower bound on `published_at` |
| `to` | ISO date | Upper bound on `published_at` |
| `limit` | integer | Results per page (default 20, max 100) |
| `offset` | integer | Pagination offset (default 0) |

**Sort order:** `published_at DESC NULLS LAST, id DESC` — stable and deterministic.

**Example:**
```
GET /mentions?q=banjir&source=twitter&from=2026-08-13&limit=10
```

**Response:**
```json
{
  "total": 2,
  "limit": 10,
  "offset": 0,
  "data": [ { "id": 1, "external_id": "...", ... } ]
}
```

---

### `GET /mentions/stats`

Returns aggregated counts for dashboard charts.

| `group_by` value | Description |
|---|---|
| `source` | Count of mentions per source |
| `day` | Count of mentions per day (UTC, excludes null `published_at`) |

**Examples:**
```
GET /mentions/stats?group_by=source
GET /mentions/stats?group_by=day
```

**Response (`group_by=source`):**
```json
{
  "group_by": "source",
  "data": [
    { "source": "the star", "count": "4" },
    { "source": "twitter", "count": "2" }
  ]
}
```

---

## Schema Design

```sql
CREATE TABLE mentions (
  id           SERIAL PRIMARY KEY,
  external_id  TEXT        NOT NULL,  -- unique ID from source system
  source       TEXT        NOT NULL,  -- normalised to lowercase
  title        TEXT,                  -- nullable (social posts often have none)
  content      TEXT        NOT NULL,  -- HTML-stripped plain text
  url          TEXT        NOT NULL,
  author       TEXT,                  -- nullable
  published_at TIMESTAMPTZ,           -- nullable; stored in UTC
  engagement   INTEGER     NOT NULL DEFAULT 0,
  search_vector tsvector   GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))
  ) STORED
);
```

**Indexes:**
- `UNIQUE` on `external_id` — enables upsert and duplicate prevention
- `INDEX` on `source` — optimises `group_by=source` and source filter
- `INDEX` on `published_at` — optimises date range queries and `group_by=day`
- `GIN` on `search_vector` — enables fast full-text search via `@@` operator

**Why no ORM:** Raw SQL keeps the schema explicit and reviewable. There is no hidden mapping layer generating unexpected queries or migrations.

**Why `TIMESTAMPTZ` and not `TEXT`:** Storing timestamps as timezone-aware values lets PostgreSQL handle UTC normalisation and date arithmetic correctly. All incoming dates are parsed to UTC ISO 8601 before insert.

---

## Duplicate Detection — Reasoning

**Rule:** A record is a duplicate if it shares the same `external_id`.

**Why `external_id` and not URL or content hash?**

The seed data contains two records with `external_id: "str-99120"` — same article, same URL, but engagement differs (412 vs 415). This is a **retry scenario**: the upstream pipeline fetched the same article twice with a slightly updated engagement count. The correct behaviour is to keep one row and take the higher engagement value, which is exactly what `ON CONFLICT (external_id) DO UPDATE SET engagement = GREATEST(...)` does.

URL-based deduplication would fail here too, since the same URL appears under two different `external_id` values (`str-99120` and `nst-40021`) — these represent the same real-world article picked up by two different scrapers, but they are legitimately different records in our system (different source, different metadata, different engagement).

Content hashing was considered but rejected: minor formatting differences (HTML vs plain text, capitalisation) would generate different hashes for what is semantically the same article, making the rule brittle.

**`external_id` is the source system's own deduplication key.** Trusting it is the most defensible choice given the data.

---

## Normalisation Pipeline

Each incoming record passes through the following transformations before insert:

| Field | Problem in seed data | Fix |
|---|---|---|
| `source` | Mixed case, trailing spaces (`"malaysiakini "`, `"TWITTER"`) | `toLowerCase().trim()` |
| `engagement` | Strings with commas (`"1,204"`, `"3,402"`) | Strip commas, `parseInt` |
| `content` | Raw HTML, potential XSS (`<script>alert(1)</script>`) | `sanitize-html` with `allowedTags: []` — strips everything |
| `published_at` | ISO 8601, `"YYYY-MM-DD HH:mm:ss"`, `"DD/MM/YYYY"`, Unix timestamp (number), `null` | Custom parser → UTC ISO string or `null` |
| `title` | Empty string `""` | Coerced to `null` |

---

## Assumptions

- `external_id` is treated as the authoritative identifier from the upstream source system.
- An empty string `title: ""` is treated the same as `null` — stored as `NULL`.
- Engagement values that cannot be parsed (non-numeric) default to `0`.
- `published_at: null` is valid and stored as `NULL`. These records are excluded from `group_by=day` stats but included in all other queries.
- Source names are normalised to lowercase at ingest time. The `source` filter on `GET /mentions` also normalises the query param, so `?source=Twitter` and `?source=twitter` return the same results.
- The `content` field is required. Records missing it would fail validation (Express returns 500; in production this should be a 422 with field-level errors).

---

## Trade-offs

| Decision | Trade-off accepted |
|---|---|
| Raw `pg` queries, no ORM | More verbose insert/select code, but schema stays explicit and there are no surprise migrations or N+1 queries hidden behind abstractions |
| `sanitize-html` strips **all** HTML tags | Some sources use `<b>` or `<em>` for emphasis; this is lost. Acceptable for a monitoring system where plain text is sufficient for search and display |
| Full-text search uses `plainto_tsquery` | Does not support phrase search or fuzzy matching. Sufficient for keyword filtering; would upgrade to `websearch_to_tsquery` or a dedicated search engine for production |
| `search_vector` as a generated column | Computed at write time, so search is fast at read time. Cost: slightly slower inserts and more disk space |
| Single `mentions` table | No source-specific tables or normalised author/source lookup tables. Simple now; would add a `sources` dimension table if filtering/grouping requirements grew more complex |
| No request validation library | Incoming payload shape is trusted after the `Array.isArray` check. A production service would use `zod` or `joi` for per-field validation and 422 responses |

---

## Time Spent

| Session | Activities |
|---|---|
| Session 1 (~2 h) | Read brief, designed schema, set up project structure, wrote migration |
| Session 2 (~2 h) | Wrote normalization pipeline, bulk ingest endpoint, upsert logic |
| Session 3 (~1.5 h) | Search endpoint, stats endpoint, pagination, full-text search |
| Session 4 (~1 h) | Tests, README, cleanup |

**Total: ~6.5 hours across 4 sessions**

---

## With Another Week, I Would…

1. **Input validation** — use `zod` to validate each record in the bulk payload and return 422 with per-field errors instead of a 500
2. **Proper error taxonomy** — structured error responses with error codes, not just message strings
3. **Source normalisation table** — a `sources` table mapping raw source strings to canonical names, so `"The Star"`, `"thestar"`, and `"the-star"` all resolve to the same entity
4. **Pagination with cursors** — offset pagination degrades at scale; keyset pagination (`WHERE (published_at, id) < ($1, $2)`) is more stable
5. **Rate limiting & request size cap** on the bulk endpoint
6. **Structured logging** — replace `console.error` with a logger (e.g., `pino`) that emits JSON for log aggregation
7. **Docker Compose** — one command to spin up Postgres + the service for reviewers
8. **More tests** — especially for edge cases in date parsing and the UPSERT engagement logic
