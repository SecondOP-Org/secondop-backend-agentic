import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { renderSignupApprovalHtml } from '../services/signupApproval.service';
import * as authService from '../services/auth.service';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.register(req.body);

    if (result.status === 'pendingApproval') {
      res.status(201).json({
        status: 'success',
        message:
          'Registration received. Your account is pending approval — we will email you when it is ready.',
        data: {
          pendingApproval: true,
          user: result.user,
          emailVerificationSent: result.emailVerificationSent ?? false,
        },
      });
      return;
    }

    res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      data: {
        pendingApproval: false,
        user: result.user,
        token: result.token,
        refreshToken: result.refreshToken,
        emailVerificationSent: result.emailVerificationSent ?? false,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const approveSignup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const result = await authService.decideSignupApprovalAction(String(token || ''), 'approve');
    const acceptsHtml =
      req.method === 'GET' || String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      res
        .status(200)
        .type('html')
        .send(renderSignupApprovalHtml('approve', result));
      return;
    }
    res.status(200).json({
      status: 'success',
      message: 'Signup approved',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const rejectSignup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const result = await authService.decideSignupApprovalAction(String(token || ''), 'reject');
    const acceptsHtml =
      req.method === 'GET' || String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      res
        .status(200)
        .type('html')
        .send(renderSignupApprovalHtml('reject', result));
      return;
    }
    res.status(200).json({
      status: 'success',
      message: 'Signup rejected',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const data = await authService.login(email, password);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const loginWithPhone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.body;
    const data = await authService.loginWithPhone(phone);

    res.json({
      status: 'success',
      message: 'OTP sent successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOTP = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, otp } = req.body;
    const data = await authService.verifyOTP(userId, otp);

    res.json({
      status: 'success',
      message: 'OTP verified successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const data = await authService.refreshToken(refreshToken);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({
      status: 'success',
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const { message } = await authService.forgotPassword(email);

    res.json({
      status: 'success',
      message,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    await authService.verifyEmail(token);

    res.json({
      status: 'success',
      message: 'Email verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    await authService.resetPassword(token, newPassword);

    res.json({
      status: 'success',
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.id, currentPassword, newPassword);

    res.json({
      status: 'success',
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};
