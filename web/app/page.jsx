"use client";

import { useRef, useState } from "react";

const MODES = ["hybrid", "twostage", "semantic"];

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  async function send(e) {
    e?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: data.answer,
          sources: data.sources || [],
          stats: data.stats,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "bot", error: true, text: `⨯ ${err.message}` },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>
          The <em>Vault</em>
        </h1>
        <nav>
          <a className="active" href="/">Chat</a>
          <a href="/admin">Admin</a>
        </nav>
      </header>

      <section className="thread">
        {messages.length === 0 && (
          <div className="empty">
            <span className="glyph">§</span>
            <p>Ask the knowledge base.</p>
            <p className="tag">retrieval · pgvector · {mode}</p>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">
              <div className="who">You</div>
              <div className="body">{m.text}</div>
            </div>
          ) : (
            <div key={i} className={`msg bot${m.error ? " err" : ""}`}>
              <div className="who">Vault</div>
              <div className="body">{m.text}</div>
              {m.sources?.length > 0 && (
                <div className="sources">
                  {m.sources.map((s) => (
                    <span
                      key={s.ref}
                      className="source-chip"
                      title={`similarity ${s.similarity}`}
                    >
                      [{s.ref}] {s.title || `doc ${s.documentId}`} ·{" "}
                      {(s.similarity * 100).toFixed(0)}%
                    </span>
                  ))}
                </div>
              )}
              {m.stats && (
                <div className="stats-line">
                  {m.stats.mode} · retrieval {m.stats.retrievalMs}ms
                  {m.stats.embeddingCached ? " · embedding cached" : ""}
                </div>
              )}
            </div>
          )
        )}

        {busy && (
          <div className="msg bot">
            <div className="who">Vault</div>
            <div className="thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </section>

      <form className="composer" onSubmit={send}>
        <div className="composer-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            disabled={busy}
            autoFocus
          />
          <button className="go" disabled={busy || !input.trim()}>
            Ask
          </button>
        </div>
        <div className="mode-row">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "on" : ""}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}
