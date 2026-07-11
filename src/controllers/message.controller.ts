import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const assertCaseAccess = async (caseId: string, userId: string): Promise<void> => {
  const accessResult = await query(
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

  if (accessResult.rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

const assertParticipantForCase = async (caseId: string, userId: string): Promise<void> => {
  const participantResult = await query(
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

  if (participantResult.rows.length === 0) {
    throw new AppError('Receiver is not assigned to this case', 400);
  }
};

export const sendMessage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId, receiverId, content, messageType } = req.body;
    const senderId = req.user!.id;

    if (typeof caseId !== 'string' || !caseId.trim()) {
      throw new AppError('caseId is required', 400);
    }

    if (typeof receiverId !== 'string' || !receiverId.trim()) {
      throw new AppError('receiverId is required', 400);
    }

    if (receiverId === senderId) {
      throw new AppError('receiverId must be another case participant', 400);
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new AppError('content is required', 400);
    }

    await assertCaseAccess(caseId, senderId);
    await assertParticipantForCase(caseId, receiverId);

    const attachments = req.files ? (req.files as Express.Multer.File[]).map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    })) : null;

    const result = await query(
      `INSERT INTO messages (case_id, sender_id, receiver_id, content, message_type, attachments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [caseId, senderId, receiverId, content, messageType || 'text', JSON.stringify(attachments)]
    );

    // Emit socket event for real-time messaging
    const io = req.app.get('io');
    io.to(`case-${caseId}`).emit('new-message', result.rows[0]);

    res.status(201).json({
      status: 'success',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const getMessages = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    await assertCaseAccess(caseId, req.user!.id);

    const result = await query(
      `SELECT m.*, 
              u1.email as sender_email,
              u2.email as receiver_email,
              COALESCE(p1.first_name || ' ' || p1.last_name, d1.first_name || ' ' || d1.last_name, u1.email) as sender_name,
              COALESCE(p2.first_name || ' ' || p2.last_name, d2.first_name || ' ' || d2.last_name, u2.email) as receiver_name
       FROM messages m
       JOIN users u1 ON m.sender_id = u1.id
       JOIN users u2 ON m.receiver_id = u2.id
       LEFT JOIN patients p1 ON p1.user_id = u1.id
       LEFT JOIN doctors d1 ON d1.user_id = u1.id
       LEFT JOIN patients p2 ON p2.user_id = u2.id
       LEFT JOIN doctors d2 ON d2.user_id = u2.id
       WHERE m.case_id = $1
       ORDER BY m.created_at ASC`,
      [caseId]
    );

    res.json({
      status: 'success',
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;

    const result = await query(
      `UPDATE messages
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND receiver_id = $2
       RETURNING id`,
      [messageId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Message not found', 404);
    }

    res.json({
      status: 'success',
      message: 'Message marked as read',
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;
    const result = await query(
      'DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id',
      [messageId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Message not found', 404);
    }

    res.json({
      status: 'success',
      message: 'Message deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

export const downloadMessageAttachment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const { caseId } = req.query;
    const userId = req.user!.id;

    if (typeof caseId !== 'string' || !caseId.trim()) {
      throw new AppError('caseId query parameter is required', 400);
    }

    if (typeof filename !== 'string' || !filename.trim() || filename.includes('..') || filename.includes('/')) {
      throw new AppError('Invalid attachment filename', 400);
    }

    await assertCaseAccess(caseId, userId);

    const attachmentResult = await query(
      `SELECT 1
       FROM messages m
       WHERE m.case_id = $1
         AND m.attachments IS NOT NULL
         AND m.attachments::text LIKE $2
       LIMIT 1`,
      [caseId, `%${filename}%`]
    );

    if (attachmentResult.rows.length === 0) {
      throw new AppError('Attachment not found for this case', 404);
    }

    const filePath = path.join(resolveUploadDir(), filename);
    if (!fs.existsSync(filePath)) {
      throw new AppError('Attachment file not found on server', 404);
    }

    const originalNameResult = await query(
      `SELECT attachments
       FROM messages
       WHERE case_id = $1
         AND attachments::text LIKE $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [caseId, `%${filename}%`]
    );

    let downloadName = filename;
    const attachments = originalNameResult.rows[0]?.attachments;
    if (Array.isArray(attachments)) {
      const match = attachments.find((item: { filename?: string; originalName?: string }) => item.filename === filename);
      if (match?.originalName) {
        downloadName = match.originalName;
      }
    }

    res.download(filePath, downloadName);
  } catch (error) {
    next(error);
  }
};
