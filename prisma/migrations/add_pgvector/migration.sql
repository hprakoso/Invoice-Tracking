CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS invoice_embeddings (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  chunk_text  TEXT,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_embeddings_embedding_idx
  ON invoice_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
