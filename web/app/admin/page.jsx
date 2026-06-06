"use client";

import { useState } from "react";

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [banner, setBanner] = useState(null); // {kind, text}

  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState([]);

  const hdrs = { "Content-Type": "application/json", "x-admin-key": adminKey };

  async function loadDocs(key = adminKey) {
    const res = await fetch("/api/admin/documents", {
      headers: { "x-admin-key": key },
    });
    if (res.ok) setDocs(await res.json());
    return res.ok;
  }

  async function unlock(e) {
    e.preventDefault();
    setBanner(null);
    const ok = await loadDocs(adminKey);
    if (ok) {
      setUnlocked(true);
    } else {
      setBanner({ kind: "bad", text: "Invalid admin key." });
    }
  }

  async function ingest(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/ingest", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ title, source, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBanner({
        kind: "ok",
        text: `Ingested document #${data.documentId} — ${data.chunks} chunk(s) embedded.`,
      });
      setTitle("");
      setSource("");
      setText("");
      loadDocs();
    } catch (err) {
      setBanner({ kind: "bad", text: `Ingest failed: ${err.message}` });
      if (/Invalid admin key/i.test(err.message)) setUnlocked(false);
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id) {
    if (!confirm(`Delete document #${id} and all its chunks?`)) return;
    const res = await fetch(`/api/admin/documents?id=${id}`, {
      method: "DELETE",
      headers: hdrs,
    });
    if (res.ok) loadDocs();
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>
          The <em>Vault</em> — Admin
        </h1>
        <nav>
          <a href="/">Chat</a>
          <a className="active" href="/admin">Admin</a>
        </nav>
      </header>

      {!unlocked ? (
        <form className="lock" onSubmit={unlock}>
          <div className="glyph">⌘</div>
          <p>
            Restricted. Enter the admin secret to manage the knowledge base.
            <br />
            The key is verified server-side and never stored.
          </p>
          {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
          <div className="composer-row">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Admin secret key"
              autoFocus
            />
            <button className="go" disabled={!adminKey.trim()}>
              Unlock
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className="panel">
            <h2>Add knowledge</h2>
            <p className="sub">
              Text is chunked, embedded via OpenAI, and indexed in pgvector.
            </p>
            {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
            <form onSubmit={ingest}>
              <div className="row-2">
                <div className="field">
                  <label>Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Matheism — PRD overview"
                  />
                </div>
                <div className="field">
                  <label>Source</label>
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="manuscript / url / internal"
                  />
                </div>
              </div>
              <div className="field">
                <label>Text *</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the document content…"
                  required
                />
              </div>
              <button className="go" style={{ padding: "12px 26px" }} disabled={busy || !text.trim()}>
                {busy ? "Embedding…" : "Ingest"}
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Documents</h2>
            <p className="sub">{docs.length} document(s) in the knowledge base</p>
            <table className="doc-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Source</th>
                  <th>Chunks</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td>{d.title || "—"}</td>
                    <td>{d.source || "—"}</td>
                    <td>{d.chunks}</td>
                    <td>{new Date(d.created_at).toLocaleString()}</td>
                    <td>
                      <button className="del" onClick={() => removeDoc(d.id)}>
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
                {docs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--bone-dim)" }}>
                      Empty. Add the first document above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
