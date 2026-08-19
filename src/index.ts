import express from 'express';
import path from 'path';
import mentionsBulkRouter from './routes/mentions.bulk';
import mentionsRouter     from './routes/mentions';

const app = express();

app.use(express.json({ limit: '10mb' }));

// Dashboard — serve public/index.html
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/internal/mentions', mentionsBulkRouter);
app.use('/mentions',          mentionsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

export default app;

// Only start listening when run directly, not when imported by tests
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
