import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  customerCommunicationPreferences,
  notificationLogs,
  notificationPreferences,
  notificationTemplates,
  notifications,
  orders,
  restaurants,
  tableSessions,
  tables,
} from '../db/schema.ts';
import { realtimeHub } from './realtime.ts';

export type CustomerMessageEventKey =
  | 'qr_welcome'
  | 'order_confirmation'
  | 'order_preparation'
  | 'order_delay'
  | 'food_ready'
  | 'payment_success'
  | 'goodbye_message'
  | 'feedback_request';

export interface TemplateVariables {
  restaurant_name?: string;
  table_number?: string;
  order_id?: string;
  customer_name?: string;
  estimated_time?: string;
  payment_amount?: string;
}

export const DEFAULT_CUSTOMER_TEMPLATES: {
  eventKey: CustomerMessageEventKey;
  title: string;
  messageBody: string;
  channels: string[];
}[] = [
  {
    eventKey: 'qr_welcome',
    title: 'Welcome to {{restaurant_name}}',
    messageBody:
      'Welcome {{customer_name}}! You are seated at Table {{table_number}}. Ask our AI Food Concierge for curated picks or explore the full menu anytime.',
    channels: ['in_app'],
  },
  {
    eventKey: 'order_confirmation',
    title: 'Order {{order_id}} Confirmed',
    messageBody:
      'Thank you {{customer_name}}! Your order {{order_id}} for Table {{table_number}} has been sent to the kitchen. Estimated time: {{estimated_time}}.',
    channels: ['in_app', 'browser_push'],
  },
  {
    eventKey: 'order_preparation',
    title: 'Chef Started Preparing {{order_id}}',
    messageBody:
      'Our culinary team at {{restaurant_name}} has begun preparing order {{order_id}} for Table {{table_number}}. Ready in approx. {{estimated_time}}.',
    channels: ['in_app', 'browser_push'],
  },
  {
    eventKey: 'order_delay',
    title: 'Quick Update on Order {{order_id}}',
    messageBody:
      'Apologies for the brief wait, {{customer_name}}. Order {{order_id}} is taking a few extra minutes on the hearth ({{estimated_time}}). Thank you for your patience.',
    channels: ['in_app', 'browser_push'],
  },
  {
    eventKey: 'food_ready',
    title: 'Order {{order_id}} Is Ready!',
    messageBody:
      'Great news {{customer_name}} — your dishes for order {{order_id}} are freshly plated and heading to Table {{table_number}} shortly.',
    channels: ['in_app', 'browser_push'],
  },
  {
    eventKey: 'payment_success',
    title: 'Payment Received · {{payment_amount}}',
    messageBody:
      'Thank you {{customer_name}}! Your payment of {{payment_amount}} for Table {{table_number}} at {{restaurant_name}} has been verified.',
    channels: ['in_app', 'browser_push'],
  },
  {
    eventKey: 'goodbye_message',
    title: 'Warm Farewell from {{restaurant_name}}',
    messageBody:
      'Thank you for dining with us at Table {{table_number}}, {{customer_name}}. We look forward to welcoming you back to {{restaurant_name}} soon!',
    channels: ['in_app'],
  },
  {
    eventKey: 'feedback_request',
    title: 'How Was Your Experience?',
    messageBody:
      'We value your palate, {{customer_name}}! Please spare 20 seconds to rate your meal at {{restaurant_name}}.',
    channels: ['in_app'],
  },
];

export function renderTemplateString(template: string, vars: TemplateVariables): string {
  const safeVars: Record<string, string> = {
    restaurant_name: vars.restaurant_name || 'our restaurant',
    table_number: vars.table_number || 'your table',
    order_id: vars.order_id || 'your order',
    customer_name: vars.customer_name || 'Guest',
    estimated_time: vars.estimated_time || '15 mins',
    payment_amount: vars.payment_amount || '',
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return safeVars[key] ?? '';
  });
}

function getConfiguredExternalChannels(): Record<'sms' | 'whatsapp' | 'email', boolean> {
  return {
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    whatsapp: Boolean(process.env.WHATSAPP_CLOUD_TOKEN),
    email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  };
}

