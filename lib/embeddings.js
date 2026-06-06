import OpenAI from "openai";



const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "800", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "150", 10);

export { openai };

/**
 * Simple sliding-window chunker with sentence-boundary preference.
 * @param {string} text
 * @returns {string[]}
 */
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    // Prefer to break on sentence boundary near the end of the window
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const lastSentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? ")
      );
      if (lastSentence > size * 0.5) end = start + lastSentence + 1;
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

/**
 * Embed an array of strings in batches.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, batchSize = 100) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    // API preserves input order
    out.push(...res.data.map((d) => d.embedding));
  }
  return out;
}

export async function embedQuery(text) {
  const [vec] = await embedTexts([text]);
  return vec;
}

/** Format a JS array as a pgvector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}
