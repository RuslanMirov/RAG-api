/**
 * Mint a JWT for testing / service-to-service use (HS256).
 *
 *   node scripts/issueToken.js                          # rag:read, 1h
 *   node scripts/issueToken.js writer "rag:read rag:write" 24h
 *
 * argv: [sub] [scope] [expiresIn]
 */
import { issueToken } from "../src/auth.js";

const [sub = "dev", scope = "rag:read", expiresIn = "1h"] = process.argv.slice(2);
const token = issueToken({ sub, scope, expiresIn });

console.log(`sub=${sub} scope="${scope}" exp=${expiresIn}\n`);
console.log(token);
console.log(`\ncurl -H "Authorization: Bearer ${token}" ...`);
