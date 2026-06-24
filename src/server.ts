import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestIdMiddleware } from './middleware/requestId';
import logger from './utils/logger';
import { closePool, initializeDatabase } from './database/connection';
import { query } from './database/connection';
import { analysisWorker } from './services/analysisWorker.service';
import { initializePhoenixObservability } from './observability/phoenix.service';

// Import routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import caseRoutes from './routes/case.routes';
import messageRoutes from './routes/message.routes';
import fileRoutes from './routes/file.routes';
import healthMetricsRoutes from './routes/healthMetrics.routes';
import prescriptionRoutes from './routes/prescription.routes';
import labResultsRoutes from './routes/labResults.routes';
import billingRoutes from './routes/billing.routes';
import appointmentRoutes from './routes/appointment.routes';
import doctorRoutes from './routes/doctor.routes';
import commandCenterRoutes from './routes/commandCenter.routes';

// Load environment variables
dotenv.config();
initializePhoenixObservability();

const app: Application = express();
const httpServer = createServer(app);
app.set('trust proxy', 1);

// Initialize Socket.IO
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
    credentials: true,
  },
});

interface SocketTokenPayload {
  id: string;
  email: string;
  type: 'patient' | 'doctor';
}

interface SocketUser {
  id: string;
  email: string;
  type: 'patient' | 'doctor';
}

const canAccessCase = async (caseId: string, userId: string): Promise<boolean> => {
  const result = await query(
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

  return result.rows.length > 0;
};

io.use(async (socket, next) => {
  try {
    const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
    const headerValue = socket.handshake.headers.authorization;
    const headerToken = typeof headerValue === 'string' && headerValue.startsWith('Bearer ')
      ? headerValue.slice('Bearer '.length)
      : null;
    const token = authToken || headerToken;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as SocketTokenPayload;
    const userResult = await query(
      `SELECT id, email, user_type
       FROM users
       WHERE id = $1 AND is_active = true
       LIMIT 1`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return next(new Error('Account is unavailable'));
    }

    const user = userResult.rows[0] as { id: string; email: string | null; user_type: 'patient' | 'doctor' };
    socket.data.user = {
      id: user.id,
      email: user.email || decoded.email,
      type: user.user_type,
    } as SocketUser;

    next();
  } catch (_error) {
    return next(new Error('Invalid token'));
  }
});

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  credentials: true,
}));
app.use(requestIdMiddleware);
morgan.token('request-id', (req) => (req as express.Request).requestId || '-');
app.use(
  morgan(
    ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" requestId=:request-id',
    {
      stream: { write: (message) => logger.info(message.trim()) },
    }
  )
);
app.use(compression()); // Compress responses
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
app.use('/api', rateLimiter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
const API_VERSION = process.env.API_VERSION || 'v1';
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/users`, userRoutes);
app.use(`/api/${API_VERSION}/cases`, caseRoutes);
app.use(`/api/${API_VERSION}/messages`, messageRoutes);
app.use(`/api/${API_VERSION}/files`, fileRoutes);
app.use(`/api/${API_VERSION}/health-metrics`, healthMetricsRoutes);
app.use(`/api/${API_VERSION}/prescriptions`, prescriptionRoutes);
app.use(`/api/${API_VERSION}/lab-results`, labResultsRoutes);
app.use(`/api/${API_VERSION}/billing`, billingRoutes);
app.use(`/api/${API_VERSION}/appointments`, appointmentRoutes);
app.use(`/api/${API_VERSION}/doctors`, doctorRoutes);
app.use(`/api/${API_VERSION}/admin/command-center`, commandCenterRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join-room', async (roomId: string) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('socket-error', { message: 'Invalid room ID' });
      return;
    }

    const socketUser = socket.data.user as SocketUser | undefined;
    if (!socketUser) {
      socket.emit('socket-error', { message: 'Authentication required' });
      return;
    }

    const allowed = await canAccessCase(roomId, socketUser.id);
    if (!allowed) {
      logger.warn(`Socket join denied for user ${socketUser.id} on room ${roomId}`);
      socket.emit('socket-error', { message: 'Access denied to room' });
      return;
    }

    socket.join(roomId);
    logger.info(`Socket ${socket.id} joined room ${roomId}`);
  });

  socket.on('leave-room', (roomId: string) => {
    socket.leave(roomId);
    logger.info(`Socket ${socket.id} left room ${roomId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes
app.set('io', io);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Initialize database connection
    await initializeDatabase();
    logger.info('Database connected successfully');
    await analysisWorker.recoverInterruptedJobs();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      logger.info(`API available at http://localhost:${PORT}/api/${API_VERSION}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

const shutdown = async (signal: 'SIGTERM' | 'SIGINT') => {
  logger.info(`${signal} signal received: closing services`);

  try {
    await analysisWorker.shutdown();
  } catch (error) {
    logger.error('Failed shutting down analysis worker:', error);
  }

  httpServer.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closePool();
    } catch (error) {
      logger.error('Failed closing database pool:', error);
    }
    process.exit(0);
  });
};

// Graceful shutdown
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

export { app, io };
