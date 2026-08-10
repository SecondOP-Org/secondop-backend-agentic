import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const hasCaseAccess = async (caseId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT 1
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     WHERE c.id = $1
       AND (p.user_id = $2 OR d.user_id = $2)
     LIMIT 1`,
    [caseId, userId]
  );
  return result.rows;
};

export const hasParticipantForCase = async (caseId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT 1
     FROM cases c
     JOIN patients p ON p.id = c.patient_id
     JOIN users patient_user ON patient_user.id = p.user_id
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     LEFT JOIN doctors d ON d.id = ca.doctor_id
     LEFT JOIN users doctor_user ON doctor_user.id = d.user_id
     WHERE c.id = $1
       AND ($2 = patient_user.id OR $2 = doctor_user.id)
     LIMIT 1`,
    [caseId, userId]
  );
  return result.rows;
};

export interface InsertMessageInput {
  caseId: string;
  senderId: string;
  receiverId: string;
  content: string;
  messageType: string;
  attachmentsJson: string | null;
}

export const insertMessage = async (input: InsertMessageInput): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type, attachments)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.caseId,
      input.senderId,
      input.receiverId,
      input.content,
      input.messageType,
      input.attachmentsJson,
    ]
  );
  return result.rows[0];
};

export const listMessages = async (
  caseId: string,
  pageSize: number,
  offset: number
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT m.*, 
            u1.email as sender_email,
            u2.email as receiver_email,
            COALESCE(p1.first_name || ' ' || p1.last_name, d1.first_name || ' ' || d1.last_name, u1.email) as sender_name,
            COALESCE(p2.first_name || ' ' || p2.last_name, d2.first_name || ' ' || d2.last_name, u2.email) as receiver_name,
            COUNT(*) OVER() AS __total_count
     FROM messages m
     JOIN users u1 ON m.sender_id = u1.id
     JOIN users u2 ON m.receiver_id = u2.id
     LEFT JOIN patients p1 ON p1.user_id = u1.id
     LEFT JOIN doctors d1 ON d1.user_id = u1.id
     LEFT JOIN patients p2 ON p2.user_id = u2.id
     LEFT JOIN doctors d2 ON d2.user_id = u2.id
     WHERE m.case_id = $1
     ORDER BY m.created_at ASC
     LIMIT $2 OFFSET $3`,
    [caseId, pageSize, offset]
  );
  return result.rows;
};

export const markMessageAsRead = async (messageId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `UPDATE messages
     SET is_read = true, read_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND receiver_id = $2
     RETURNING id`,
    [messageId, userId]
  );
  return result.rows;
};

export const deleteMessage = async (messageId: string, userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id', [
    messageId,
    userId,
  ]);
  return result.rows;
};

export const attachmentExistsForCase = async (
  caseId: string,
  filenamePattern: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT 1
     FROM messages m
     WHERE m.case_id = $1
       AND m.attachments IS NOT NULL
       AND m.attachments::text LIKE $2
     LIMIT 1`,
    [caseId, filenamePattern]
  );
  return result.rows;
};

export const findAttachmentsForCase = async (
  caseId: string,
  filenamePattern: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT attachments
     FROM messages
     WHERE case_id = $1
       AND attachments::text LIKE $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId, filenamePattern]
  );
  return result.rows;
};
