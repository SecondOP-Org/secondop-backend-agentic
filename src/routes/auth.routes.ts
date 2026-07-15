import { Router } from 'express';
import {
  register,
  login,
  loginWithPhone,
  verifyOTP,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Public routes
router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.post('/login/phone', authRateLimiter, loginWithPhone);
router.post('/verify-otp', authRateLimiter, verifyOTP);
router.post('/verify-email', authRateLimiter, verifyEmail);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', authRateLimiter, resetPassword);

// Protected routes
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePassword);

export default router;

