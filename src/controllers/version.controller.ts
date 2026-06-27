import { Request, Response } from 'express';
import { getReleaseMetadata } from '../config/releaseMetadata';

export const buildHealthResponse = () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: getReleaseMetadata(),
});

export const getVersion = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'success',
    data: getReleaseMetadata(),
  });
};
