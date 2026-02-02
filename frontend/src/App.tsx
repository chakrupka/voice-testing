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
  };

  const [lines, setLines] = useState<Line[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

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
        console.log(ev);
        switch (ev.type) {
          case "conversation.item.input_audio_transcription.completed": {
            const text = ev.transcript;
            const role = "user";
            const id = ev.item_id;
            console.log("Adding to lines (assistant):", { id, role, text });
            setLines((prevLines) => {
              if (prevLines.some((line) => line.id === id)) return prevLines;
              return [...prevLines, { id, role, text }];
            });
            break;
          }

          case "conversation.item.done": {
            const content = ev.item.content;
            if (content && content.length) {
              if (content[0].transcript) {
                const text = content[0].transcript;
                const role = ev.item.role;
                const id = ev.item.id;
                setLines((prevLines) => {
                  if (prevLines.some((line) => line.id === id))
                    return prevLines;
                  return [...prevLines, { id, role, text }];
                });
              }
            }
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

    // Generate summary if there's conversation history
    if (lines.length > 0) {
      setIsGeneratingSummary(true);
      try {
        const transcript = lines
          .map((line) => `${line.role}: ${line.text}`)
          .join("\n");

        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ transcript }),
        });

        if (response.ok) {
          const data = await response.json();
          setSummary(data.summary);
        } else {
          const errorText = await response.text();
          console.error("Failed to generate summary:", errorText);
          setSummary("Failed to generate summary.");
        }
      } catch (error) {
        console.error("Error generating summary:", error);
        setSummary("Failed to generate summary.");
      } finally {
        setIsGeneratingSummary(false);
      }
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

      {isGeneratingSummary && (
        <div style={{ padding: 10, background: "#f0f0f0", marginTop: 10 }}>
          Generating summary...
        </div>
      )}

      {summary && (
        <div
          style={{
            padding: 10,
            background: "#e8f5e9",
            marginTop: 10,
            borderRadius: 4,
          }}
        >
          <h3 style={{ margin: "0 0 10px 0" }}>Conversation Summary</h3>
          <div style={{ whiteSpace: "pre-wrap" }}>{summary}</div>
        </div>
      )}

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
