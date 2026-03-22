/**
 * Session planner & item renderer
 *
 * POST /api/plan-session
 *   Body   : { user_id, desired_count, optional_concept_ids?: number[] }
 *   Response: { session_id, items: PlannedItem[] }
 *
 * POST /api/render-item
 *   Body   : { planned_item: PlannedItem, user_id: string }
 *   Response: RenderedItem
 */
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import crypto from "crypto";

// ─────────────────────────────────────────────── types ── //

type PromptVariant = "cloze" | "qa" | "mcq" | "feynman" | "example";
type DisplayType = "text-input" | "mcq" | "short-explain" | "example";

interface PlannedItem {
  card_id: number;
  concept_id: number;
  planned_prompt_variant: PromptVariant;
}

interface RenderedItem {
  session_id: string;
  item_id: string;
  display_type: DisplayType;
  prompt_text: string;
  answer_choices?: string[];
  correct_answer_index?: number;
}

// ─────────────────────────────────────── helpers ── //

const VARIANTS: PromptVariant[] = ["cloze", "qa", "mcq", "feynman", "example"];
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";

/** Fisher-Yates shuffle (unbiased). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
  // Deterministic pseudo-random choice from card + concept ids
  return VARIANTS[(cardId + conceptId) % VARIANTS.length];
}

function variantToDisplayType(v: PromptVariant): DisplayType {
  switch (v) {
    case "cloze":
    case "qa":
      return "text-input";
    case "mcq":
      return "mcq";
    case "feynman":
      return "short-explain";
    case "example":
      return "example";
  }
}

/**
 * Interleave items so no two consecutive items share the same concept_id where
 * possible.  Uses a simple greedy swap.
 */
function interleave(items: PlannedItem[]): PlannedItem[] {
  const result: PlannedItem[] = [];
  const remaining = [...items];

  while (remaining.length > 0) {
    const lastConceptId = result.length > 0 ? result[result.length - 1].concept_id : -1;

    // Find the first item whose concept differs from the last placed
    let idx = remaining.findIndex((it) => it.concept_id !== lastConceptId);
    if (idx === -1) idx = 0; // No choice, just take next

    result.push(remaining.splice(idx, 1)[0]);
  }
  return result;
}

/**
 * Generate simple MCQ distractors from other concepts' definitions.
 * Falls back to placeholder distractors if there are not enough alternatives.
 */
async function generateDistractors(
  correctAnswer: string,
  conceptDescription: string,
  pgPool: Pool,
  geminiClient?: any
): Promise<{ choices: string[]; correctIndex: number }> {
  if (geminiClient) {
    try {
      const prompt = `You are a vocabulary teacher. Given the correct answer and concept context, generate 3 plausible but incorrect distractors for a multiple-choice question.
Correct answer: "${correctAnswer}"
Concept: "${conceptDescription}"

Respond ONLY with a JSON array of exactly 3 strings, e.g.: ["distractor1", "distractor2", "distractor3"]`;

      const result = await geminiClient.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });
      const text: string = result.text.trim();
      const jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const distractors: string[] = JSON.parse(jsonText);
      if (Array.isArray(distractors) && distractors.length >= 3) {
        const all = [correctAnswer, ...distractors.slice(0, 3)];
        const shuffled = shuffle(all);
        return { choices: shuffled, correctIndex: shuffled.indexOf(correctAnswer) };
      }
    } catch (_e) {
      // Fall through
    }
  }

  // Local fallback: pull 3 random answers from other cards
  const { rows } = await pgPool.query<{ answer: string }>(
    `SELECT answer FROM cards WHERE answer != $1 ORDER BY RANDOM() LIMIT 3`,
    [correctAnswer]
  );
  const distractors = rows.map((r) => r.answer);
  while (distractors.length < 3) {
    distractors.push(`Option ${distractors.length + 1}`);
  }
  const all = [correctAnswer, ...distractors];
  const shuffled = shuffle(all);
  return { choices: shuffled, correctIndex: shuffled.indexOf(correctAnswer) };
}

// ─────────────────────────────────────── router factory ── //

