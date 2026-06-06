import crypto from "node:crypto";
import { pool } from "./db.js";
import { openai, chunkText, embedTexts, toVectorLiteral } from "./embeddings.js";

const DIM = parseInt(process.env.EMBEDDING_DIM || "1536", 10);
const TOP_K = parseInt(process.env.TOP_K || "5", 10);
const MIN_SIMILARITY = parseFloat(process.env.MIN_SIMILARITY || "0.3");
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const EF_SEARCH = parseInt(process.env.HNSW_EF_SEARCH || "80", 10);
const RRF_K = 60;

const sha256 = (s) =>
  crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

/* ------------------------------------------------------------------ */
/* Query-embedding cache                                                */
/* ------------------------------------------------------------------ */
async function getQueryEmbedding(question) {
  const hash = sha256(question);
  const cached = await pool.query(
    `UPDATE query_cache SET hits = hits + 1, last_used_at = now()
     WHERE question_hash = $1 RETURNING embedding::text`,
    [hash]
  );
  if (cached.rowCount > 0) return { literal: cached.rows[0].embedding, cached: true };

  const res = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: question,
  });
  const literal = toVectorLiteral(res.data[0].embedding);
  await pool.query(
    `INSERT INTO query_cache (question_hash, question, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (question_hash) DO UPDATE
       SET hits = query_cache.hits + 1, last_used_at = now()`,
    [hash, question, literal]
  );
  return { literal, cached: false };
}

