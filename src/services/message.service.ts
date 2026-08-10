import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/errorHandler';
import * as messageRepository from '../repositories/message.repository';
import { splitTotalCount } from '../utils/pagination';

export interface MessageAttachment {
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
}

const resolveUploadDir = (): string => {
  const configured = process.env.UPLOAD_DIR || './uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const assertCaseAccess = async (caseId: string, userId: string): Promise<void> => {
  const rows = await messageRepository.hasCaseAccess(caseId, userId);
  if (rows.length === 0) {
    throw new AppError('You do not have access to this case', 403);
  }
};

const assertParticipantForCase = async (caseId: string, userId: string): Promise<void> => {
  const rows = await messageRepository.hasParticipantForCase(caseId, userId);
  if (rows.length === 0) {
    throw new AppError('Receiver is not assigned to this case', 400);
  }
};

export const sendMessage = async (input: {
  caseId: unknown;
  receiverId: unknown;
  content: unknown;
  messageType?: unknown;
  senderId: string;
  attachments: MessageAttachment[] | null;
}) => {
  const { caseId, receiverId, content, messageType, senderId, attachments } = input;

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

  return messageRepository.insertMessage({
    caseId,
    senderId,
    receiverId,
    content,
    messageType: typeof messageType === 'string' ? messageType : 'text',
    attachmentsJson: attachments ? JSON.stringify(attachments) : null,
  });
};

export const getMessages = async (caseId: string, userId: string, pageSize: number, offset: number) => {
  await assertCaseAccess(caseId, userId);
  const rows = await messageRepository.listMessages(caseId, pageSize, offset);
  return splitTotalCount(rows as Array<Record<string, unknown>>);
};

export const markAsRead = async (messageId: string, userId: string): Promise<void> => {
  const rows = await messageRepository.markMessageAsRead(messageId, userId);
  if (rows.length === 0) {
    throw new AppError('Message not found', 404);
  }
};

export const deleteMessage = async (messageId: string, userId: string): Promise<void> => {
  const rows = await messageRepository.deleteMessage(messageId, userId);
  if (rows.length === 0) {
    throw new AppError('Message not found', 404);
  }
};

export const resolveAttachmentDownload = async (
  caseId: unknown,
  filename: unknown,
  userId: string
): Promise<{ filePath: string; downloadName: string }> => {
  if (typeof caseId !== 'string' || !caseId.trim()) {
    throw new AppError('caseId query parameter is required', 400);
  }

  if (typeof filename !== 'string' || !filename.trim() || filename.includes('..') || filename.includes('/')) {
    throw new AppError('Invalid attachment filename', 400);
  }

  await assertCaseAccess(caseId, userId);

  const filenamePattern = `%${filename}%`;
  const existsRows = await messageRepository.attachmentExistsForCase(caseId, filenamePattern);
  if (existsRows.length === 0) {
    throw new AppError('Attachment not found for this case', 404);
  }

  const filePath = path.join(resolveUploadDir(), filename);
  if (!fs.existsSync(filePath)) {
    throw new AppError('Attachment file not found on server', 404);
  }

  let downloadName = filename;
  const attachmentRows = await messageRepository.findAttachmentsForCase(caseId, filenamePattern);
  const attachments = attachmentRows[0]?.attachments;
  if (Array.isArray(attachments)) {
    const match = attachments.find(
      (item: { filename?: string; originalName?: string }) => item.filename === filename
    );
    if (match?.originalName) {
      downloadName = match.originalName;
    }
  }

  return { filePath, downloadName };
};
