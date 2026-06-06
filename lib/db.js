import pg from "pg";

// Next.js dev hot-reload re-evaluates modules; reuse one pool per process.
const globalForPg = globalThis;

export const pool =
  globalForPg.__ragPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

if (!globalForPg.__ragPool) {
  pool.on("error", (err) => console.error("PG pool error:", err));
  globalForPg.__ragPool = pool;
}
