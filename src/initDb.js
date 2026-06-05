import { pool } from "./db.js";
import dotenv from "dotenv";
dotenv.config();

const DIM = parseInt(process.env.EMBEDDING_DIM || "1536", 10);

const sql = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Tables
-- ============================================================
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

  -- Full-precision vector (source of truth, used for exact re-ranking)
  embedding   vector(${DIM}) NOT NULL,

  -- Binary quantization, auto-derived. 1536 bits = 192 bytes vs 6KB float32.
  -- Used as a cheap Hamming-distance prefilter in two-stage search.
  embedding_bits bit(${DIM}) GENERATED ALWAYS AS (binary_quantize(embedding)) STORED,

  -- Full-text search vector, auto-derived. Powers the lexical leg of hybrid search.
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- HNSW pages churn heavily on update; lower fillfactor reduces page splits
WITH (fillfactor = 90);

CREATE TABLE IF NOT EXISTS query_cache (
  question_hash TEXT PRIMARY KEY,         -- sha256 of normalized question
  question      TEXT NOT NULL,
  embedding     vector(${DIM}) NOT NULL,
  hits          INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- 1) ANN index on HALF-PRECISION expression: ~50% smaller index,
--    faster build & scan, negligible recall loss at 1536 dims.
--    Queries must use the same expression to hit this index.
CREATE INDEX IF NOT EXISTS chunks_embedding_halfvec_hnsw_idx
  ON chunks USING hnsw ((embedding::halfvec(${DIM})) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 80);

-- 2) Hamming-distance index on binary quantization for the coarse
--    first stage of two-stage retrieval (oversample -> exact re-rank).
CREATE INDEX IF NOT EXISTS chunks_embedding_bits_hnsw_idx
  ON chunks USING hnsw (embedding_bits bit_hamming_ops)
  WITH (m = 16, ef_construction = 80);

-- 3) GIN for the lexical leg of hybrid search
CREATE INDEX IF NOT EXISTS chunks_fts_gin_idx ON chunks USING gin (fts);

-- 4) Filter support
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);
CREATE INDEX IF NOT EXISTS chunks_metadata_gin_idx ON chunks USING gin (metadata jsonb_path_ops);

-- ============================================================
-- Table-level tuning
-- ============================================================

-- Embeddings are large -> rows TOAST. EXTERNAL avoids de/compression
-- CPU on every vector read (vectors don't compress well anyway).
ALTER TABLE chunks ALTER COLUMN embedding SET STORAGE EXTERNAL;

-- Vacuum aggressively so HNSW scans don't wade through dead tuples
ALTER TABLE chunks SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- Planner statistics on hot filter columns
ALTER TABLE chunks ALTER COLUMN document_id SET STATISTICS 500;
`;

async function main() {
  const client = await pool.connect();
  try {
    // Speed up HNSW build for this session (safe, session-local)
    await client.query(`SET maintenance_work_mem = '512MB'`);
    await client.query(`SET max_parallel_maintenance_workers = 4`);
    await client.query(sql);
    console.log(`✅ Optimized schema ready (dim=${DIM}, halfvec HNSW + bit HNSW + GIN FTS)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("DB init failed:", e);
  process.exit(1);
});