export function createSessionRouter(pgPool: Pool, geminiClient?: any): Router {
  const router = Router();

  // ── POST /api/plan-session ─────────────────────────────────────────────── //
  router.post("/plan-session", async (req: Request, res: Response) => {
    const {
      user_id,
      desired_count = 20,
      optional_concept_ids,
    } = req.body as {
      user_id?: string;
      desired_count?: number;
      optional_concept_ids?: number[];
    };

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const count = Math.min(Math.max(1, Number(desired_count)), 100);

    try {
      // 1. Fetch due cards (scheduled_at <= now or never reviewed)
      //    We look at review_events to find the last scheduled time per card
      //    and pull cards that are due.
      let cardsQuery = `
        SELECT
          c.id AS card_id,
          c.concept_id,
          c.difficulty,
          COALESCE(
            (SELECT MAX(re.timestamp) FROM review_events re
             WHERE re.user_id = $1 AND re.card_id = c.id),
            '1970-01-01'::timestamp
          ) AS last_reviewed
        FROM cards c
        JOIN concepts co ON co.id = c.concept_id
        WHERE c.id IN (
          /* Due: cards with no recent review or overdue */
          SELECT DISTINCT c2.id
          FROM cards c2
          LEFT JOIN review_events re2 ON re2.card_id = c2.id AND re2.user_id = $1
          WHERE re2.id IS NULL
             OR re2.timestamp < NOW() - INTERVAL '1 day'
        )
      `;
      const params: (string | number[])[] = [user_id];

      if (optional_concept_ids && optional_concept_ids.length > 0) {
        params.push(optional_concept_ids);
        cardsQuery += ` AND c.concept_id = ANY($2::int[])`;
      }

      cardsQuery += ` ORDER BY last_reviewed ASC LIMIT $${params.length + 1}`;
      params.push(count * 2); // fetch extra, then interleave + trim

      const { rows: dueCards } = await pgPool.query<{
        card_id: number;
        concept_id: number;
        difficulty: number;
      }>(cardsQuery, params);

      // 2. If we have fewer than desired, supplement with near-due cards
      //    (already covered by the broad query above; this is a no-op fallback)
      let pool = dueCards;
      if (pool.length < count) {
        const { rows: extraCards } = await pgPool.query<{
          card_id: number;
          concept_id: number;
          difficulty: number;
        }>(
          `SELECT c.id AS card_id, c.concept_id, c.difficulty
           FROM cards c
           WHERE c.id NOT IN (SELECT unnest($2::int[]))
           ORDER BY RANDOM()
           LIMIT $1`,
          [count - pool.length, pool.map((r) => r.card_id)]
        );
        pool = [...pool, ...extraCards];
      }

      // 3. Assign prompt variants and interleave
      const items: PlannedItem[] = pool.slice(0, count).map((row) => ({
        card_id: row.card_id,
        concept_id: row.concept_id,
        planned_prompt_variant: chooseVariant(row.card_id, row.concept_id),
      }));

      const interleaved = interleave(items);
      const session_id = crypto.randomUUID();

      return res.json({ session_id, items: interleaved });
    } catch (err) {
      console.error("[plan-session] Error:", err);
      return res.status(500).json({ error: "Failed to plan session" });
    }
  });

  // ── POST /api/render-item ──────────────────────────────────────────────── //
  router.post("/render-item", async (req: Request, res: Response) => {
    const { planned_item, user_id } = req.body as {
      planned_item?: PlannedItem;
      user_id?: string;
    };

    if (!planned_item || !user_id) {
      return res.status(400).json({ error: "planned_item and user_id are required" });
    }

    const { card_id, concept_id, planned_prompt_variant } = planned_item;

    try {
      const { rows } = await pgPool.query<{
        base_prompt: string;
        answer: string;
        description: string;
        title: string;
      }>(
        `SELECT c.base_prompt, c.answer, co.description, co.title
         FROM cards c
         JOIN concepts co ON co.id = c.concept_id
         WHERE c.id = $1 AND co.id = $2`,
        [card_id, concept_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Card not found" });
      }

      const { base_prompt, answer, description, title } = rows[0];
      const display_type = variantToDisplayType(planned_prompt_variant);
      const item_id = crypto.randomUUID();
      const session_id = (req.body.session_id as string | undefined) ?? crypto.randomUUID();

      let prompt_text = base_prompt;
      let answer_choices: string[] | undefined;
      let correct_answer_index: number | undefined;

      switch (planned_prompt_variant) {
        case "cloze": {
          // Replace the last word of the answer with blank if not already a cloze
          if (!base_prompt.includes("___")) {
            prompt_text = base_prompt.replace(
              new RegExp(`\\b${answer.split(" ").slice(-1)[0]}\\b`, "i"),
              "___"
            );
          }
          break;
        }
        case "qa": {
          prompt_text = base_prompt;
          break;
        }
        case "mcq": {
          const { choices, correctIndex } = await generateDistractors(
            answer,
            description,
            pgPool,
            geminiClient
          );
          answer_choices = choices;
          correct_answer_index = correctIndex;
          break;
        }
        case "feynman": {
          prompt_text = `Explain the concept "${title}" in your own words to a 9th grader. Be specific and use an example.`;
          break;
        }
        case "example": {
          prompt_text = `Give a new, original example of "${title}" that was not mentioned in class.`;
          break;
        }
      }

      const rendered: RenderedItem = {
        session_id,
        item_id,
        display_type,
        prompt_text,
        ...(answer_choices !== undefined && { answer_choices }),
        ...(correct_answer_index !== undefined && { correct_answer_index }),
      };

      return res.json(rendered);
    } catch (err) {
      console.error("[render-item] Error:", err);
      return res.status(500).json({ error: "Failed to render item" });
    }
  });

  return router;
}
