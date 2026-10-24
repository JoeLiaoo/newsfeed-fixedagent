/**
 * The panorama checkpoint: what one run already read, kept so a later run of the same task resumes
 * instead of paying for the same reads again. It is the JSONL ledger of the reference skill, stored
 * with the task and exported as JSONL for a person to read.
 */
import { sql } from "@aihot/backend/db";
import type { PanoramaCheckpointLine, PanoramaCheckpointStore } from "./panorama-run.ts";

type CheckpointRow = { seq: number; node_key: string; depth: number; kind: string; tool: string; payload: unknown };

export function createPanoramaCheckpoint(taskId: string, userId: string): PanoramaCheckpointStore {
  return {
    async get(nodeKey: string, kind: string) {
      const rows = await sql<CheckpointRow[]>`
        SELECT seq, node_key, depth, kind, tool, payload FROM member_expert_panorama_checkpoints
        WHERE task_id=${taskId} AND user_id=${userId} AND node_key=${nodeKey} AND kind=${kind} ORDER BY seq LIMIT 1`;
      const row = rows[0];
      if (!row) return null;
      return { seq: row.seq, nodeKey: row.node_key, depth: row.depth, kind: row.kind, tool: row.tool, payload: row.payload };
    },
    async put(line: Omit<PanoramaCheckpointLine, "seq">) {
      const next = await sql<{ seq: number }[]>`
        SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM member_expert_panorama_checkpoints WHERE task_id=${taskId}`;
      await sql`
        INSERT INTO member_expert_panorama_checkpoints(task_id, user_id, seq, node_key, depth, kind, tool, payload)
        VALUES (${taskId}, ${userId}, ${next[0]?.seq ?? 1}, ${line.nodeKey}, ${line.depth}, ${line.kind}, ${line.tool}, ${sql.json(line.payload as never)})
        ON CONFLICT (task_id, node_key, kind) DO NOTHING`;
    },
  };
}

/** The checkpoint of one task as JSONL, one line per read. */
export async function panoramaCheckpointJsonl(taskId: string, userId: string) {
  const rows = await sql<CheckpointRow[]>`
    SELECT seq, node_key, depth, kind, tool, payload FROM member_expert_panorama_checkpoints
    WHERE task_id=${taskId} AND user_id=${userId} ORDER BY seq`;
  return rows.map(row => JSON.stringify({ seq: row.seq, nodeKey: row.node_key, depth: row.depth, kind: row.kind, tool: row.tool, payload: row.payload })).join("\n") + (rows.length ? "\n" : "");
}
