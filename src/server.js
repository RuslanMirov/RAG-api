import express from "express";
import dotenv from "dotenv";
import { pool } from "./db.js";
import {
  openai,
  chunkText,
  embedTexts,
  embedQuery,
  toVectorLiteral,
} from "./embeddings.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = parseInt(process.env.PORT || "3000", 10);
const TOP_K = parseInt(process.env.TOP_K || "5", 10);
const MIN_SIMILARITY = parseFloat(process.env.MIN_SIMILARITY || "0.3");
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

/* ------------------------------------------------------------------ */
/* 1) INGEST: add data to DB, embeddings via OpenAI                     */
/* POST /api/documents  { title?, source?, text, metadata? }            */
/* ------------------------------------------------------------------ */
app.post("/api/documents", async (req, res) => {
  const { title = null, source = null, text, metadata = {} } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Field 'text' (string) is required" });
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return res.status(400).json({ error: "Text produced no chunks" });
  }

  const client = await pool.connect();
  try {
    // Embed first (outside the transaction) so a failed OpenAI call
    // doesn't hold a DB transaction open.
    const embeddings = await embedTexts(chunks);

    await client.query("BEGIN");
    const docResult = await client.query(
      `INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id`,
      [title, source]
    );
    const documentId = docResult.rows[0].id;

    const insertSql = `
      INSERT INTO chunks (document_id, chunk_index, content, embedding, metadata)
      VALUES ($1, $2, $3, $4::vector, $5)
    `;
    for (let i = 0; i < chunks.length; i++) {
      await client.query(insertSql, [
        documentId,
        i,
        chunks[i],
        toVectorLiteral(embeddings[i]),
        metadata,
      ]);
    }
    await client.query("COMMIT");

    res.status(201).json({
      documentId,
      chunks: chunks.length,
      title,
      source,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Ingest error:", err);
    res.status(500).json({ error: "Ingest failed", detail: err.message });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/* Optional: list / delete documents                                    */
/* ------------------------------------------------------------------ */
app.get("/api/documents", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT d.id, d.title, d.source, d.created_at, COUNT(c.id)::int AS chunks
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `);
  res.json(rows);
});

app.delete("/api/documents/:id", async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM documents WHERE id = $1`, [
    req.params.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json({ deleted: true });
});

/* ------------------------------------------------------------------ */
/* 2) RAG: answer a question from retrieved context                     */
/* POST /api/query  { question, topK?, documentId? }                    */
/* ------------------------------------------------------------------ */
app.post("/api/query", async (req, res) => {
  const { question, topK = TOP_K, documentId = null } = req.body || {};
  if (!question || typeof question !== "string") {
    return res
      .status(400)
      .json({ error: "Field 'question' (string) is required" });
  }

  try {
    // 1. Embed the question
    const qVec = toVectorLiteral(await embedQuery(question));

    // 2. Cosine similarity search via pgvector (<=> is cosine distance)
    const params = [qVec, topK];
    let filter = "";
    if (documentId) {
      params.push(documentId);
      filter = "WHERE c.document_id = $3";
    }
    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.document_id,
        c.chunk_index,
        c.content,
        d.title,
        d.source,
        1 - (c.embedding <=> $1::vector) AS similarity
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      ${filter}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      params
    );

    const context = rows.filter((r) => r.similarity >= MIN_SIMILARITY);

    if (context.length === 0) {
      return res.json({
        answer:
          "I don't have relevant information in the knowledge base to answer that.",
        sources: [],
      });
    }

    // 3. Build prompt with retrieved context
    const contextBlock = context
      .map(
        (r, i) =>
          `[${i + 1}] (doc: ${r.title || r.document_id}, similarity: ${r.similarity.toFixed(3)})\n${r.content}`
      )
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
        {
          role: "user",
          content: `Context:\n${contextBlock}\n\nQuestion: ${question}`,
        },
      ],
    });

    res.json({
      answer: completion.choices[0].message.content,
      model: CHAT_MODEL,
      sources: context.map((r, i) => ({
        ref: i + 1,
        chunkId: r.id,
        documentId: r.document_id,
        title: r.title,
        source: r.source,
        similarity: Number(r.similarity.toFixed(4)),
      })),
    });
  } catch (err) {
    console.error("Query error:", err);
    res.status(500).json({ error: "Query failed", detail: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 RAG API listening on http://localhost:${PORT}`);
});
