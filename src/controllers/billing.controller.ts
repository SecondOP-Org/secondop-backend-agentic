import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as billingService from '../services/billing.service';

export const getSubscriptionPlans = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await billingService.getSubscriptionPlans();

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const subscribe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { planId, paymentMethodId } = req.body;
    const userId = req.user!.id;

    const data = await billingService.subscribe(userId, planId, paymentMethodId);

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const cancelSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    await billingService.cancelSubscription(userId);

    res.json({
      status: 'success',
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const data = await billingService.getSubscription(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const addPaymentMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stripePaymentMethodId, isDefault } = req.body;
    const userId = req.user!.id;

    const data = await billingService.addPaymentMethod(userId, stripePaymentMethodId, isDefault);

    res.status(201).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentMethods = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await billingService.getPaymentMethods(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deletePaymentMethod = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { paymentMethodId } = req.params;
    await billingService.deletePaymentMethod(paymentMethodId);

    res.json({
      status: 'success',
      message: 'Payment method deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getInvoices = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await billingService.getInvoices(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const data = await billingService.getPaymentHistory(userId);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const createPaymentIntent = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, currency } = req.body;

    const data = await billingService.createPaymentIntent(amount, currency);

    res.json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const handleWebhook = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const result = await billingService.handleWebhook(req.body, sig);

    res.json(result);
  } catch (error) {
    next(error);
  }
};
