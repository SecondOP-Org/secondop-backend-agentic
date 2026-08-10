import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as messageService from '../services/message.service';
import {
  paginationMeta,
  parsePaginationQuery,
} from '../utils/pagination';

export const sendMessage = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId, receiverId, content, messageType } = req.body;
    const senderId = req.user!.id;

    const attachments = req.files
      ? (req.files as Express.Multer.File[]).map((file) => ({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
        }))
      : null;

    const data = await messageService.sendMessage({
      caseId,
      receiverId,
      content,
      messageType,
      senderId,
      attachments,
    });

    const io = req.app.get('io');
    io.to(`case-${caseId}`).emit('new-message', data);

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getMessages = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const { page, pageSize, offset } = parsePaginationQuery(req.query);
    const { rows, total } = await messageService.getMessages(caseId, req.user!.id, pageSize, offset);

    res.json({
      status: 'success',
      data: rows,
      ...paginationMeta(page, pageSize, total),
    });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.params;
    await messageService.markAsRead(messageId, req.user!.id);

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
    await messageService.deleteMessage(messageId, req.user!.id);

    res.json({
      status: 'success',
      message: 'Message deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const downloadMessageAttachment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const { caseId } = req.query;
    const { filePath, downloadName } = await messageService.resolveAttachmentDownload(
      caseId,
      filename,
      req.user!.id
    );

    res.download(filePath, downloadName);
  } catch (error) {
    next(error);
  }
};
