import { Router, Request, Response } from 'express';
import pool from '../db';
import { normalizeMention, RawMention } from '../normalize';

const router = Router();

// POST /internal/mentions/bulk
router.post('/bulk', async (req: Request, res: Response) => {
  const body = req.body;

  if (!Array.isArray(body) || body.length === 0) {
    res.status(400).json({ error: 'Request body must be a non-empty JSON array.' });
    return;
  }

  const normalized = (body as RawMention[]).map(normalizeMention);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let updated  = 0;

    for (const m of normalized) {
      const result = await client.query<{ xmax: string }>(
        `INSERT INTO mentions (external_id, source, title, content, url, author, published_at, engagement)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (external_id) DO UPDATE
           SET engagement = GREATEST(mentions.engagement, EXCLUDED.engagement)
         RETURNING xmax`,
        [m.external_id, m.source, m.title, m.content, m.url, m.author, m.published_at, m.engagement]
      );

      // xmax = 0 means INSERT; non-zero means UPDATE
      if (result.rows[0].xmax === '0') {
        inserted++;
      } else {
        updated++;
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ inserted, updated, total: normalized.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk ingest error:', err);
    res.status(500).json({ error: 'Internal server error during bulk ingest.' });
  } finally {
    client.release();
  }
});

export default router;
