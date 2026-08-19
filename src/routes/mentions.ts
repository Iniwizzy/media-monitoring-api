import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET /mentions
router.get('/', async (req: Request, res: Response) => {
  const { q, source, from, to } = req.query as Record<string, string | undefined>;
  const limit  = Math.min(parseInt((req.query.limit  as string) ?? '20', 10), 100);
  const offset = Math.max(parseInt((req.query.offset as string) ?? '0',  10), 0);

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (q) {
    params.push(q);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }

  if (source) {
    params.push(source.toLowerCase().trim());
    conditions.push(`source = $${params.length}`);
  }

  if (from) {
    params.push(from);
    conditions.push(`published_at >= $${params.length}`);
  }

  if (to) {
    params.push(to);
    conditions.push(`published_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const limitClause  = `LIMIT $${params.length - 1}`;
  const offsetClause = `OFFSET $${params.length}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM mentions ${where}`,
      params.slice(0, params.length - 2)
    );

    const dataResult = await pool.query(
      `SELECT id, external_id, source, title, content, url, author, published_at, engagement
       FROM mentions
       ${where}
       ORDER BY published_at DESC NULLS LAST, id DESC
       ${limitClause} ${offsetClause}`,
      params
    );

    res.json({
      total:  parseInt(countResult.rows[0].total, 10),
      limit,
      offset,
      data:   dataResult.rows,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal server error during search.' });
  }
});

// GET /mentions/stats
router.get('/stats', async (req: Request, res: Response) => {
  const { group_by } = req.query as Record<string, string | undefined>;

  if (group_by === 'source') {
    try {
      const result = await pool.query(
        `SELECT source, COUNT(*) AS count
         FROM mentions
         GROUP BY source
         ORDER BY count DESC`
      );
      res.json({ group_by: 'source', data: result.rows });
    } catch (err) {
      console.error('Stats error:', err);
      res.status(500).json({ error: 'Internal server error during stats.' });
    }
    return;
  }

  if (group_by === 'day') {
    try {
      const result = await pool.query(
        `SELECT DATE(published_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS count
         FROM mentions
         WHERE published_at IS NOT NULL
         GROUP BY day
         ORDER BY day DESC`
      );
      res.json({ group_by: 'day', data: result.rows });
    } catch (err) {
      console.error('Stats error:', err);
      res.status(500).json({ error: 'Internal server error during stats.' });
    }
    return;
  }

  res.status(400).json({ error: 'group_by must be "source" or "day".' });
});

export default router;