/* ------------------------------------------------------------------ */
/* Ingest                                                               */
/* ------------------------------------------------------------------ */
export async function ingestDocument({ title = null, source = null, text, metadata = {} }) {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw Object.assign(new Error("Text produced no chunks"), { status: 400 });

  const embeddings = await embedTexts(chunks); // embed BEFORE the transaction

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const doc = await client.query(
      `INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id`,
      [title, source]
    );
    const documentId = doc.rows[0].id;

    // one round trip for all chunks
    await client.query(
      `INSERT INTO chunks (document_id, chunk_index, content, embedding, metadata)
       SELECT $1, t.idx, t.content, t.emb::vector(${DIM}), $5::jsonb
       FROM UNNEST($2::int[], $3::text[], $4::text[]) AS t(idx, content, emb)`,
      [
        documentId,
        chunks.map((_, i) => i),
        chunks,
        embeddings.map(toVectorLiteral),
        JSON.stringify(metadata),
      ]
    );
    await client.query("COMMIT");
    return { documentId, chunks: chunks.length, title, source };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listDocuments() {
  const { rows } = await pool.query(`
    SELECT d.id, d.title, d.source, d.created_at, COUNT(c.id)::int AS chunks
    FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id ORDER BY d.created_at DESC
  `);
  return rows;
}

export async function deleteDocument(id) {
  const { rowCount } = await pool.query(`DELETE FROM documents WHERE id = $1`, [id]);
  return rowCount > 0;
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                            */
/* ------------------------------------------------------------------ */
async function hybridSearch(client, qLiteral, question, topK, documentId) {
  const filter = documentId ? "AND c.document_id = $4" : "";
  const params = documentId
    ? [qLiteral, question, topK, documentId]
    : [qLiteral, question, topK];

  const { rows } = await client.query(
    `
    WITH semantic AS (
      SELECT c.id, ROW_NUMBER() OVER () AS rank,
             1 - (c.embedding::halfvec(${DIM}) <=> $1::halfvec(${DIM})) AS similarity
      FROM chunks c WHERE true ${filter}
      ORDER BY c.embedding::halfvec(${DIM}) <=> $1::halfvec(${DIM})
      LIMIT LEAST($3 * 4, 50)
    ),
    lexical AS (
      SELECT c.id, ROW_NUMBER() OVER (
               ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', $2)) DESC
             ) AS rank
      FROM chunks c
      WHERE c.fts @@ websearch_to_tsquery('english', $2) ${filter}
      LIMIT LEAST($3 * 4, 50)
    ),
    fused AS (
      SELECT COALESCE(s.id, l.id) AS id,
             COALESCE(1.0 / (${RRF_K} + s.rank), 0) +
             COALESCE(1.0 / (${RRF_K} + l.rank), 0) AS rrf_score,
             s.similarity
      FROM semantic s FULL OUTER JOIN lexical l USING (id)
    )
    SELECT c.id, c.document_id, c.chunk_index, c.content, d.title, d.source,
           f.rrf_score,
           COALESCE(f.similarity,
                    1 - (c.embedding::halfvec(${DIM}) <=> $1::halfvec(${DIM}))) AS similarity
    FROM fused f
    JOIN chunks c ON c.id = f.id
    JOIN documents d ON d.id = c.document_id
    ORDER BY f.rrf_score DESC
    LIMIT $3
    `,
    params
  );
  return rows;
}

async function twoStageSearch(client, qLiteral, topK, documentId) {
  const filter = documentId ? "AND c.document_id = $3" : "";
  const params = documentId ? [qLiteral, topK, documentId] : [qLiteral, topK];
  const { rows } = await client.query(
    `
    WITH coarse AS (
      SELECT c.id FROM chunks c WHERE true ${filter}
      ORDER BY c.embedding_bits <~> binary_quantize($1::vector)
      LIMIT LEAST($2 * 10, 200)
    )
    SELECT c.id, c.document_id, c.chunk_index, c.content, d.title, d.source,
           1 - (c.embedding <=> $1::vector) AS similarity
    FROM coarse
    JOIN chunks c ON c.id = coarse.id
    JOIN documents d ON d.id = c.document_id
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
    `,
    params
  );
  return rows;
}

async function semanticSearch(client, qLiteral, topK, documentId) {
  const filter = documentId ? "AND c.document_id = $3" : "";
  const params = documentId ? [qLiteral, topK, documentId] : [qLiteral, topK];
  const { rows } = await client.query(
    `
    SELECT c.id, c.document_id, c.chunk_index, c.content, d.title, d.source,
           1 - (c.embedding::halfvec(${DIM}) <=> $1::halfvec(${DIM})) AS similarity
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE true ${filter}
    ORDER BY c.embedding::halfvec(${DIM}) <=> $1::halfvec(${DIM})
    LIMIT $2
    `,
    params
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Full RAG pipeline                                                    */
/* ------------------------------------------------------------------ */
export async function answerQuestion({ question, topK = TOP_K, documentId = null, mode = "hybrid" }) {
  const t0 = Date.now();
  const { literal: qLiteral, cached } = await getQueryEmbedding(question);

  const client = await pool.connect();
  let rows;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`);
    await client.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`);

    if (mode === "twostage") rows = await twoStageSearch(client, qLiteral, topK, documentId);
    else if (mode === "semantic") rows = await semanticSearch(client, qLiteral, topK, documentId);
    else rows = await hybridSearch(client, qLiteral, question, topK, documentId);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const retrievalMs = Date.now() - t0;

  const context = rows.filter((r) => r.similarity >= MIN_SIMILARITY);
  if (context.length === 0) {
    return {
      answer: "I don't have relevant information in the knowledge base to answer that.",
      sources: [],
      stats: { mode, retrievalMs, embeddingCached: cached },
    };
  }

  const contextBlock = context
    .map((r, i) => `[${i + 1}] (doc: ${r.title || r.document_id})\n${r.content}`)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a precise assistant. Answer ONLY using the provided context. " +
          "If the context is insufficient, say so. Cite sources as [1], [2], etc.",
      },
      { role: "user", content: `Context:\n${contextBlock}\n\nQuestion: ${question}` },
    ],
  });

  return {
    answer: completion.choices[0].message.content,
    model: CHAT_MODEL,
    sources: context.map((r, i) => ({
      ref: i + 1,
      chunkId: r.id,
      documentId: r.document_id,
      title: r.title,
      source: r.source,
      similarity: Number(Number(r.similarity).toFixed(4)),
      ...(r.rrf_score != null && { rrfScore: Number(Number(r.rrf_score).toFixed(5)) }),
    })),
    stats: { mode, retrievalMs, totalMs: Date.now() - t0, embeddingCached: cached },
  };
}

export async function getStats() {
  const [sizes, cache, tuples] = await Promise.all([
    pool.query(`
      SELECT indexrelname AS index,
             pg_size_pretty(pg_relation_size(indexrelid)) AS size,
             idx_scan AS scans
      FROM pg_stat_user_indexes WHERE relname = 'chunks'
      ORDER BY pg_relation_size(indexrelid) DESC
    `),
    pool.query(`SELECT COUNT(*)::int AS entries, COALESCE(SUM(hits),0)::int AS total_hits FROM query_cache`),
    pool.query(`
      SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
      FROM pg_stat_user_tables WHERE relname IN ('chunks','documents')
    `),
  ]);
  return { indexes: sizes.rows, queryCache: cache.rows[0], tables: tuples.rows };
}
