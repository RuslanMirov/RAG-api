# pgvector RAG API

Node.js + Express + PostgreSQL (**pgvector**) + OpenAI. Two core endpoints:

1. **Ingest** — chunk text, embed via OpenAI, store vectors in Postgres
2. **Query** — embed question, cosine-search top-K chunks, answer with grounded LLM call

## Stack

- `text-embedding-3-small` (1536-dim) for embeddings
- `gpt-4o-mini` for answer generation (configurable)
- pgvector **HNSW** index with `vector_cosine_ops`
- `<=>` operator = cosine distance; `similarity = 1 - distance`

## Setup

```bash
# 1. Postgres with pgvector (Docker)
docker run -d --name ragdb -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ragdb \
  pgvector/pgvector:pg16

# 2. Install + configure
npm install
cp .env.example .env   # set OPENAI_API_KEY

# 3. Create schema (extension, tables, HNSW index)
npm run db:init

# 4. Run
npm start
```

## API

### POST /api/documents — add data

```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Matheism Intro",
    "source": "manuscript",
    "text": "All existence is patterned or random; both are mathematical. ...",
    "metadata": {"lang": "en"}
  }'
```

Response: `{ "documentId": 1, "chunks": 3, ... }`

### POST /api/query — RAG answer

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the core claim?", "topK": 5}'
```

Response:

```json
{
  "answer": "The core claim is ... [1]",
  "sources": [
    { "ref": 1, "chunkId": 12, "documentId": 1, "title": "Matheism Intro", "similarity": 0.81 }
  ]
}
```

Optional: pass `"documentId": 1` to restrict retrieval to one document.

### Other

- `GET /api/documents` — list docs with chunk counts
- `DELETE /api/documents/:id` — cascade-deletes chunks
- `GET /health`

## Tuning (.env)

| Var | Default | Notes |
|---|---|---|
| `TOP_K` | 5 | chunks retrieved |
| `MIN_SIMILARITY` | 0.3 | drop weak matches |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 800 / 150 | chars, sentence-boundary aware |
| `EMBEDDING_DIM` | 1536 | must match model; re-run `db:init` after changing |

## Notes

- Embeddings are batched (100/request) before the DB transaction — a failed OpenAI call never holds a transaction open.
- If you switch to `text-embedding-3-large`, set `EMBEDDING_DIM=3072` and recreate the table (HNSW supports up to 2000 dims by default; use `halfvec` or dimension reduction via the `dimensions` param for 3072).
