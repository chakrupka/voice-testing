import { useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

export default function App() {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [err, setErr] = useState<string>("");
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");

  type Line = {
    id: string;
    role: "user" | "assistant";
    text: string;
    done: boolean;
  };

  const [lines, setLines] = useState<Line[]>([]);
  const activeAssistantIdRef = useRef<string | null>(null);

  function upsertLine(
    id: string,
    role: Line["role"],
    updater: (cur: Line) => Line,
  ) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1) {
        const fresh: Line = { id, role, text: "", done: false };
        return [...prev, updater(fresh)];
      }
      const next = prev.slice();
      next[idx] = updater(next[idx]);
      return next;
    });
  }

  async function connect() {
    try {
      setErr("");
      setStatus("connecting");

      const r = await fetch("/api/realtime-token", { method: "POST" });
      const { value } = await r.json();
      if (!value)
        throw new Error("No ephemeral key returned from /api/realtime-token");

      const agent = new RealtimeAgent({
        name: "Assistant",
        instructions: "You are a helpful assistant.",
      });

      const session = new RealtimeSession(agent, { model: "gpt-realtime" });
      sessionRef.current = session;

      await session.connect({ apiKey: value });
      session.on("error", (e) => {
        console.error("session error", e);
      });

      session.on("transport_event", (ev) => {
        switch (ev.type) {
          case "response.created": {
            const rid = ev.response?.id ?? ev.response_id;
            if (!rid) return;
            const id = `a:${rid}`;
            activeAssistantIdRef.current = id;
            upsertLine(id, "assistant", (cur) => cur);
            break;
          }

          case "response.output_audio_transcript.delta": {
            const id =
              activeAssistantIdRef.current ??
              `a:${ev.response_id ?? "unknown"}`;
            const delta = ev.delta ?? "";
            if (!delta) return;
            upsertLine(id, "assistant", (cur) => ({
              ...cur,
              text: cur.text + delta,
            }));
            break;
          }

          case "response.output_audio_transcript.done": {
            const id =
              activeAssistantIdRef.current ??
              `a:${ev.response_id ?? "unknown"}`;
            upsertLine(id, "assistant", (cur) => ({ ...cur, done: true }));
            break;
          }

          case "conversation.item.input_audio_transcription.delta": {
            const id = `u:${ev.item_id}`;
            const delta = ev.delta ?? "";
            if (!delta) return;
            upsertLine(id, "user", (cur) => ({
              ...cur,
              text: cur.text + delta,
            }));
            break;
          }

          case "conversation.item.input_audio_transcription.completed": {
            const id = `u:${ev.item_id}`;
            upsertLine(id, "user", (cur) => ({
              ...cur,
              text: ev.transcript ?? cur.text,
              done: true,
            }));
            break;
          }
        }
      });

      session.sendMessage("Say the word 'testing' out loud, then stop.");

      setStatus("connected");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function disconnect() {
    try {
      sessionRef.current?.close?.();
    } finally {
      sessionRef.current = null;
      setStatus("idle");
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div>Status: {status}</div>
      {err ? <pre style={{ whiteSpace: "pre-wrap" }}>{err}</pre> : null}

      {status !== "connected" ? (
        <button onClick={connect} disabled={status === "connecting"}>
          Connect + Talk
        </button>
      ) : (
        <button onClick={disconnect}>Disconnect</button>
      )}

      <p>
        After connecting and granting mic permission, speak normally; the
        session should respond with audio.
      </p>
      <div style={{ whiteSpace: "pre-wrap", fontFamily: "system-ui" }}>
        {lines.map((l) => (
          <div key={l.id}>
            <b>{l.role}:</b> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
