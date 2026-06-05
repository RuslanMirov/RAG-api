import { pool } from "./db.js";
import dotenv from "dotenv";
dotenv.config();

const DIM = parseInt(process.env.EMBEDDING_DIM || "1536", 10);

const sql = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(${DIM}) NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for cosine similarity (pgvector >= 0.5.0)
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`✅ Schema ready (vector dim = ${DIM})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("DB init failed:", e);
  process.exit(1);
});