export async function dispatchCustomerLifecycleMessage(params: {
  restaurantId: number;
  eventKey: CustomerMessageEventKey;
  dedupeKey: string;
  tableSessionId?: number | null;
  orderId?: number | null;
  vars: TemplateVariables;
}): Promise<{ dispatched: boolean; skippedReason?: string; title?: string; message?: string }> {
  const { restaurantId, eventKey, dedupeKey, tableSessionId, orderId, vars } = params;

  // Duplicate prevention guard
  const [existingLog] = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(eq(notificationLogs.dedupeKey, dedupeKey))
    .limit(1);

  if (existingLog) {
    return { dispatched: false, skippedReason: 'duplicate_prevented' };
  }

  const [tpl] = await db
    .select()
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.restaurantId, restaurantId),
        eq(notificationTemplates.eventKey, eventKey)
      )
    )
    .limit(1);

  if (tpl && !tpl.isEnabled) {
    return { dispatched: false, skippedReason: 'template_disabled' };
  }

  const fallbackTpl = DEFAULT_CUSTOMER_TEMPLATES.find((t) => t.eventKey === eventKey);
  const titleTemplate = tpl?.title || fallbackTpl?.title || 'Update from {{restaurant_name}}';
  const bodyTemplate = tpl?.messageBody || fallbackTpl?.messageBody || '';
  const renderedTitle = renderTemplateString(titleTemplate, vars);
  const renderedMessage = renderTemplateString(bodyTemplate, vars);

  // Check customer communication preferences if tableSessionId exists
  let commPref: typeof customerCommunicationPreferences.$inferSelect | undefined;
  let sessionRow: typeof tableSessions.$inferSelect | undefined;
  if (tableSessionId) {
    [commPref] = await db
      .select()
      .from(customerCommunicationPreferences)
      .where(eq(customerCommunicationPreferences.tableSessionId, tableSessionId))
      .limit(1);
    [sessionRow] = await db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.id, tableSessionId))
      .limit(1);
  }

  const requestedChannels = tpl?.channels?.length ? tpl.channels : ['in_app'];
  const externalConfigured = getConfiguredExternalChannels();

  for (const ch of requestedChannels) {
    const channelDedupe = `${dedupeKey}:${ch}`;
    const [dup] = await db
      .select({ id: notificationLogs.id })
      .from(notificationLogs)
      .where(eq(notificationLogs.dedupeKey, channelDedupe))
      .limit(1);
    if (dup) continue;

    let deliveryStatus = 'delivered_in_app';
    let errorDetail = '';

    if (ch === 'sms' || ch === 'whatsapp' || ch === 'email') {
      const hasConsent =
        ch === 'sms'
          ? Boolean(commPref?.smsOptIn)
          : ch === 'whatsapp'
            ? Boolean(commPref?.whatsappOptIn)
            : Boolean(commPref?.emailOptIn);

      if (!hasConsent) {
        deliveryStatus = 'suppressed_no_consent';
        errorDetail = 'Customer has not opted into this external channel.';
      } else if (!externalConfigured[ch]) {
        deliveryStatus = 'sandbox_logged';
        errorDetail = `External ${ch.toUpperCase()} provider credentials are not configured; recorded in sandbox log only.`;
      } else {
        deliveryStatus = 'sandbox_logged';
      }
    } else if (ch === 'browser_push') {
      deliveryStatus =
        commPref?.browserPushOptIn || sessionRow?.notificationConsent
          ? 'delivered_in_app'
          : 'suppressed_no_consent';
    }

    await db
      .insert(notificationLogs)
      .values({
        restaurantId,
        tableSessionId: tableSessionId ?? null,
        orderId: orderId ?? null,
        eventKey,
        dedupeKey: channelDedupe,
        recipientRole: 'customer',
        recipientName: vars.customer_name || sessionRow?.hostName || 'Table Guest',
        channel: ch,
        title: renderedTitle,
        renderedMessage,
        deliveryStatus,
        retryCount: 0,
        errorDetail,
      })
      .onConflictDoNothing();
  }

  // Always insert top-level dedupe anchor row for idempotency without duplicating in_app feed entries
  await db
    .insert(notificationLogs)
    .values({
      restaurantId,
      tableSessionId: tableSessionId ?? null,
      orderId: orderId ?? null,
      eventKey,
      dedupeKey,
      recipientRole: 'customer',
      recipientName: vars.customer_name || 'Table Guest',
      channel: requestedChannels.includes('in_app') ? 'system_anchor' : 'in_app',
      title: renderedTitle,
      renderedMessage,
      deliveryStatus: 'delivered_in_app',
      retryCount: 0,
      errorDetail: '',
    })
    .onConflictDoNothing();

  // Emit real-time personalized customer message to active table session
  if (sessionRow) {
    realtimeHub.broadcast(
      restaurantId,
      'customer_message',
      {
        id: Date.now(),
        restaurantId,
        tableSessionId,
        orderId: orderId ?? null,
        eventKey,
        dedupeKey,
        recipientRole: 'customer',
        recipientName: vars.customer_name || sessionRow.hostName || 'Table Guest',
        channel: 'in_app',
        title: renderedTitle,
        renderedMessage,
        message: renderedMessage,
        deliveryStatus: 'delivered_in_app',
        retryCount: 0,
        errorDetail: '',
        createdAt: new Date().toISOString(),
      },
      sessionRow.sessionToken
    );
  }

  return { dispatched: true, title: renderedTitle, message: renderedMessage };
}

