/**
 * POST /api/schedule-next-review
 *
 * Calls the Python ML service (or falls back to a simple heuristic when the
 * ML service is unavailable) to schedule the next review for a card.
 *
 * Body  : { user_id: string, card_id: number, now?: ISO-8601 string }
 * Response: { scheduled_at, predicted_recall, model_version }
 */
import { Router, Request, Response } from "express";
import { Pool } from "pg";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";

export function createSchedulerRouter(pgPool: Pool): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const { user_id, card_id, now, target_recall } = req.body as {
      user_id?: string;
      card_id?: number;
      now?: string;
      target_recall?: number;
    };

    if (!user_id || card_id == null) {
      return res.status(400).json({ error: "user_id and card_id are required" });
    }

    const nowDt = now ? new Date(now) : new Date();

    try {
      // Try ML service first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const mlRes = await fetch(`${ML_SERVICE_URL}/schedule-next-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id,
            card_id,
            now: nowDt.toISOString(),
            target_recall: target_recall ?? 0.9,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (mlRes.ok) {
          const data = await mlRes.json();
          return res.json(data);
        }
      } catch (_mlErr) {
        clearTimeout(timeoutId);
        // Fall through to heuristic
      }

      // Heuristic fallback: query last review from PostgreSQL and apply simple
      // interval doubling (similar to SM-2 base logic)
      const { rows } = await pgPool.query<{
        rating: number;
        timestamp: Date;
        prev_timestamp: Date | null;
      }>(
        `SELECT rating, timestamp,
                LAG(timestamp) OVER (PARTITION BY user_id, card_id ORDER BY timestamp) AS prev_timestamp
         FROM review_events
         WHERE user_id = $1 AND card_id = $2
         ORDER BY timestamp DESC
         LIMIT 1`,
        [user_id, card_id]
      );

      let intervalDays = 1;
      if (rows.length > 0) {
        const { rating, timestamp, prev_timestamp } = rows[0];
        if (prev_timestamp) {
          const prevInterval =
            (timestamp.getTime() - prev_timestamp.getTime()) / 86400000;
          intervalDays =
            rating >= 3 ? Math.max(1, prevInterval * 2) : Math.max(0.5, prevInterval / 2);
        } else {
          intervalDays = rating >= 3 ? 1 : 0.5;
        }
      }

      const scheduledAt = new Date(nowDt.getTime() + intervalDays * 86400000);
      return res.json({
        scheduled_at: scheduledAt.toISOString(),
        predicted_recall: 0.9,
        model_version: "heuristic",
      });
    } catch (err) {
      console.error("[scheduler] Error:", err);
      return res.status(500).json({ error: "Failed to schedule review" });
    }
  });

  return router;
}
