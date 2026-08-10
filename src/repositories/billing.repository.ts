import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findActiveSubscriptionPlans = async (): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price ASC');
  return result.rows;
};

export const findSubscriptionPlanById = async (planId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
  return result.rows;
};

export interface InsertUserSubscriptionInput {
  userId: string;
  planId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export const insertUserSubscription = async (
  input: InsertUserSubscriptionInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO user_subscriptions (user_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.userId,
      input.planId,
      input.stripeSubscriptionId,
      input.status,
      input.currentPeriodStart,
      input.currentPeriodEnd,
    ]
  );
  return result.rows[0];
};

export const findActiveUserSubscription = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM user_subscriptions WHERE user_id = $1 AND status = $2',
    [userId, 'active']
  );
  return result.rows;
};

export const cancelUserSubscription = async (subscriptionId: string): Promise<void> => {
  await dbQuery(
    'UPDATE user_subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    ['cancelled', subscriptionId]
  );
};

export const findActiveUserSubscriptionWithPlan = async (
  userId: string
): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT us.*, sp.name as plan_name, sp.price, sp.features
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'`,
    [userId]
  );
  return result.rows;
};

export interface InsertPaymentMethodInput {
  userId: string;
  stripePaymentMethodId: string;
  isDefault: boolean;
}

export const insertPaymentMethod = async (
  input: InsertPaymentMethodInput
): Promise<QueryResultRow> => {
  const result = await dbQuery(
    `INSERT INTO payment_methods (user_id, stripe_payment_method_id, is_default)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.userId, input.stripePaymentMethodId, input.isDefault]
  );
  return result.rows[0];
};

export const findPaymentMethodsByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery('SELECT * FROM payment_methods WHERE user_id = $1', [userId]);
  return result.rows;
};

export const deletePaymentMethod = async (paymentMethodId: string): Promise<void> => {
  await dbQuery('DELETE FROM payment_methods WHERE id = $1', [paymentMethodId]);
};

export const findInvoicesByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
};

export const findPaymentsByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
};