export async function dispatchStaffNotification(params: {
  restaurantId: number;
  targetRole: 'kitchen' | 'waiter' | 'manager' | 'owner' | 'cashier' | 'all';
  eventKey: string;
  dedupeKey?: string;
  title: string;
  message: string;
  linkTarget?: string;
  orderId?: number | null;
}): Promise<boolean> {
  const { restaurantId, targetRole, eventKey, dedupeKey, title, message, linkTarget = '', orderId } = params;
  const effectiveDedupe = dedupeKey || `${eventKey}:${targetRole}:${restaurantId}:${Date.now()}:${Math.random()}`;

  if (dedupeKey) {
    const [existing] = await db
      .select({ id: notificationLogs.id })
      .from(notificationLogs)
      .where(eq(notificationLogs.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) return false;
  }

  const [pref] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.restaurantId, restaurantId),
        eq(notificationPreferences.targetRole, targetRole)
      )
    )
    .limit(1);

  if (pref) {
    if (!pref.inAppEnabled) return false;
    if (pref.mutedEventTypes.includes(eventKey)) return false;
  }

  await db.insert(notifications).values({
    restaurantId,
    targetRole,
    type: eventKey,
    title,
    message,
    linkTarget,
    isRead: false,
  });

  await db
    .insert(notificationLogs)
    .values({
      restaurantId,
      orderId: orderId ?? null,
      eventKey,
      dedupeKey: effectiveDedupe,
      recipientRole: targetRole,
      recipientName: `${targetRole} team`,
      channel: 'in_app',
      title,
      renderedMessage: message,
      deliveryStatus: 'delivered_in_app',
      retryCount: 0,
      errorDetail: '',
    })
    .onConflictDoNothing();

  realtimeHub.broadcast(restaurantId, 'notification:created', {
    targetRole,
    eventKey,
    title,
    message,
    linkTarget,
  });

  return true;
}

export async function checkAndNotifyDelayedOrders(restaurantId: number): Promise<number> {
  const activeOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        inArray(orders.status, ['Pending', 'Confirmed', 'Accepted', 'Preparing', 'Cooking'])
      )
    )
    .orderBy(desc(orders.createdAt));

  if (!activeOrders.length) return 0;

  const [rest] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tableRows = await db.select().from(tables).where(eq(tables.restaurantId, restaurantId));
  const tableMap = new Map(tableRows.map((t) => [t.id, t.tableNumber]));

  const now = Date.now();
  let alerted = 0;

  for (const ord of activeOrders) {
    const elapsedMin = Math.floor((now - ord.createdAt.getTime()) / 60000);
    if (elapsedMin > ord.estimatedPrepMinutes) {
      const tableNum = ord.tableId ? tableMap.get(ord.tableId) || `T-${ord.tableId}` : 'Takeaway';
      const created = await dispatchStaffNotification({
        restaurantId,
        targetRole: 'manager',
        eventKey: 'order_delayed',
        dedupeKey: `order_delayed_staff:${ord.id}`,
        title: `Delayed Order Alert: ${ord.orderNumber}`,
        message: `${tableNum} order is ${elapsedMin}m old (target ${ord.estimatedPrepMinutes}m).`,
        linkTarget: 'orders',
        orderId: ord.id,
      });

      if (created) alerted++;

      if (ord.tableSessionId) {
        await dispatchCustomerLifecycleMessage({
          restaurantId,
          eventKey: 'order_delay',
          dedupeKey: `customer_order_delay:${ord.id}`,
          tableSessionId: ord.tableSessionId,
          orderId: ord.id,
          vars: {
            restaurant_name: rest?.name,
            table_number: tableNum,
            order_id: ord.orderNumber,
            customer_name: ord.customerName,
            estimated_time: `${Math.max(5, ord.estimatedPrepMinutes + 8 - elapsedMin)} mins`,
          },
        });
      }
    }
  }

  return alerted;
}
