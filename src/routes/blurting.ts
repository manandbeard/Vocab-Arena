/**
 * Blurting metric endpoints
 *
 * POST /api/blurting-prompt
 *   Body    : { user_id, concept_id }
 *   Response: { prompt_text }
 *
 * POST /api/submit-blurt
 *   Body    : { user_id, concept_id, response_text }
 *   Response: { scores: BlurtingScores, feedback_text: string }
 */
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

// 10 blurt submissions per minute per IP (LLM calls are expensive)
const blurtLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

interface BlurtingScores {
  coverage: number;
  accuracy: number;
  organization: number;
  overall: number;
  missing_key_points: string[];
}

// ─────────────────────────────────────────────── LLM scorer ── //

async function scoreBlurt(
  title: string,
  description: string,
  keyPoints: string[],
  responseText: string,
  geminiClient: any
): Promise<{ scores: BlurtingScores; feedback_text: string }> {
  const rubricPrompt = `You are an expert educator grading a student's free-recall response.

Concept title: "${title}"
Concept description: "${description}"
Key points the student should cover:
${keyPoints.map((kp, i) => `  ${i + 1}. ${kp}`).join("\n")}

Student response:
"""
${responseText}
"""

Grade the student's response and return ONLY a JSON object with this exact shape:
{
  "coverage": <number 0-1, fraction of key_points addressed>,
  "accuracy": <number 0-1, factual correctness>,
  "organization": <number 0-1, clarity and structure>,
  "overall": <number 0-1, weighted holistic score>,
  "missing_key_points": [<list of key_points the student omitted or got wrong>],
  "feedback_text": "<2-4 sentence constructive feedback>"
}`;

  const result = await geminiClient.models.generateContent({
    model: "gemini-2.0-flash",
    contents: rubricPrompt,
  });

  const text: string = result.text.trim();
  const jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(jsonText);

  const scores: BlurtingScores = {
    coverage: Math.max(0, Math.min(1, Number(parsed.coverage))),
    accuracy: Math.max(0, Math.min(1, Number(parsed.accuracy))),
    organization: Math.max(0, Math.min(1, Number(parsed.organization))),
    overall: Math.max(0, Math.min(1, Number(parsed.overall))),
    missing_key_points: Array.isArray(parsed.missing_key_points)
      ? parsed.missing_key_points.map(String)
      : [],
  };

  return { scores, feedback_text: String(parsed.feedback_text ?? "") };
}

function overallToRating(overall: number): number {
  return Math.round(overall * 5 * 10) / 10; // 0–5 scale, one decimal
}

// ─────────────────────────────────────────────── router factory ── //

export function createBlurtingRouter(pgPool: Pool, geminiClient: any): Router {
  const router = Router();

  // ── POST /api/blurting-prompt ──────────────────────────────────────────── //
  router.post("/blurting-prompt", blurtLimiter, async (req: Request, res: Response) => {
    const { user_id, concept_id } = req.body as {
      user_id?: string;
      concept_id?: number;
    };

    if (!user_id || concept_id == null) {
      return res.status(400).json({ error: "user_id and concept_id are required" });
    }

    try {
      const { rows } = await pgPool.query<{ title: string; description: string }>(
        "SELECT title, description FROM concepts WHERE id = $1",
        [concept_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Concept not found" });
      }

      const { title } = rows[0];
      const prompt_text =
        `Without looking at your notes, write everything you know about "${title}". ` +
        `Include definitions, examples, key points, and any connections to other concepts you can think of.`;

      return res.json({ prompt_text });
    } catch (err) {
      console.error("[blurting-prompt] Error:", err);
      return res.status(500).json({ error: "Failed to generate blurting prompt" });
    }
  });

  // ── POST /api/submit-blurt ─────────────────────────────────────────────── //
  router.post("/submit-blurt", blurtLimiter, async (req: Request, res: Response) => {
    const { user_id, concept_id, response_text } = req.body as {
      user_id?: string;
      concept_id?: number;
      response_text?: string;
    };

    if (!user_id || concept_id == null || !response_text) {
      return res
        .status(400)
        .json({ error: "user_id, concept_id, and response_text are required" });
    }

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");

      // Fetch concept + cards
      const { rows: conceptRows } = await client.query<{
        title: string;
        description: string;
        key_points: string[];
      }>(
        "SELECT title, description, key_points FROM concepts WHERE id = $1",
        [concept_id]
      );

      if (conceptRows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Concept not found" });
      }

      const { title, description, key_points } = conceptRows[0];

      // Score via LLM
      let scores: BlurtingScores;
      let feedback_text: string;

      if (geminiClient) {
        try {
          ({ scores, feedback_text } = await scoreBlurt(
            title,
            description,
            key_points ?? [],
            response_text,
            geminiClient
          ));
        } catch (llmErr) {
          console.error("[submit-blurt] LLM scoring failed:", llmErr);
          // Fallback heuristic: length-based rough score
          const words = response_text.trim().split(/\s+/).length;
          const base = Math.min(1, words / 100);
          scores = {
            coverage: base,
            accuracy: base,
            organization: base,
            overall: base,
            missing_key_points: key_points ?? [],
          };
          feedback_text =
            "Automatic scoring is temporarily unavailable. Your response has been saved.";
        }
      } else {
        const words = response_text.trim().split(/\s+/).length;
        const base = Math.min(1, words / 100);
        scores = {
          coverage: base,
          accuracy: base,
          organization: base,
          overall: base,
          missing_key_points: key_points ?? [],
        };
        feedback_text =
          "LLM scoring is not configured. Your response has been saved for manual review.";
      }

      const blurtingTimestamp = new Date();
      const session_id = crypto.randomUUID();

      // Persist blurting_session
      await client.query(
        `INSERT INTO blurting_sessions
           (id, user_id, concept_id, prompt, response_text, timestamp, scores)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session_id,
          user_id,
          concept_id,
          `Blurting session for concept ${concept_id}`,
          response_text,
          blurtingTimestamp,
          JSON.stringify(scores),
        ]
      );

      // Create synthetic review_events for every card in this concept
      const { rows: cardRows } = await client.query<{ id: number }>(
        "SELECT id FROM cards WHERE concept_id = $1",
        [concept_id]
      );

      const syntheticRating = overallToRating(scores.overall);
      for (const card of cardRows) {
        await client.query(
          `INSERT INTO review_events
             (user_id, card_id, session_id, timestamp, rating, latency_ms, was_hint_used, is_synthetic)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            user_id,
            card.id,
            session_id,
            blurtingTimestamp,
            syntheticRating,
            null,
            false,
            true,
          ]
        );
      }

      await client.query("COMMIT");

      return res.json({ scores, feedback_text });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[submit-blurt] Error:", err);
      return res.status(500).json({ error: "Failed to process blurt submission" });
    } finally {
      client.release();
    }
  });

  return router;
}
