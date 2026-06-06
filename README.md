# Knowledge Vault — RAG Platform
Chat with your own knowledge base. Documents are chunked, embedded, and indexed in PostgreSQL with pgvector; questions are answered by an LLM grounded strictly in retrieved context, with cited sources and similarity scores. Includes a secret-key admin panel for managing the corpus and a JWT-protected API for external services. Hybrid retrieval (semantic + full-text with RRF fusion) tuned for production scale.


```
app/
  page.jsx                      # Chat UI (RAG, mode switcher, sources, stats)
  admin/page.jsx                # Admin panel (secret-key gated ingest + doc management)
  api/
    query/route.js              # EXTERNAL: POST RAG answer        [JWT rag:read]
    documents/route.js          # EXTERNAL: POST ingest, GET list  [JWT rag:write / rag:read]
    documents/[id]/route.js     # EXTERNAL: DELETE                 [JWT rag:write]
    stats/route.js              # EXTERNAL: index/cache/vacuum     [JWT rag:read]
    chat/route.js               # INTERNAL: UI chat (same-origin)
    admin/ingest/route.js       # INTERNAL: admin add data         [x-admin-key]
    admin/documents/route.js    # INTERNAL: admin list/delete      [x-admin-key]
lib/
  rag.js                        # service layer: ingest, hybrid/twostage/semantic retrieval,
                                #   RRF fusion, query-embedding cache, answer generation
  auth.js                       # JWT verify (alg pinned), timing-safe admin key, token mint
  db.js                         # pg pool singleton (survives Next dev hot-reload)
  embeddings.js                 # chunking + batched OpenAI embeddings
scripts/
  initDb.mjs                    # optimized schema: halfvec HNSW, bit HNSW, GIN FTS,
                                #   generated columns, autovacuum/storage tuning
  issueToken.mjs                # mint JWTs for external API consumers
```

## Postgres optimizations (unchanged from v2)

halfvec expression HNSW (~50% smaller index) · binary quantization `bit(N)` GENERATED column + Hamming HNSW for two-stage retrieval · generated tsvector + GIN for the hybrid-search lexical leg · RRF fusion · `SET LOCAL hnsw.ef_search` + `iterative_scan=relaxed_order` per query · UNNEST single-round-trip bulk insert · query-embedding cache table · `STORAGE EXTERNAL` on vectors · aggressive autovacuum + fillfactor 90.

## Setup

```bash
docker run -d --name ragdb -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ragdb pgvector/pgvector:pg16

npm install
cp .env.example .env      # set OPENAI_API_KEY, JWT_SECRET, ADMIN_SECRET
npm run db:init
npm run dev               # http://localhost:3000
```

- `/` — chat with the knowledge base
- `/admin` — enter ADMIN_SECRET, add documents, manage the corpus

## Security model

Two independent gates, both server-side:

1. **External API** (`/api/query`, `/api/documents`, `/api/stats`) — Bearer JWT.
   Algorithm pinned (HS256 or RS256 via env), `iss`/`aud`/`exp` enforced,
   scopes `rag:read` / `rag:write`. 401 invalid token, 403 wrong scope.
   Mint: `npm run token -- svc "rag:read rag:write" 24h`

2. **Admin panel** — `x-admin-key` header checked with `crypto.timingSafeEqual`
   against **ADMIN_SECRET in .env**. Rotate by changing the env value and
   restarting; nothing is stored in the browser or DB. UI routes call the
   service layer directly — no internal HTTP hop, no token in the page.

Verified live: no/garbage/expired token → 401; read-scope on write route → 403;
valid scope → passes to body validation; wrong admin key → 401; correct key → gate opens.

## External API examples

```bash
TOKEN=$(npm run -s token -- svc "rag:read rag:write" 1h | sed -n 3p)

curl -X POST localhost:3000/api/documents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"PRD overview","text":"All existence is patterned or random..."}'

curl -X POST localhost:3000/api/query \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"What is the core claim?","mode":"hybrid"}'
```
