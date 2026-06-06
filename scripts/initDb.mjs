/**
 * Creates the optimized pgvector schema.
 * Loads .env manually (no dotenv dep needed).
 *   npm run db:init
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

// minimal .env loader
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const DIM = parseInt(process.env.EMBEDDING_DIM || "1536", 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  embedding_bits bit(${DIM}) GENERATED ALWAYS AS (binary_quantize(embedding)) STORED,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (fillfactor = 90);

CREATE TABLE IF NOT EXISTS query_cache (
  question_hash TEXT PRIMARY KEY,
  question      TEXT NOT NULL,
  embedding     vector(${DIM}) NOT NULL,
  hits          INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_halfvec_hnsw_idx
  ON chunks USING hnsw ((embedding::halfvec(${DIM})) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 80);

CREATE INDEX IF NOT EXISTS chunks_embedding_bits_hnsw_idx
  ON chunks USING hnsw (embedding_bits bit_hamming_ops)
  WITH (m = 16, ef_construction = 80);

CREATE INDEX IF NOT EXISTS chunks_fts_gin_idx ON chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);
CREATE INDEX IF NOT EXISTS chunks_metadata_gin_idx ON chunks USING gin (metadata jsonb_path_ops);

ALTER TABLE chunks ALTER COLUMN embedding SET STORAGE EXTERNAL;
ALTER TABLE chunks SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
ALTER TABLE chunks ALTER COLUMN document_id SET STATISTICS 500;
`;

const client = await pool.connect();
try {
  await client.query(`SET maintenance_work_mem = '512MB'`);
  await client.query(`SET max_parallel_maintenance_workers = 4`);
  await client.query(sql);
  console.log(`✅ Optimized schema ready (dim=${DIM})`);
} finally {
  client.release();
  await pool.end();
}
