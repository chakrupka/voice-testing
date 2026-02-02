import express from "express";
import "dotenv/config";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (_req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.post("/api/realtime-token", async (_req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          output_modalities: ["audio"],
          audio: {
            output: { voice: "marin" },
          },
        },
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: text });
    }

    const data = await r.json();
    res.json({ value: data.value });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/summarize", async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that summarizes conversations concisely.",
        },
        {
          role: "user",
          content: `Please summarize this conversation:\n\n${transcript}`,
        },
      ],
      temperature: 0.7,
    });

    const summary = response.choices[0]?.message.content ?? "";
    res.json({ summary });
  } catch (e) {
    console.error("Summarization error:", e);
    res.status(500).json({ error: String(e) });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
