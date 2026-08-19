/**
 * Integration tests for POST /internal/mentions/bulk
 *
 * These tests run against a real PostgreSQL database.
 * Set DB_* environment variables (or .env) before running.
 *
 * Run: npm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../index';
import pool from '../db';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Ensure search_vector column exists (migration must have been run)
  await pool.query(`SELECT search_vector FROM mentions LIMIT 0`);
});

beforeEach(async () => {
  await pool.query('DELETE FROM mentions');
});

afterAll(async () => {
  await pool.query('DELETE FROM mentions');
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mention(overrides: Record<string, unknown> = {}) {
  return {
    external_id: 'test-001',
    source: 'The Star',
    title: 'Test Article',
    content: 'Test content.',
    url: 'https://example.com/1',
    author: 'Author',
    published_at: '2026-08-10T08:00:00Z',
    engagement: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bulk ingest — basic
// ---------------------------------------------------------------------------

describe('POST /internal/mentions/bulk', () => {
  it('returns 400 for non-array body', async () => {
    const res = await request(app)
      .post('/internal/mentions/bulk')
      .send({ not: 'an array' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty array', async () => {
    const res = await request(app)
      .post('/internal/mentions/bulk')
      .send([]);
    expect(res.status).toBe(400);
  });

  it('inserts a single record and returns inserted=1', async () => {
    const res = await request(app)
      .post('/internal/mentions/bulk')
      .send([mention()]);

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.total).toBe(1);
  });

  it('inserts multiple distinct records', async () => {
    const res = await request(app)
      .post('/internal/mentions/bulk')
      .send([
        mention({ external_id: 'test-001' }),
        mention({ external_id: 'test-002' }),
        mention({ external_id: 'test-003' }),
      ]);

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(3);
    expect(res.body.updated).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Idempotency — the riskiest logic
  // -------------------------------------------------------------------------

  it('is idempotent — posting same payload twice produces one row', async () => {
    const payload = [mention()];

    await request(app).post('/internal/mentions/bulk').send(payload);
    const res2 = await request(app).post('/internal/mentions/bulk').send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.updated).toBe(1);
    expect(res2.body.inserted).toBe(0);

    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].count).toBe('1');
  });

  it('UPSERT keeps GREATEST engagement — lower value does not overwrite higher', async () => {
    // First ingest: engagement 412
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ engagement: 412 })]);

    // Second ingest: same external_id, higher engagement 415
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ engagement: 415 })]);

    const { rows } = await pool.query(
      `SELECT engagement FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].engagement).toBe(415);
  });

  it('UPSERT does NOT downgrade engagement when new value is lower', async () => {
    // First ingest: engagement 500
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ engagement: 500 })]);

    // Second ingest: same external_id, lower engagement 100
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ engagement: 100 })]);

    const { rows } = await pool.query(
      `SELECT engagement FROM mentions WHERE external_id = 'test-001'`
    );
    // Must stay at 500
    expect(rows[0].engagement).toBe(500);
  });

  it('handles duplicate external_id within the same payload (in-batch dedup)', async () => {
    // Same external_id twice in one request — seed data has this (str-99120)
    const res = await request(app)
      .post('/internal/mentions/bulk')
      .send([
        mention({ engagement: 412 }),
        mention({ engagement: 415 }),
      ]);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);

    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count, MAX(engagement) AS max_eng
       FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].count).toBe('1');
    expect(rows[0].max_eng).toBe(415);
  });

  // -------------------------------------------------------------------------
  // Normalisation applied at ingest
  // -------------------------------------------------------------------------

  it('normalises source to lowercase', async () => {
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ source: 'TWITTER' })]);

    const { rows } = await pool.query(
      `SELECT source FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].source).toBe('twitter');
  });

  it('strips script tags from content before storing', async () => {
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({
        content: '<p>Safe text.</p><script>alert(1)</script>',
      })]);

    const { rows } = await pool.query(
      `SELECT content FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].content).not.toContain('<script>');
    expect(rows[0].content).not.toContain('alert(1)');
    expect(rows[0].content).toContain('Safe text.');
  });

  it('parses engagement string with comma', async () => {
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ engagement: '3,402' })]);

    const { rows } = await pool.query(
      `SELECT engagement FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].engagement).toBe(3402);
  });

  it('stores null for unparseable published_at', async () => {
    await request(app)
      .post('/internal/mentions/bulk')
      .send([mention({ published_at: null })]);

    const { rows } = await pool.query(
      `SELECT published_at FROM mentions WHERE external_id = 'test-001'`
    );
    expect(rows[0].published_at).toBeNull();
  });
});
