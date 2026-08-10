import Stripe from 'stripe';
import { AppError } from '../middleware/errorHandler';
import * as billingRepository from '../repositories/billing.repository';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export const getSubscriptionPlans = async () => {
  return billingRepository.findActiveSubscriptionPlans();
};

export const subscribe = async (userId: string, planId: string, paymentMethodId: string) => {
  const planResult = await billingRepository.findSubscriptionPlanById(planId);
  if (planResult.length === 0) {
    throw new AppError('Plan not found', 404);
  }

  const plan = planResult[0];

  const subscription = await stripe.subscriptions.create({
    customer: paymentMethodId,
    items: [{ price: plan.stripe_price_id }],
  });

  return billingRepository.insertUserSubscription({
    userId,
    planId,
    stripeSubscriptionId: subscription.id,
    status: 'active',
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });
};

export const cancelSubscription = async (userId: string) => {
  const subResult = await billingRepository.findActiveUserSubscription(userId);

  if (subResult.length === 0) {
    throw new AppError('No active subscription found', 404);
  }

  const subscription = subResult[0];
  await stripe.subscriptions.cancel(subscription.stripe_subscription_id);

  await billingRepository.cancelUserSubscription(subscription.id);
};

export const getSubscription = async (userId: string) => {
  const rows = await billingRepository.findActiveUserSubscriptionWithPlan(userId);
  return rows[0] || null;
};

export const addPaymentMethod = async (
  userId: string,
  stripePaymentMethodId: string,
  isDefault?: boolean
) => {
  return billingRepository.insertPaymentMethod({
    userId,
    stripePaymentMethodId,
    isDefault: isDefault || false,
  });
};

export const getPaymentMethods = async (userId: string) => {
  return billingRepository.findPaymentMethodsByUserId(userId);
};

export const deletePaymentMethod = async (paymentMethodId: string) => {
  await billingRepository.deletePaymentMethod(paymentMethodId);
};

export const getInvoices = async (userId: string) => {
  return billingRepository.findInvoicesByUserId(userId);
};

export const getPaymentHistory = async (userId: string) => {
  return billingRepository.findPaymentsByUserId(userId);
};

export const createPaymentIntent = async (amount: number, currency?: string) => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: currency || 'usd',
  });

  return {
    clientSecret: paymentIntent.client_secret,
  };
};

export const handleWebhook = async (body: Buffer, signature: string) => {
  const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);

  switch (event.type) {
    case 'payment_intent.succeeded':
      break;
    case 'customer.subscription.updated':
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return { received: true };
};
