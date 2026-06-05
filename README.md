# pgvector RAG API — Optimized

Node.js + Express + PostgreSQL (**pgvector ≥ 0.7**) + OpenAI, tuned with advanced Postgres features.

## Optimization summary

| Layer | Technique | Win |
|---|---|---|
| Storage | `halfvec` expression HNSW index | ~50% smaller index, faster build/scan, ~no recall loss |
| Storage | `bit(N)` binary quantization (GENERATED column) | 192 bytes vs 6 KB per vector for coarse search |
| Storage | `SET STORAGE EXTERNAL` on embedding | skips TOAST compression CPU on every read |
| Retrieval | **Hybrid search**: HNSW + GIN FTS fused via **RRF** | catches names/exact terms embeddings miss |
| Retrieval | **Two-stage**: Hamming prefilter (10x oversample) → exact cosine re-rank | scales to millions of chunks |
| Retrieval | `SET LOCAL hnsw.ef_search` + `hnsw.iterative_scan = relaxed_order` | per-query recall knob; filtered queries fill LIMIT |
| Ingest | Single `INSERT ... SELECT FROM UNNEST(arrays)` | 1 round trip for N chunks instead of N |
| Caching | `query_cache` table (sha256 → vector, hit counters) | repeated questions skip the OpenAI embeddings call |
| Maintenance | aggressive autovacuum scale factors, `fillfactor=90`, column statistics 500 | HNSW scans avoid dead tuples; better plans |
| Index build | `maintenance_work_mem=512MB`, parallel maintenance workers | much faster HNSW creation |
| FTS | `GENERATED ALWAYS AS to_tsvector(...)` + GIN + `websearch_to_tsquery` | zero-maintenance lexical leg |

## Setup

```bash
docker run -d --name ragdb -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ragdb \
  pgvector/pgvector:pg16

npm install
cp .env.example .env   # set OPENAI_API_KEY
npm run db:init
npm start
```

## API

### POST /api/documents — ingest (UNNEST bulk insert)

```bash
curl -X POST localhost:3000/api/documents -H "Content-Type: application/json" \
  -d '{"title":"Matheism Intro","text":"All existence is patterned or random...","metadata":{"lang":"en"}}'
```

### POST /api/query — RAG answer

```bash
curl -X POST localhost:3000/api/query -H "Content-Type: application/json" \
  -d '{"question":"What is the core claim?","mode":"hybrid"}'
```

`mode`:
- `hybrid` (default) — semantic + full-text, RRF fusion. Best answer quality.
- `twostage` — binary Hamming prefilter → exact re-rank. Best at large scale.
- `semantic` — pure halfvec HNSW. Fastest single-leg.

Response includes `stats`: `{ mode, retrievalMs, totalMs, embeddingCached }` and per-source `similarity` / `rrfScore`.

### GET /api/stats — ops visibility

Index sizes + scan counts, query-cache hit totals, live/dead tuples, last autovacuum.

## Tuning notes

- **`hnsw.ef_search`** (env `HNSW_EF_SEARCH`, default 80): higher = better recall, slower. Set per workload; applied with `SET LOCAL` so it never leaks across pooled connections.
- **`hnsw.iterative_scan = relaxed_order`** (pgvector 0.8+): when a `WHERE document_id = X` filter discards ANN candidates, Postgres keeps scanning the graph instead of returning fewer than LIMIT rows.
- **Recall check**: compare `mode=semantic` vs exact scan (`SET enable_indexscan=off` on a session) on a sample of queries before raising `ef_search`.
- **Scaling past ~10M chunks**: partition `chunks` by `document_id` hash or tenant, one HNSW per partition; or move coarse stage entirely to the bit index.
- Server-level (postgresql.conf): `shared_buffers` 25% RAM, `effective_cache_size` 75%, `work_mem` 64MB for the RRF CTEs, `jit = off` for short OLTP-style queries.

## Files

- `src/initDb.js` — schema, generated columns, all three indexes, storage/autovacuum tuning
- `src/server.js` — ingest, three retrieval modes, embedding cache, stats endpoint
- `src/embeddings.js` — chunking + batched OpenAI embeddings

## Authentication (JWT)

All `/api/*` routes require `Authorization: Bearer <jwt>`. Scope model:

| Route | Required scope |
|---|---|
| `POST /api/documents` (ingest) | `rag:write` |
| `DELETE /api/documents/:id` | `rag:write` |
| `POST /api/query`, `GET /api/documents`, `GET /api/stats` | `rag:read` |
| `GET /health` | none |

Verification (`src/auth.js`):
- **Algorithm pinned** via `algorithms: [JWT_ALG]` — blocks `alg:none` and HS/RS confusion attacks
- `iss` + `aud` + `exp` enforced, 5s clock tolerance
- 401 (`WWW-Authenticate` header) for missing/invalid/expired tokens; **403** for valid token without the required scope
- `req.auth = { sub, scope, jti, claims }` available downstream for per-tenant filtering/audit

Modes:
- **HS256** (default): set `JWT_SECRET` (32+ random chars)
- **RS256**: `JWT_ALG=RS256` + `JWT_PUBLIC_KEY` (PEM, `\n`-escaped) — verify-only; sign with your private key / IdP

Mint test tokens:

```bash
npm run token -- ingest-service "rag:read rag:write" 24h
curl -X POST localhost:3000/api/documents \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"title":"...","text":"..."}'
```

Tested: missing token → 401, malformed → 401, expired → 401, read-only scope on ingest → 403, write scope → 200.
