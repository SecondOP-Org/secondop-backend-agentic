import { query } from '../database/connection';

export const recordAnalysisPiiRevealEvent = async (input: {
  caseId: string;
  runId: string | null;
  actorUserId: string;
  revealed: boolean;
}): Promise<void> => {
  await query(
    `INSERT INTO analysis_pii_reveal_events (case_id, run_id, actor_user_id, revealed)
     VALUES ($1, $2, $3, $4)`,
    [input.caseId, input.runId, input.actorUserId, input.revealed]
  );
};
