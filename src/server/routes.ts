import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  assistantConversations,
  assistantMessages,
  auditLogs,
  customerCommunicationPreferences,
  food3dModels,
  inventoryItems,
  invoiceItems,
  invoices,
  kitchenTasks,
  menuAddons,
  menuCategories,
  menuItems,
  menuVariants,
  notificationLogs,
  notificationPreferences,
  notificationTemplates,
  notifications,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  recipeIngredients,
  recipes,
  recommendationItems,
  reservations,
  restaurantMembers,
  restaurants,
  reviews,
  serviceRequests,
  staffShifts,
  stockTransactions,
  tableSessions,
  tables,
  users,
  voiceOrderSessions,
} from '../db/schema.ts';
import {
  requireAuth,
  requireRoles,
  resolveAuthFromRequest,
  signSandboxToken,
  type AuthRequest,
} from '../middleware/auth.ts';
import {
  calculateLineTotalCents,
  calculateOrderTotals,
  canCancelOrder,
} from '../shared/calculations.ts';
import type { OrderStatus, RoleCode, TableStatus } from '../shared/types.ts';
import {
  generateAiFoodRecommendations,
  parseVoiceFoodOrder,
  runOwnerAiAssistant,
} from './ai.ts';
import {
  checkAndNotifyDelayedOrders,
  dispatchCustomerLifecycleMessage,
  dispatchStaffNotification,
} from './notifications.ts';
import { realtimeHub } from './realtime.ts';

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'embertable_sandbox_hmac_secret';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'embertable_webhook_hmac_secret';

// Sliding-window rate limiter for sensitive endpoints
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

async function writeAuditLog(params: {
  restaurantId?: number | null;
  actorUserId?: number | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string | number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      restaurantId: params.restaurantId ?? null,
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail || 'guest',
      actorRole: params.actorRole || 'customer',
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      metadata: params.metadata || {},
      ipAddress: params.ipAddress || '',
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

async function hydrateOrders(orderRows: (typeof orders.$inferSelect)[], restaurantId: number) {
  if (!orderRows.length) return [];
  const orderIds = orderRows.map((o) => o.id);
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
  const tableRows = await db
    .select()
    .from(tables)
    .where(eq(tables.restaurantId, restaurantId));
  const tableMap = new Map(tableRows.map((t) => [t.id, t.tableNumber]));

  return orderRows.map((o) => ({
    ...o,
    tableNumber: o.tableId ? tableMap.get(o.tableId) || `T-${o.tableId}` : 'Takeaway',
    createdAt: o.createdAt.toISOString(),
    acceptedAt: o.acceptedAt ? o.acceptedAt.toISOString() : null,
    cookingAt: o.cookingAt ? o.cookingAt.toISOString() : null,
    readyAt: o.readyAt ? o.readyAt.toISOString() : null,
    servedAt: o.servedAt ? o.servedAt.toISOString() : null,
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    items: items.filter((i) => i.orderId === o.id),
  }));
}

export function createApiRouter() {
  const router = express.Router();

  // Health Check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'EmberTable API' });
  });

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & SANDBOX ROLE ACCESS
  // ---------------------------------------------------------------------------
  router.get('/auth/me', async (req: AuthRequest, res) => {
    const ctx = await resolveAuthFromRequest(req);
    if (!ctx) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(ctx);
  });

  router.post('/auth/sandbox-login', rateLimit(30, 60_000), async (req, res) => {
    const schema = z.object({
      role: z.enum(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier', 'customer']),
      restaurantId: z.number().int().positive().default(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid role or restaurantId' });
    }

    const { role, restaurantId } = parsed.data;
    const roleProfileMap: Record<RoleCode, { email: string; name: string; uid: string }> = {
      super_admin: { email: 'aarav.mehta@saffronhearth.in', name: 'Aarav Mehta (Super Admin)', uid: 'demo-owner-saffron' },
      owner: { email: 'aarav.mehta@saffronhearth.in', name: 'Aarav Mehta (Owner)', uid: 'demo-owner-saffron' },
      manager: { email: 'kavya.nair@saffronhearth.in', name: 'Kavya Nair (Manager)', uid: 'demo-manager-saffron' },
      kitchen: { email: 'chef.rohan@saffronhearth.in', name: 'Chef Rohan Verma (Kitchen)', uid: 'demo-kitchen-saffron' },
      waiter: { email: 'dev.kapoor@saffronhearth.in', name: 'Dev Kapoor (Waiter)', uid: 'demo-waiter-saffron' },
      cashier: { email: 'meera.iyer@saffronhearth.in', name: 'Meera Iyer (Cashier)', uid: 'demo-cashier-saffron' },
      customer: { email: 'guest@embertable.in', name: 'Diner Guest', uid: 'demo-customer-guest' },
    };

    const profile = roleProfileMap[role];
    const [dbUser] = await db.select().from(users).where(eq(users.uid, profile.uid)).limit(1);

    const payload = {
      userId: dbUser?.id || 1,
      uid: profile.uid,
      email: profile.email,
      fullName: profile.name,
      role,
      isSuperAdmin: role === 'super_admin',
      restaurantId,
      isSandbox: true,
    };

    const token = signSandboxToken(payload);
    await writeAuditLog({
      restaurantId,
      actorUserId: payload.userId,
      actorEmail: payload.email,
      actorRole: role,
      action: 'SANDBOX_ROLE_LOGIN',
      entityType: 'session',
      entityId: payload.uid,
      ipAddress: req.ip,
    });

    res.json({ ...payload, token });
  });

  // ---------------------------------------------------------------------------
  // PUBLIC RESTAURANT & DIGITAL MENU ROUTES
  // ---------------------------------------------------------------------------
  router.get('/restaurants', async (_req, res) => {
    try {
      const list = await db.select().from(restaurants).where(eq(restaurants.isActive, true));
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load restaurants' });
    }
  });

  router.get('/restaurants/:slug', async (req, res) => {
    try {
      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.slug, req.params.slug))
        .limit(1);
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });
      res.json(rest);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load restaurant' });
    }
  });

  router.get('/restaurants/:slug/menu', async (req, res) => {
    try {
      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.slug, req.params.slug))
        .limit(1);
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

      const categories = await db
        .select()
        .from(menuCategories)
        .where(and(eq(menuCategories.restaurantId, rest.id), eq(menuCategories.isActive, true)))
        .orderBy(menuCategories.sortOrder);

      const items = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.restaurantId, rest.id))
        .orderBy(menuItems.sortOrder);

      const itemIds = items.map((i) => i.id);
      const variants = itemIds.length
        ? await db.select().from(menuVariants).where(inArray(menuVariants.menuItemId, itemIds))
        : [];
      const addons = itemIds.length
        ? await db.select().from(menuAddons).where(inArray(menuAddons.menuItemId, itemIds))
        : [];

      res.json({
        restaurant: rest,
        categories,
        items: items.map((item) => ({
          ...item,
          variants: variants.filter((v) => v.menuItemId === item.id),
          addons: addons.filter((a) => a.menuItemId === item.id),
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch menu' });
    }
  });

  // ---------------------------------------------------------------------------
  // SECURE QR CODE IDENTIFICATION & COLLABORATIVE TABLE SESSION
  // ---------------------------------------------------------------------------
  router.get('/qr/:qrToken', async (req, res) => {
    try {
      const [table] = await db
        .select()
        .from(tables)
        .where(eq(tables.qrToken, req.params.qrToken))
        .limit(1);
      if (!table) {
        return res.status(404).json({ error: 'Invalid or expired QR code. Please request a fresh table QR.' });
      }

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, table.restaurantId))
        .limit(1);
      if (!rest || !rest.isActive) {
        return res.status(404).json({ error: 'Restaurant is currently inactive.' });
      }

      // Find or create active table session
      let [session] = await db
        .select()
        .from(tableSessions)
        .where(and(eq(tableSessions.tableId, table.id), eq(tableSessions.status, 'active')))
        .orderBy(desc(tableSessions.openedAt))
        .limit(1);

      if (!session) {
        const sessionToken = crypto.randomBytes(16).toString('hex');
        const guestName = String(req.query.guest || 'Guest 1').slice(0, 40);
        const [created] = await db
          .insert(tableSessions)
          .values({
            restaurantId: rest.id,
            tableId: table.id,
            sessionToken,
            guestCount: table.currentGuestCount > 0 ? table.currentGuestCount : 2,
            hostName: guestName,
            participants: [{ id: crypto.randomUUID(), name: guestName, joinedAt: new Date().toISOString() }],
            status: 'active',
          })
          .returning();
        session = created;

        await db
          .update(tables)
          .set({
            activeSessionId: session.id,
            status: table.status === 'Available' ? 'Occupied' : table.status,
            currentGuestCount: session.guestCount,
            updatedAt: new Date(),
          })
          .where(eq(tables.id, table.id));

        realtimeHub.broadcast(rest.id, 'table:updated', { tableId: table.id, status: 'Occupied' });
      }

      // Send personalized welcome message at most once per table session
      if (!session.welcomeShownAt) {
        await dispatchCustomerLifecycleMessage({
          restaurantId: rest.id,
          eventKey: 'qr_welcome',
          dedupeKey: `qr_welcome:${session.id}`,
          tableSessionId: session.id,
          vars: {
            restaurant_name: rest.name,
            table_number: table.tableNumber,
            customer_name: session.hostName,
          },
        });
        const [stamped] = await db
          .update(tableSessions)
          .set({ welcomeShownAt: new Date() })
          .where(eq(tableSessions.id, session.id))
          .returning();
        if (stamped) session = stamped;
      }

      res.json({
        restaurant: rest,
        table,
        session: {
          ...session,
          welcomeShownAt: session.welcomeShownAt ? session.welcomeShownAt.toISOString() : null,
          goodbyeShownAt: session.goodbyeShownAt ? session.goodbyeShownAt.toISOString() : null,
          openedAt: session.openedAt.toISOString(),
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to resolve table QR session' });
    }
  });

  router.post('/sessions/:sessionToken/join', async (req, res) => {
    const schema = z.object({ participantName: z.string().min(1).max(40) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Name is required' });

    try {
      const [session] = await db
        .select()
        .from(tableSessions)
        .where(eq(tableSessions.sessionToken, req.params.sessionToken))
        .limit(1);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const existing = session.participants || [];
      const already = existing.find(
        (p) => p.name.toLowerCase() === parsed.data.participantName.trim().toLowerCase()
      );
      const updatedParticipants = already
        ? existing
        : [
            ...existing,
            {
              id: crypto.randomUUID(),
              name: parsed.data.participantName.trim(),
              joinedAt: new Date().toISOString(),
            },
          ];

      const [updated] = await db
        .update(tableSessions)
        .set({
          participants: updatedParticipants,
          guestCount: Math.max(session.guestCount, updatedParticipants.length),
        })
        .where(eq(tableSessions.id, session.id))
        .returning();

      realtimeHub.broadcast(session.restaurantId, 'session:updated', updated, session.sessionToken);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to join table session' });
    }
  });

  router.get('/sessions/:sessionToken/orders', async (req, res) => {
    try {
      const [session] = await db
        .select()
        .from(tableSessions)
        .where(eq(tableSessions.sessionToken, req.params.sessionToken))
        .limit(1);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const orderRows = await db
        .select()
        .from(orders)
        .where(eq(orders.tableSessionId, session.id))
        .orderBy(desc(orders.createdAt));

      const hydrated = await hydrateOrders(orderRows, session.restaurantId);
      res.json(hydrated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load session orders' });
    }
  });

  // ---------------------------------------------------------------------------
  // ORDER MANAGEMENT ENGINE (TRANSACTIONAL, SERVER-PRICED, IDEMPOTENT)
  // ---------------------------------------------------------------------------
  const createOrderSchema = z.object({
    restaurantId: z.number().int().positive(),
    tableSessionToken: z.string().optional(),
    customerName: z.string().min(1).max(80).default('Table Guest'),
    guestCount: z.number().int().min(1).max(25).default(2),
    idempotencyKey: z.string().min(8).max(120),
    discountCode: z.string().max(32).optional(),
    notes: z.string().max(400).optional(),
    priority: z.enum(['normal', 'rush', 'vip']).default('normal'),
    items: z
      .array(
        z.object({
          menuItemId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(30),
          variantName: z.string().max(60).optional(),
          addonNames: z.array(z.string().max(80)).default([]),
          spiceLevel: z.enum(['Mild', 'Medium', 'Hot']).default('Medium'),
          specialInstructions: z.string().max(240).default(''),
        })
      )
      .min(1),
  });

  router.post('/orders', rateLimit(30, 60_000), async (req: AuthRequest, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid order payload', details: parsed.error.flatten() });
    }

    const body = parsed.data;

    try {
      // Idempotency duplicate submission guard
      const [existingOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, body.idempotencyKey))
        .limit(1);
      if (existingOrder) {
        const hydrated = await hydrateOrders([existingOrder], existingOrder.restaurantId);
        return res.status(200).json(hydrated[0]);
      }

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, body.restaurantId))
        .limit(1);
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

      // Validate table session if supplied (never accept raw unverified tableId from customer)
      let tableId: number | null = null;
      let tableSessionId: number | null = null;
      let tableNumber = 'Takeaway';
      if (body.tableSessionToken) {
        const [session] = await db
          .select()
          .from(tableSessions)
          .where(
            and(
              eq(tableSessions.sessionToken, body.tableSessionToken),
              eq(tableSessions.restaurantId, rest.id)
            )
          )
          .limit(1);
        if (!session) {
          return res.status(403).json({ error: 'Invalid table session for this restaurant.' });
        }
        tableId = session.tableId;
        tableSessionId = session.id;
        const [tbl] = await db.select().from(tables).where(eq(tables.id, session.tableId)).limit(1);
        if (tbl) tableNumber = tbl.tableNumber;
      }

      // Fetch authoritative menu items, variants, addons strictly for this restaurant
      const itemIds = body.items.map((i) => i.menuItemId);
      const dbItems = await db
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, rest.id), inArray(menuItems.id, itemIds)));

      const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));
      const dbVariants = await db
        .select()
        .from(menuVariants)
        .where(inArray(menuVariants.menuItemId, itemIds));
      const dbAddons = await db
        .select()
        .from(menuAddons)
        .where(inArray(menuAddons.menuItemId, itemIds));

      const lineDrafts = body.items.map((reqItem) => {
        const dbItem = dbItemMap.get(reqItem.menuItemId);
        if (!dbItem) {
          throw new Error(`MENU_ITEM_INVALID:${reqItem.menuItemId}`);
        }
        if (!dbItem.isAvailable) {
          throw new Error(`MENU_ITEM_UNAVAILABLE:${dbItem.name}`);
        }

        const variant = dbVariants.find(
          (v) => v.menuItemId === dbItem.id && v.name === (reqItem.variantName || 'Regular')
        );
        const variantDelta = variant ? variant.priceDeltaCents : 0;

        const chosenAddons = reqItem.addonNames
          .map((aName) => dbAddons.find((a) => a.menuItemId === dbItem.id && a.name === aName && a.isAvailable))
          .filter((a): a is NonNullable<typeof a> => Boolean(a))
          .map((a) => ({ name: a.name, priceCents: a.priceCents }));

        const lineTotalCents = calculateLineTotalCents({
          unitPriceCents: dbItem.basePriceCents,
          variantPriceDeltaCents: variantDelta,
          addons: chosenAddons,
          quantity: reqItem.quantity,
        });

        return {
          menuItemId: dbItem.id,
          itemName: dbItem.name,
          quantity: reqItem.quantity,
          unitPriceCents: dbItem.basePriceCents,
          variantName: variant ? variant.name : 'Regular',
          variantPriceDeltaCents: variantDelta,
          addons: chosenAddons,
          spiceLevel: reqItem.spiceLevel,
          specialInstructions: reqItem.specialInstructions,
          lineTotalCents,
          prepTimeMinutes: dbItem.prepTimeMinutes,
        };
      });

      const pricing = calculateOrderTotals({
        items: lineDrafts,
        taxRatePercent: rest.taxRatePercent,
        serviceChargePercent: rest.serviceChargePercent,
        discountCode: body.discountCode,
      });

      const maxPrep = Math.max(...lineDrafts.map((l) => l.prepTimeMinutes), 12);
      const orderNumber = `ORD-${Math.floor(1050 + Math.random() * 8900)}`;

      const createdOrder = await db.transaction(async (tx) => {
        const [ord] = await tx
          .insert(orders)
          .values({
            restaurantId: rest.id,
            tableId,
            tableSessionId,
            orderNumber,
            customerName: body.customerName,
            guestCount: body.guestCount,
            idempotencyKey: body.idempotencyKey,
            status: 'Pending',
            priority: body.priority,
            subtotalCents: pricing.subtotalCents,
            taxCents: pricing.taxCents,
            serviceChargeCents: pricing.serviceChargeCents,
            discountCents: pricing.discountCents,
            discountCode: (body.discountCode || '').toUpperCase(),
            totalCents: pricing.totalCents,
            estimatedPrepMinutes: maxPrep,
            notes: body.notes || '',
          })
          .returning();

        const insertedItems = await tx
          .insert(orderItems)
          .values(
            lineDrafts.map((l) => ({
              orderId: ord.id,
              menuItemId: l.menuItemId,
              itemName: l.itemName,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              variantName: l.variantName,
              variantPriceDeltaCents: l.variantPriceDeltaCents,
              addons: l.addons,
              spiceLevel: l.spiceLevel,
              specialInstructions: l.specialInstructions,
              lineTotalCents: l.lineTotalCents,
              kitchenStatus: 'Pending',
            }))
          )
          .returning();

        await tx.insert(kitchenTasks).values(
          insertedItems.map((it) => ({
            restaurantId: rest.id,
            orderId: ord.id,
            orderItemId: it.id,
            station: 'Hearth',
            status: 'queued',
          }))
        );

        await tx.insert(orderStatusHistory).values({
          orderId: ord.id,
          fromStatus: 'Cart',
          toStatus: 'Pending',
          changedByName: body.customerName,
          note: `Submitted from ${tableNumber}`,
        });

        // Generate itemized invoice automatically
        const [inv] = await tx
          .insert(invoices)
          .values({
            restaurantId: rest.id,
            orderId: ord.id,
            tableSessionId,
            invoiceNumber: `INV-${orderNumber.replace('ORD-', '')}-${ord.id}`,
            subtotalCents: pricing.subtotalCents,
            taxCents: pricing.taxCents,
            serviceChargeCents: pricing.serviceChargeCents,
            discountCents: pricing.discountCents,
            totalCents: pricing.totalCents,
            status: 'unpaid',
          })
          .returning();

        await tx.insert(invoiceItems).values(
          lineDrafts.map((l) => ({
            invoiceId: inv.id,
            description: `${l.itemName} (${l.variantName})`,
            quantity: l.quantity,
            unitPriceCents: Math.round(l.lineTotalCents / l.quantity),
            totalCents: l.lineTotalCents,
          }))
        );

        if (tableId) {
          await tx
            .update(tables)
            .set({
              status: 'Ordering',
              currentGuestCount: body.guestCount,
              updatedAt: new Date(),
            })
            .where(eq(tables.id, tableId));
        }

        await tx.insert(notifications).values({
          restaurantId: rest.id,
          targetRole: 'kitchen',
          type: 'order_new',
          title: `New Order ${orderNumber}`,
          message: `${tableNumber} · ${insertedItems.length} dish(es) · ${body.customerName}`,
          linkTarget: 'kds',
        });

        return ord;
      });

      const [hydrated] = await hydrateOrders([createdOrder], rest.id);
      realtimeHub.broadcast(rest.id, 'order:created', hydrated);
      if (tableId) {
        realtimeHub.broadcast(rest.id, 'table:updated', { tableId, status: 'Ordering' });
      }
      realtimeHub.broadcast(rest.id, 'notification:created', {
        title: `New Order ${orderNumber}`,
        targetRole: 'kitchen',
      });

      // Smart Notifications + Personalized Order Confirmation
      await dispatchStaffNotification({
        restaurantId: rest.id,
        targetRole: 'owner',
        eventKey: 'order_new_admin',
        dedupeKey: `order_new_admin:${createdOrder.id}`,
        title: `New Order ${orderNumber}`,
        message: `${tableNumber} · ${rest.currencySymbol}${Math.round(createdOrder.totalCents / 100)} · ${body.customerName}`,
        linkTarget: 'orders',
        orderId: createdOrder.id,
      });

      if (tableSessionId) {
        await dispatchCustomerLifecycleMessage({
          restaurantId: rest.id,
          eventKey: 'order_confirmation',
          dedupeKey: `order_confirmation:${createdOrder.id}`,
          tableSessionId,
          orderId: createdOrder.id,
          vars: {
            restaurant_name: rest.name,
            table_number: tableNumber,
            order_id: orderNumber,
            customer_name: body.customerName,
            estimated_time: `${maxPrep} mins`,
          },
        });
      }

      await writeAuditLog({
        restaurantId: rest.id,
        action: 'ORDER_CREATED',
        entityType: 'order',
        entityId: createdOrder.id,
        metadata: { orderNumber, totalCents: createdOrder.totalCents, tableNumber },
        ipAddress: req.ip,
      });

      res.status(201).json(hydrated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('MENU_ITEM_INVALID:')) {
        return res.status(400).json({ error: 'Order contains an item not belonging to this restaurant.' });
      }
      if (msg.startsWith('MENU_ITEM_UNAVAILABLE:')) {
        return res.status(409).json({ error: `${msg.split(':')[1]} is currently sold out.` });
      }
      console.error('Order creation failed:', err);
      res.status(500).json({ error: 'Failed to place order' });
    }
  });

  router.get('/orders/track/:orderNumber', async (req, res) => {
    try {
      const [ord] = await db
        .select()
        .from(orders)
        .where(eq(orders.orderNumber, req.params.orderNumber))
        .limit(1);
      if (!ord) return res.status(404).json({ error: 'Order not found' });

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, ord.restaurantId))
        .limit(1);
      const [hydrated] = await hydrateOrders([ord], ord.restaurantId);
      const history = await db
        .select()
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, ord.id))
        .orderBy(orderStatusHistory.createdAt);
      const [invoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.orderId, ord.id))
        .limit(1);

      res.json({ order: hydrated, restaurant: rest, history, invoice });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to track order' });
    }
  });

  // Cancel Order (enforces restaurant cancellation policy)
  router.post('/orders/:id/cancel', async (req: AuthRequest, res) => {
    const orderId = Number(req.params.id);
    const reason = String(req.body?.reason || 'Customer requested cancellation').slice(0, 200);
    const authCtx = await resolveAuthFromRequest(req);

    try {
      const [ord] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!ord) return res.status(404).json({ error: 'Order not found' });

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, ord.restaurantId))
        .limit(1);

      const isManagerOverride =
        authCtx && (authCtx.isSuperAdmin || ['owner', 'manager'].includes(authCtx.role));

      if (!isManagerOverride) {
        const policy = canCancelOrder({
          status: ord.status,
          createdAt: ord.createdAt,
          cancellationRuleMinutes: rest?.cancellationRuleMinutes ?? 5,
        });
        if (!policy.allowed) {
          return res.status(409).json({ error: policy.reason });
        }
      }

      const [updated] = await db
        .update(orders)
        .set({
          status: 'Cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, ord.id))
        .returning();

      await db.insert(orderStatusHistory).values({
        orderId: ord.id,
        fromStatus: ord.status,
        toStatus: 'Cancelled',
        changedByName: authCtx?.fullName || ord.customerName,
        note: reason,
      });

      const [hydrated] = await hydrateOrders([updated], ord.restaurantId);
      realtimeHub.broadcast(ord.restaurantId, 'order:updated', hydrated);
      res.json(hydrated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to cancel order' });
    }
  });

  // ---------------------------------------------------------------------------
  // KITCHEN DISPLAY SYSTEM & STAFF ORDER MANAGEMENT
  // ---------------------------------------------------------------------------
  router.get(
    '/orders',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const rows = await db
          .select()
          .from(orders)
          .where(eq(orders.restaurantId, restaurantId))
          .orderBy(desc(orders.createdAt))
          .limit(80);
        const hydrated = await hydrateOrders(rows, restaurantId);
        res.json(hydrated);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load orders' });
      }
    }
  );

  router.patch(
    '/orders/:id/status',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        status: z.enum([
          'Pending',
          'Confirmed',
          'Accepted',
          'Preparing',
          'Cooking',
          'Ready',
          'Served',
          'Completed',
          'Cancelled',
        ]),
        note: z.string().max(200).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });

      const orderId = Number(req.params.id);
      const nextStatus: OrderStatus = parsed.data.status;

      try {
        const [ord] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (!ord) return res.status(404).json({ error: 'Order not found' });

        if (!req.auth!.isSuperAdmin && ord.restaurantId !== req.auth!.restaurantId) {
          return res.status(403).json({ error: 'Cross-tenant access denied' });
        }

        const [rest] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.id, ord.restaurantId))
          .limit(1);

        const now = new Date();
        const statusTimestamps: Partial<typeof orders.$inferInsert> = {
          status: nextStatus,
          updatedAt: now,
        };
        if (nextStatus === 'Accepted' && !ord.acceptedAt) statusTimestamps.acceptedAt = now;
        if ((nextStatus === 'Cooking' || nextStatus === 'Preparing') && !ord.cookingAt)
          statusTimestamps.cookingAt = now;
        if (nextStatus === 'Ready' && !ord.readyAt) statusTimestamps.readyAt = now;
        if (nextStatus === 'Served' && !ord.servedAt) statusTimestamps.servedAt = now;
        if (nextStatus === 'Completed' && !ord.completedAt) statusTimestamps.completedAt = now;

        const updatedOrder = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(orders)
            .set(statusTimestamps)
            .where(eq(orders.id, ord.id))
            .returning();

          await tx
            .update(orderItems)
            .set({ kitchenStatus: nextStatus })
            .where(eq(orderItems.orderId, ord.id));

          await tx.insert(orderStatusHistory).values({
            orderId: ord.id,
            fromStatus: ord.status,
            toStatus: nextStatus,
            changedByUserId: req.auth!.userId,
            changedByName: req.auth!.fullName,
            note: parsed.data.note || '',
          });

          // Automatic Recipe Inventory Deduction
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, ord.id));
          for (const item of items) {
            if (!item.menuItemId) continue;
            const [recipe] = await tx
              .select()
              .from(recipes)
              .where(eq(recipes.menuItemId, item.menuItemId))
              .limit(1);

            if (recipe && recipe.consumeOnStatus === nextStatus) {
              const reqIngredients = await tx
                .select()
                .from(recipeIngredients)
                .where(eq(recipeIngredients.recipeId, recipe.id));

              for (const ing of reqIngredients) {
                const [inv] = await tx
                  .select()
                  .from(inventoryItems)
                  .where(eq(inventoryItems.id, ing.inventoryItemId))
                  .limit(1);
                if (!inv) continue;

                const deduction = ing.quantityRequired * item.quantity;
                const nextStock = Number((inv.currentStock - deduction).toFixed(3));
                if (nextStock < 0 && !rest?.allowNegativeStock) {
                  throw new Error(`INSUFFICIENT_STOCK:${inv.name}`);
                }

                await tx
                  .update(inventoryItems)
                  .set({ currentStock: nextStock, updatedAt: now })
                  .where(eq(inventoryItems.id, inv.id));

                await tx.insert(stockTransactions).values({
                  restaurantId: ord.restaurantId,
                  inventoryItemId: inv.id,
                  transactionType: 'consumption',
                  quantityDelta: -deduction,
                  balanceAfter: nextStock,
                  referenceOrderId: ord.id,
                  note: `Auto-deducted for ${ord.orderNumber} (${item.itemName} × ${item.quantity})`,
                  performedByName: req.auth!.fullName,
                });

                if (nextStock <= inv.minThreshold) {
                  await tx.insert(notifications).values({
                    restaurantId: ord.restaurantId,
                    targetRole: 'manager',
                    type: 'inventory_low',
                    title: `Low Stock: ${inv.name}`,
                    message: `${nextStock} ${inv.unit} remaining (threshold ${inv.minThreshold} ${inv.unit}).`,
                    linkTarget: 'inventory',
                  });
                }
              }
            }
          }

          // Update linked table status automatically
          if (ord.tableId) {
            const tableStatusMap: Partial<Record<OrderStatus, TableStatus>> = {
              Accepted: 'Food Preparing',
              Preparing: 'Food Preparing',
              Cooking: 'Food Preparing',
              Ready: 'Ready to Serve',
              Served: 'Occupied',
              Completed: 'Available',
            };
            const mappedTableStatus = tableStatusMap[nextStatus];
            if (mappedTableStatus) {
              await tx
                .update(tables)
                .set({
                  status: mappedTableStatus,
                  currentGuestCount: mappedTableStatus === 'Available' ? 0 : undefined,
                  updatedAt: now,
                })
                .where(eq(tables.id, ord.tableId));
            }
          }

          if (nextStatus === 'Ready') {
            await tx.insert(notifications).values({
              restaurantId: ord.restaurantId,
              targetRole: 'waiter',
              type: 'order_status',
              title: `${ord.orderNumber} Ready to Serve`,
              message: `Kitchen marked ${ord.orderNumber} ready at the pass.`,
              linkTarget: 'floor',
            });
          }

          return updated;
        });

        const [hydrated] = await hydrateOrders([updatedOrder], ord.restaurantId);
        realtimeHub.broadcast(ord.restaurantId, 'order:updated', hydrated);
        if (ord.tableId) {
          realtimeHub.broadcast(ord.restaurantId, 'table:updated', { tableId: ord.tableId });
        }
        realtimeHub.broadcast(ord.restaurantId, 'inventory:updated', { orderId: ord.id });

        // Smart Customer Lifecycle Messages & Staff Alerts on Order Transitions
        const tableNum = hydrated?.tableNumber || 'Your Table';
        if (ord.tableSessionId) {
          if (nextStatus === 'Accepted' || nextStatus === 'Cooking' || nextStatus === 'Preparing') {
            await dispatchCustomerLifecycleMessage({
              restaurantId: ord.restaurantId,
              eventKey: 'order_preparation',
              dedupeKey: `order_prep:${ord.id}`,
              tableSessionId: ord.tableSessionId,
              orderId: ord.id,
              vars: {
                restaurant_name: rest?.name,
                table_number: tableNum,
                order_id: ord.orderNumber,
                customer_name: ord.customerName,
                estimated_time: `${ord.estimatedPrepMinutes} mins`,
              },
            });
          } else if (nextStatus === 'Ready') {
            await dispatchCustomerLifecycleMessage({
              restaurantId: ord.restaurantId,
              eventKey: 'food_ready',
              dedupeKey: `food_ready:${ord.id}`,
              tableSessionId: ord.tableSessionId,
              orderId: ord.id,
              vars: {
                restaurant_name: rest?.name,
                table_number: tableNum,
                order_id: ord.orderNumber,
                customer_name: ord.customerName,
                estimated_time: 'Ready now',
              },
            });
          }
        }

        if (nextStatus === 'Cancelled') {
          await dispatchStaffNotification({
            restaurantId: ord.restaurantId,
            targetRole: 'kitchen',
            eventKey: 'order_cancelled',
            dedupeKey: `order_cancelled_kds:${ord.id}`,
            title: `Order ${ord.orderNumber} Cancelled`,
            message: `${tableNum} order cancelled (${parsed.data.note || 'Staff action'}).`,
            linkTarget: 'kds',
            orderId: ord.id,
          });
        }

        await writeAuditLog({
          restaurantId: ord.restaurantId,
          actorUserId: req.auth!.userId,
          actorEmail: req.auth!.email,
          actorRole: req.auth!.role,
          action: 'ORDER_STATUS_UPDATED',
          entityType: 'order',
          entityId: ord.id,
          metadata: { from: ord.status, to: nextStatus },
          ipAddress: req.ip,
        });

        res.json(hydrated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.startsWith('INSUFFICIENT_STOCK:')) {
          return res.status(409).json({
            error: `Insufficient stock for ${msg.split(':')[1]}. Restock or enable negative stock in Settings.`,
          });
        }
        console.error('Order status update failed:', err);
        res.status(500).json({ error: 'Failed to update order status' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SERVICE REQUESTS (WAITER CALLING)
  // ---------------------------------------------------------------------------
  router.post('/service-requests', rateLimit(20, 60_000), async (req, res) => {
    const schema = z.object({
      restaurantId: z.number().int().positive(),
      tableSessionToken: z.string().min(8),
      requestType: z.enum([
        'Water',
        'Napkins',
        'Waiter Assistance',
        'Additional Plates',
        'Cutlery',
        'Bill Request',
        'Custom',
      ]),
      customMessage: z.string().max(240).default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid service request' });

    try {
      const [session] = await db
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.sessionToken, parsed.data.tableSessionToken),
            eq(tableSessions.restaurantId, parsed.data.restaurantId)
          )
        )
        .limit(1);
      if (!session) return res.status(403).json({ error: 'Invalid table session' });

      const [table] = await db.select().from(tables).where(eq(tables.id, session.tableId)).limit(1);
      if (!table) return res.status(404).json({ error: 'Table not found' });

      const [created] = await db
        .insert(serviceRequests)
        .values({
          restaurantId: parsed.data.restaurantId,
          tableId: table.id,
          tableNumber: table.tableNumber,
          requestType: parsed.data.requestType,
          customMessage: parsed.data.customMessage,
          status: 'Pending',
        })
        .returning();

      await db.insert(notifications).values({
        restaurantId: parsed.data.restaurantId,
        targetRole: 'waiter',
        type: 'service_request',
        title: `${table.tableNumber}: ${parsed.data.requestType}`,
        message: parsed.data.customMessage || `Guest at ${table.tableNumber} requested ${parsed.data.requestType}.`,
        linkTarget: 'service',
      });

      realtimeHub.broadcast(parsed.data.restaurantId, 'service_request:created', created);
      realtimeHub.broadcast(parsed.data.restaurantId, 'notification:created', {
        title: `${table.tableNumber}: ${parsed.data.requestType}`,
      });

      res.status(201).json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create service request' });
    }
  });

  router.get('/service-requests/session/:sessionToken', async (req, res) => {
    try {
      const [session] = await db
        .select()
        .from(tableSessions)
        .where(eq(tableSessions.sessionToken, req.params.sessionToken))
        .limit(1);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const rows = await db
        .select()
        .from(serviceRequests)
        .where(eq(serviceRequests.tableId, session.tableId))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(15);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load service requests' });
    }
  });

  router.get(
    '/service-requests',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const rows = await db
          .select()
          .from(serviceRequests)
          .where(eq(serviceRequests.restaurantId, restaurantId))
          .orderBy(desc(serviceRequests.createdAt));
        res.json(rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load service requests' });
      }
    }
  );

  router.patch(
    '/service-requests/:id',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        status: z.enum(['Pending', 'Acknowledged', 'In Progress', 'Completed']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });

      try {
        const [updated] = await db
          .update(serviceRequests)
          .set({
            status: parsed.data.status,
            handledByUserId: req.auth!.userId,
            handledByName: req.auth!.fullName,
            updatedAt: new Date(),
            completedAt: parsed.data.status === 'Completed' ? new Date() : null,
          })
          .where(eq(serviceRequests.id, Number(req.params.id)))
          .returning();

        if (!updated) return res.status(404).json({ error: 'Request not found' });
        realtimeHub.broadcast(updated.restaurantId, 'service_request:updated', updated);
        res.json(updated);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update service request' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // TABLES, FLOOR MANAGEMENT & QR CODE GENERATION
  // ---------------------------------------------------------------------------
  router.get(
    '/tables',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const rows = await db
          .select()
          .from(tables)
          .where(eq(tables.restaurantId, restaurantId))
          .orderBy(tables.tableNumber);
        res.json(rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch tables' });
      }
    }
  );

  // Public table QR list (returns table number & qrToken for the demo QR launcher)
  router.get('/restaurants/:slug/qr-directory', async (req, res) => {
    try {
      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.slug, req.params.slug))
        .limit(1);
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });
      const rows = await db
        .select({
          id: tables.id,
          tableNumber: tables.tableNumber,
          label: tables.label,
          zone: tables.zone,
          capacity: tables.capacity,
          status: tables.status,
          qrToken: tables.qrToken,
        })
        .from(tables)
        .where(eq(tables.restaurantId, rest.id))
        .orderBy(tables.tableNumber);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch QR directory' });
    }
  });

  router.post(
    '/tables',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive(),
        tableNumber: z.string().min(1).max(16),
        label: z.string().min(1).max(60),
        capacity: z.number().int().min(1).max(24),
        zone: z.string().min(1).max(40),
        posX: z.number().int().default(0),
        posY: z.number().int().default(0),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid table details' });

      try {
        const qrToken = crypto.randomBytes(12).toString('hex');
        const [created] = await db
          .insert(tables)
          .values({
            ...parsed.data,
            qrToken,
            status: 'Available',
          })
          .returning();
        realtimeHub.broadcast(created.restaurantId, 'table:updated', created);
        res.status(201).json(created);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create table (number may already exist)' });
      }
    }
  );

  router.patch(
    '/tables/:id',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        status: z
          .enum([
            'Available',
            'Occupied',
            'Reserved',
            'Ordering',
            'Food Preparing',
            'Ready to Serve',
            'Billing',
            'Cleaning',
          ])
          .optional(),
        currentGuestCount: z.number().int().min(0).max(24).optional(),
        label: z.string().min(1).max(60).optional(),
        capacity: z.number().int().min(1).max(24).optional(),
        zone: z.string().min(1).max(40).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid table update' });

      try {
        const [updated] = await db
          .update(tables)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(eq(tables.id, Number(req.params.id)))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Table not found' });

        realtimeHub.broadcast(updated.restaurantId, 'table:updated', updated);
        res.json(updated);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update table' });
      }
    }
  );

  router.post(
    '/tables/:id/regenerate-qr',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      try {
        const [existing] = await db
          .select()
          .from(tables)
          .where(eq(tables.id, Number(req.params.id)))
          .limit(1);
        if (!existing) return res.status(404).json({ error: 'Table not found' });

        const nextToken = crypto.randomBytes(12).toString('hex');
        const [updated] = await db
          .update(tables)
          .set({
            qrToken: nextToken,
            qrVersion: existing.qrVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(tables.id, existing.id))
          .returning();

        await writeAuditLog({
          restaurantId: existing.restaurantId,
          actorUserId: req.auth!.userId,
          actorEmail: req.auth!.email,
          actorRole: req.auth!.role,
          action: 'QR_TOKEN_REGENERATED',
          entityType: 'table',
          entityId: existing.id,
          metadata: { qrVersion: updated.qrVersion },
          ipAddress: req.ip,
        });

        realtimeHub.broadcast(existing.restaurantId, 'table:updated', updated);
        res.json(updated);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to regenerate QR code' });
      }
    }
  );

  router.get('/tables/:id/qr-image', async (req, res) => {
    try {
      const [tbl] = await db
        .select()
        .from(tables)
        .where(eq(tables.id, Number(req.params.id)))
        .limit(1);
      if (!tbl) return res.status(404).json({ error: 'Table not found' });

      const origin = String(req.query.origin || process.env.APP_URL || 'http://localhost:3000').replace(
        /\/$/,
        ''
      );
      const scanUrl = `${origin}/?qr=${tbl.qrToken}`;
      const dataUrl = await QRCode.toDataURL(scanUrl, {
        width: 512,
        margin: 2,
        color: { dark: '#1A1411', light: '#FAF8F5' },
      });
      res.json({ scanUrl, dataUrl, tableNumber: tbl.tableNumber, qrVersion: tbl.qrVersion });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to generate QR image' });
    }
  });

  // ---------------------------------------------------------------------------
  // MENU MANAGEMENT ADMIN CRUD
  // ---------------------------------------------------------------------------
  router.post(
    '/admin/menu/items',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive(),
        categoryId: z.number().int().positive(),
        name: z.string().min(2).max(100),
        description: z.string().min(4).max(400),
        basePriceCents: z.number().int().positive(),
        imageKey: z.string().default('hearth_plate'),
        isVegetarian: z.boolean().default(false),
        isVegan: z.boolean().default(false),
        isFeatured: z.boolean().default(false),
        isAvailable: z.boolean().default(true),
        prepTimeMinutes: z.number().int().min(1).max(120).default(15),
        defaultSpiceLevel: z.enum(['Mild', 'Medium', 'Hot']).default('Medium'),
        allergenCodes: z.array(z.string()).default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid menu item payload' });

      try {
        const [item] = await db.insert(menuItems).values(parsed.data).returning();
        await db
          .insert(menuVariants)
          .values([{ menuItemId: item.id, name: 'Regular', priceDeltaCents: 0, isDefault: true }]);
        res.status(201).json(item);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create menu item' });
      }
    }
  );

  router.patch(
    '/admin/menu/items/:id',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        name: z.string().min(2).max(100).optional(),
        description: z.string().min(4).max(400).optional(),
        basePriceCents: z.number().int().positive().optional(),
        isAvailable: z.boolean().optional(),
        isFeatured: z.boolean().optional(),
        prepTimeMinutes: z.number().int().min(1).max(120).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid menu update' });

      try {
        const [updated] = await db
          .update(menuItems)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(eq(menuItems.id, Number(req.params.id)))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Menu item not found' });
        res.json(updated);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update menu item' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // BILLING, INVOICES & RAZORPAY / UPI VERIFICATION
  // ---------------------------------------------------------------------------
  router.get(
    '/invoices',
    requireRoles(['super_admin', 'owner', 'manager', 'cashier', 'waiter']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const invRows = await db
          .select()
          .from(invoices)
          .where(eq(invoices.restaurantId, restaurantId))
          .orderBy(desc(invoices.issuedAt))
          .limit(60);
        const ids = invRows.map((i) => i.id);
        const items = ids.length
          ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, ids))
          : [];

        res.json(
          invRows.map((inv) => ({
            ...inv,
            issuedAt: inv.issuedAt.toISOString(),
            paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
            items: items.filter((it) => it.invoiceId === inv.id),
          }))
        );
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load invoices' });
      }
    }
  );

  router.get(
    '/payments',
    requireRoles(['super_admin', 'owner', 'manager', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const rows = await db
          .select()
          .from(payments)
          .where(eq(payments.restaurantId, restaurantId))
          .orderBy(desc(payments.createdAt))
          .limit(60);
        res.json(rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch payments' });
      }
    }
  );

  router.post('/payments/create-order', rateLimit(20, 60_000), async (req, res) => {
    const schema = z.object({
      invoiceId: z.number().int().positive(),
      paymentMethod: z.enum(['UPI', 'Razorpay Card', 'Razorpay Netbanking', 'Cash', 'Wallet']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payment order request' });

    try {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, parsed.data.invoiceId))
        .limit(1);
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
      if (inv.status === 'paid') {
        return res.status(409).json({ error: 'Invoice has already been paid. Duplicate payment prevented.' });
      }

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, inv.restaurantId))
        .limit(1);

      const providerOrderId = `order_rzp_${crypto.randomBytes(8).toString('hex')}`;
      const idempotencyKey = `pay_init_${inv.id}_${Date.now()}`;

      const [payment] = await db
        .insert(payments)
        .values({
          restaurantId: inv.restaurantId,
          invoiceId: inv.id,
          orderId: inv.orderId,
          paymentMethod: parsed.data.paymentMethod,
          amountCents: inv.totalCents,
          currency: rest?.currencyCode || 'INR',
          providerOrderId,
          status: 'created',
          idempotencyKey,
        })
        .returning();

      const amountRupees = (inv.totalCents / 100).toFixed(2);
      const upiIntentUri = `upi://pay?pa=${encodeURIComponent(
        rest?.upiVpa || 'saffronhearth@okaxis'
      )}&pn=${encodeURIComponent(rest?.upiMerchantName || 'Saffron & Hearth')}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(inv.invoiceNumber)}`;
      const upiQrDataUrl = await QRCode.toDataURL(upiIntentUri, { width: 280, margin: 1 });

      // In test/sandbox mode, also provide a deterministic sandbox payment token to verify signature server-side
      const sandboxPaymentId = `pay_rzp_${crypto.randomBytes(8).toString('hex')}`;
      const sandboxSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${providerOrderId}|${sandboxPaymentId}`)
        .digest('hex');

      res.status(201).json({
        payment,
        invoice: inv,
        providerOrderId,
        upiIntentUri,
        upiQrDataUrl,
        sandboxCheckoutPayload: {
          razorpay_order_id: providerOrderId,
          razorpay_payment_id: sandboxPaymentId,
          razorpay_signature: sandboxSignature,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create payment order' });
    }
  });

  // Server-side HMAC-SHA256 verification (never marks paid merely on redirect)
  router.post('/payments/verify', rateLimit(20, 60_000), async (req, res) => {
    const schema = z.object({
      razorpay_order_id: z.string().min(4),
      razorpay_payment_id: z.string().min(4),
      razorpay_signature: z.string().min(10),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Missing payment verification fields' });

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;
    const expectedSig = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const sigBuf = Buffer.from(razorpay_signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).json({ error: 'Payment signature verification failed. Invalid HMAC.' });
    }

    try {
      const [pay] = await db
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, razorpay_order_id))
        .limit(1);
      if (!pay) return res.status(404).json({ error: 'Payment record not found' });
      if (pay.status === 'captured') {
        return res.status(200).json({ verified: true, payment: pay, duplicateIgnored: true });
      }

      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [updatedPay] = await tx
          .update(payments)
          .set({
            providerPaymentId: razorpay_payment_id,
            providerSignature: razorpay_signature,
            webhookVerified: true,
            status: 'captured',
            reconciliationNote: 'Verified via server-side HMAC-SHA256',
            paidAt: now,
          })
          .where(eq(payments.id, pay.id))
          .returning();

        await tx
          .update(invoices)
          .set({ status: 'paid', paidAt: now })
          .where(eq(invoices.id, pay.invoiceId));

        if (pay.orderId) {
          const [ord] = await tx
            .update(orders)
            .set({ status: 'Completed', completedAt: now, updatedAt: now })
            .where(eq(orders.id, pay.orderId))
            .returning();

          if (ord?.tableId) {
            await tx
              .update(tables)
              .set({ status: 'Available', currentGuestCount: 0, activeSessionId: null, updatedAt: now })
              .where(eq(tables.id, ord.tableId));
          }

          if (ord?.tableSessionId) {
            await tx
              .update(tableSessions)
              .set({ status: 'closed', closedAt: now })
              .where(eq(tableSessions.id, ord.tableSessionId));
          }
        }

        await tx.insert(notifications).values({
          restaurantId: pay.restaurantId,
          targetRole: 'cashier',
          type: 'payment_success',
          title: 'Payment Verified',
          message: `${pay.paymentMethod} payment captured (${razorpay_payment_id}).`,
          linkTarget: 'billing',
        });

        return updatedPay;
      });

      realtimeHub.broadcast(pay.restaurantId, 'payment:verified', updated);
      realtimeHub.broadcast(pay.restaurantId, 'table:updated', { paymentId: updated.id });

      // Personalized Payment Success, Goodbye (once per session), & Feedback Request
      if (pay.orderId) {
        const [ord] = await db.select().from(orders).where(eq(orders.id, pay.orderId)).limit(1);
        const [rest] = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.id, pay.restaurantId))
          .limit(1);
        const [tbl] = ord?.tableId
          ? await db.select().from(tables).where(eq(tables.id, ord.tableId)).limit(1)
          : [];
        const tableNum = tbl?.tableNumber || (ord?.tableId ? `T-${ord.tableId}` : 'Takeaway');
        const formattedAmt = `${rest?.currencySymbol || '₹'}${(pay.amountCents / 100).toFixed(0)}`;

        await dispatchStaffNotification({
          restaurantId: pay.restaurantId,
          targetRole: 'owner',
          eventKey: 'payment_received',
          dedupeKey: `payment_owner:${pay.id}`,
          title: `Payment Received (${formattedAmt})`,
          message: `${pay.paymentMethod} verified for ${ord?.orderNumber || `Invoice #${pay.invoiceId}`}.`,
          linkTarget: 'payments',
          orderId: pay.orderId,
        });

        if (ord?.tableSessionId) {
          await dispatchCustomerLifecycleMessage({
            restaurantId: pay.restaurantId,
            eventKey: 'payment_success',
            dedupeKey: `payment_success:${pay.id}`,
            tableSessionId: ord.tableSessionId,
            orderId: ord.id,
            vars: {
              restaurant_name: rest?.name,
              table_number: tableNum,
              order_id: ord.orderNumber,
              customer_name: ord.customerName,
              payment_amount: formattedAmt,
            },
          });

          const [sess] = await db
            .select()
            .from(tableSessions)
            .where(eq(tableSessions.id, ord.tableSessionId))
            .limit(1);

          if (sess && !sess.goodbyeShownAt) {
            await dispatchCustomerLifecycleMessage({
              restaurantId: pay.restaurantId,
              eventKey: 'goodbye_message',
              dedupeKey: `goodbye_msg:${sess.id}`,
              tableSessionId: sess.id,
              orderId: ord.id,
              vars: {
                restaurant_name: rest?.name,
                table_number: tableNum,
                order_id: ord.orderNumber,
                customer_name: ord.customerName,
                payment_amount: formattedAmt,
              },
            });
            await dispatchCustomerLifecycleMessage({
              restaurantId: pay.restaurantId,
              eventKey: 'feedback_request',
              dedupeKey: `feedback_req:${sess.id}`,
              tableSessionId: sess.id,
              orderId: ord.id,
              vars: {
                restaurant_name: rest?.name,
                table_number: tableNum,
                order_id: ord.orderNumber,
                customer_name: ord.customerName,
              },
            });
            await db
              .update(tableSessions)
              .set({ goodbyeShownAt: new Date() })
              .where(eq(tableSessions.id, sess.id));
          }
        }
      }

      res.json({ verified: true, payment: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Payment verification error' });
    }
  });

  // Signed Webhook Endpoint (Razorpay Webhook Verification)
  router.post('/payments/webhook', async (req, res) => {
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expected) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const orderId = req.body?.payload?.payment?.entity?.order_id;
    const paymentId = req.body?.payload?.payment?.entity?.id;
    if (orderId && paymentId) {
      await db
        .update(payments)
        .set({
          providerPaymentId: paymentId,
          webhookVerified: true,
          status: 'captured',
          paidAt: new Date(),
        })
        .where(eq(payments.providerOrderId, orderId));
    }

    res.json({ received: true });
  });

  // ---------------------------------------------------------------------------
  // CUSTOMER REVIEWS & RESERVATIONS
  // ---------------------------------------------------------------------------
  router.get('/restaurants/:slug/reviews', async (req, res) => {
    try {
      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.slug, req.params.slug))
        .limit(1);
      if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

      const rows = await db
        .select()
        .from(reviews)
        .where(eq(reviews.restaurantId, rest.id))
        .orderBy(desc(reviews.createdAt));
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load reviews' });
    }
  });

  router.post('/reviews', rateLimit(15, 60_000), async (req, res) => {
    const schema = z.object({
      restaurantId: z.number().int().positive(),
      orderId: z.number().int().positive().nullable().optional(),
      customerName: z.string().min(2).max(60),
      overallRating: z.number().int().min(1).max(5),
      foodRating: z.number().int().min(1).max(5),
      serviceRating: z.number().int().min(1).max(5),
      experienceRating: z.number().int().min(1).max(5),
      comment: z.string().min(4).max(600),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid review payload' });

    try {
      const [created] = await db
        .insert(reviews)
        .values({
          ...parsed.data,
          orderId: parsed.data.orderId ?? null,
          isApproved: true,
        })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to submit review' });
    }
  });

  router.patch(
    '/reviews/:id',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const isApproved = Boolean(req.body?.isApproved);
      const [updated] = await db
        .update(reviews)
        .set({ isApproved })
        .where(eq(reviews.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    }
  );

  router.post('/reservations', rateLimit(15, 60_000), async (req, res) => {
    const schema = z.object({
      restaurantId: z.number().int().positive(),
      customerName: z.string().min(2).max(80),
      customerEmail: z.string().email(),
      customerPhone: z.string().min(6).max(24),
      partySize: z.number().int().min(1).max(20),
      reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reservationTime: z.string().min(4).max(10),
      preferredZone: z.string().default('Main Dining'),
      specialRequests: z.string().max(300).default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid reservation details' });

    try {
      const [created] = await db
        .insert(reservations)
        .values({ ...parsed.data, status: 'confirmed' })
        .returning();

      await db.insert(notifications).values({
        restaurantId: parsed.data.restaurantId,
        targetRole: 'manager',
        type: 'reservation_new',
        title: `New Reservation: ${parsed.data.customerName}`,
        message: `${parsed.data.partySize} guests on ${parsed.data.reservationDate} at ${parsed.data.reservationTime}`,
        linkTarget: 'reservations',
      });

      res.status(201).json(created);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create reservation' });
    }
  });

  router.get(
    '/reservations',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(reservations)
        .where(eq(reservations.restaurantId, restaurantId))
        .orderBy(desc(reservations.createdAt));
      res.json(rows);
    }
  );

  router.patch(
    '/reservations/:id',
    requireRoles(['super_admin', 'owner', 'manager', 'waiter']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        status: z.enum(['pending', 'confirmed', 'seated', 'completed', 'cancelled']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });

      const [updated] = await db
        .update(reservations)
        .set({ status: parsed.data.status })
        .where(eq(reservations.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    }
  );

  // ---------------------------------------------------------------------------
  // INVENTORY & RECIPES
  // ---------------------------------------------------------------------------
  router.get(
    '/inventory',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const items = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.restaurantId, restaurantId))
        .orderBy(inventoryItems.name);
      const txns = await db
        .select()
        .from(stockTransactions)
        .where(eq(stockTransactions.restaurantId, restaurantId))
        .orderBy(desc(stockTransactions.createdAt))
        .limit(40);
      res.json({ items, transactions: txns });
    }
  );

  router.post(
    '/inventory',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive(),
        name: z.string().min(2).max(100),
        sku: z.string().min(2).max(32),
        category: z.string().min(2).max(40),
        currentStock: z.number().min(0),
        unit: z.string().min(1).max(16),
        minThreshold: z.number().min(0),
        costPerUnitCents: z.number().int().min(0).default(0),
        supplierName: z.string().max(80).default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid inventory payload' });

      const [item] = await db.insert(inventoryItems).values(parsed.data).returning();
      res.status(201).json(item);
    }
  );

  router.post(
    '/inventory/:id/adjust',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        transactionType: z.enum(['purchase', 'adjustment', 'waste']),
        quantityDelta: z.number(),
        note: z.string().max(200).default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid stock adjustment' });

      const itemId = Number(req.params.id);
      const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
      if (!item) return res.status(404).json({ error: 'Inventory item not found' });

      const [rest] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, item.restaurantId))
        .limit(1);

      const nextStock = Number((item.currentStock + parsed.data.quantityDelta).toFixed(3));
      if (nextStock < 0 && !rest?.allowNegativeStock) {
        return res.status(409).json({ error: 'Negative stock is disallowed by restaurant policy.' });
      }

      const [updated] = await db
        .update(inventoryItems)
        .set({
          currentStock: nextStock,
          lastRestockedAt: parsed.data.transactionType === 'purchase' ? new Date() : item.lastRestockedAt,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, item.id))
        .returning();

      await db.insert(stockTransactions).values({
        restaurantId: item.restaurantId,
        inventoryItemId: item.id,
        transactionType: parsed.data.transactionType,
        quantityDelta: parsed.data.quantityDelta,
        balanceAfter: nextStock,
        note: parsed.data.note,
        performedByName: req.auth!.fullName,
      });

      realtimeHub.broadcast(item.restaurantId, 'inventory:updated', updated);
      res.json(updated);
    }
  );

  // ---------------------------------------------------------------------------
  // STAFF, SHIFTS, NOTIFICATIONS, AUDIT LOGS & SETTINGS
  // ---------------------------------------------------------------------------
  router.get(
    '/staff',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const members = await db
        .select({
          id: restaurantMembers.id,
          restaurantId: restaurantMembers.restaurantId,
          userId: restaurantMembers.userId,
          roleCode: restaurantMembers.roleCode,
          staffTitle: restaurantMembers.staffTitle,
          isActive: restaurantMembers.isActive,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
        })
        .from(restaurantMembers)
        .innerJoin(users, eq(restaurantMembers.userId, users.id))
        .where(eq(restaurantMembers.restaurantId, restaurantId));

      const shifts = await db
        .select()
        .from(staffShifts)
        .where(eq(staffShifts.restaurantId, restaurantId));

      res.json({ members, shifts });
    }
  );

  router.post(
    '/staff',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive(),
        fullName: z.string().min(2).max(80),
        email: z.string().email(),
        roleCode: z.enum(['owner', 'manager', 'kitchen', 'waiter', 'cashier']),
        staffTitle: z.string().min(2).max(60),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid staff payload' });

      const uid = `staff-${crypto.createHash('md5').update(parsed.data.email).digest('hex').slice(0, 12)}`;
      const [user] = await db
        .insert(users)
        .values({
          uid,
          email: parsed.data.email,
          fullName: parsed.data.fullName,
          activeRole: parsed.data.roleCode,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { fullName: parsed.data.fullName, activeRole: parsed.data.roleCode },
        })
        .returning();

      const [member] = await db
        .insert(restaurantMembers)
        .values({
          restaurantId: parsed.data.restaurantId,
          userId: user.id,
          roleCode: parsed.data.roleCode,
          staffTitle: parsed.data.staffTitle,
        })
        .onConflictDoUpdate({
          target: [restaurantMembers.restaurantId, restaurantMembers.userId],
          set: { roleCode: parsed.data.roleCode, staffTitle: parsed.data.staffTitle, isActive: true },
        })
        .returning();

      res.status(201).json({ ...member, fullName: user.fullName, email: user.email });
    }
  );

  router.get(
    '/notifications',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.restaurantId, restaurantId))
        .orderBy(desc(notifications.createdAt))
        .limit(30);
      res.json(rows);
    }
  );

  router.patch(
    '/notifications/:id/read',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier']),
    async (req, res) => {
      const [updated] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    }
  );

  router.get(
    '/audit-logs',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.restaurantId, restaurantId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);
      res.json(rows);
    }
  );

  router.patch(
    '/restaurants/:id/settings',
    requireRoles(['super_admin', 'owner']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        name: z.string().min(2).max(100).optional(),
        tagline: z.string().min(2).max(140).optional(),
        description: z.string().min(4).max(800).optional(),
        phone: z.string().min(5).max(30).optional(),
        address: z.string().min(4).max(160).optional(),
        taxRatePercent: z.number().min(0).max(30).optional(),
        serviceChargePercent: z.number().min(0).max(25).optional(),
        allowNegativeStock: z.boolean().optional(),
        cancellationRuleMinutes: z.number().int().min(0).max(60).optional(),
        upiVpa: z.string().min(3).max(80).optional(),
        googleReviewUrl: z.string().max(250).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid settings update' });

      const restaurantId = Number(req.params.id);
      if (!req.auth!.isSuperAdmin && restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }

      const [updated] = await db
        .update(restaurants)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(restaurants.id, restaurantId))
        .returning();

      await writeAuditLog({
        restaurantId,
        actorUserId: req.auth!.userId,
        actorEmail: req.auth!.email,
        actorRole: req.auth!.role,
        action: 'RESTAURANT_SETTINGS_UPDATED',
        entityType: 'restaurant',
        entityId: restaurantId,
        metadata: parsed.data,
        ipAddress: req.ip,
      });

      res.json(updated);
    }
  );

  // ---------------------------------------------------------------------------
  // ANALYTICS & REPORTING (REAL POSTGRESQL AGGREGATIONS + CSV EXPORT)
  // ---------------------------------------------------------------------------
  router.get(
    '/analytics/overview',
    requireRoles(['super_admin', 'owner', 'manager', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      try {
        const allOrders = await db
          .select()
          .from(orders)
          .where(eq(orders.restaurantId, restaurantId))
          .orderBy(desc(orders.createdAt));

        const allTables = await db
          .select()
          .from(tables)
          .where(eq(tables.restaurantId, restaurantId));

        const allPayments = await db
          .select()
          .from(payments)
          .where(eq(payments.restaurantId, restaurantId))
          .orderBy(desc(payments.createdAt));

        const allReviews = await db
          .select()
          .from(reviews)
          .where(eq(reviews.restaurantId, restaurantId));

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const nonCancelled = allOrders.filter((o) => o.status !== 'Cancelled');
        const todaysOrders = nonCancelled.filter((o) => o.createdAt >= todayStart);
        const activeOrders = nonCancelled.filter((o) =>
          ['Pending', 'Confirmed', 'Accepted', 'Preparing', 'Cooking', 'Ready', 'Served'].includes(
            o.status
          )
        );

        const todaysRevenueCents = todaysOrders.reduce((s, o) => s + o.totalCents, 0);
        const totalRevenueCents = nonCancelled.reduce((s, o) => s + o.totalCents, 0);
        const averageOrderValueCents = nonCancelled.length
          ? Math.round(totalRevenueCents / nonCancelled.length)
          : 0;

        const occupiedTables = allTables.filter((t) => t.status !== 'Available').length;
        const availableTables = allTables.filter((t) => t.status === 'Available').length;

        // Dish popularity from real orderItems
        const orderIds = nonCancelled.map((o) => o.id);
        const itemRows = orderIds.length
          ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
          : [];

        const dishStats = new Map<string, { name: string; count: number; revenueCents: number }>();
        for (const it of itemRows) {
          const prev = dishStats.get(it.itemName) || { name: it.itemName, count: 0, revenueCents: 0 };
          prev.count += it.quantity;
          prev.revenueCents += it.lineTotalCents;
          dishStats.set(it.itemName, prev);
        }
        const sortedDishes = Array.from(dishStats.values()).sort((a, b) => b.count - a.count);

        // Daily revenue series (last 7 days)
        const dailyMap = new Map<string, { date: string; revenue: number; orders: number }>();
        for (let d = 6; d >= 0; d--) {
          const dt = new Date(Date.now() - d * 86400000);
          const key = dt.toISOString().slice(0, 10);
          dailyMap.set(key, {
            date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            revenue: 0,
            orders: 0,
          });
        }
        for (const ord of nonCancelled) {
          const key = ord.createdAt.toISOString().slice(0, 10);
          const bucket = dailyMap.get(key);
          if (bucket) {
            bucket.revenue += Math.round(ord.totalCents / 100);
            bucket.orders += 1;
          }
        }

        // Peak business hours
        const hourBuckets = Array.from({ length: 14 }, (_, idx) => {
          const hr = idx + 11;
          return { hour: `${hr}:00`, orders: 0 };
        });
        for (const ord of nonCancelled) {
          const hr = ord.createdAt.getHours();
          const idx = hr - 11;
          if (idx >= 0 && idx < hourBuckets.length) {
            hourBuckets[idx].orders += 1;
          }
        }

        // Payment method distribution
        const payMap = new Map<string, number>();
        for (const p of allPayments.filter((x) => x.status === 'captured')) {
          payMap.set(p.paymentMethod, (payMap.get(p.paymentMethod) || 0) + Math.round(p.amountCents / 100));
        }

        // Avg prep time
        const readyOrders = nonCancelled.filter((o) => o.readyAt && o.createdAt);
        const avgPrepMinutes = readyOrders.length
          ? Math.round(
              readyOrders.reduce(
                (sum, o) => sum + (o.readyAt!.getTime() - o.createdAt.getTime()) / 60000,
                0
              ) / readyOrders.length
            )
          : 16;

        const avgRating = allReviews.length
          ? Number(
              (allReviews.reduce((s, r) => s + r.overallRating, 0) / allReviews.length).toFixed(1)
            )
          : 4.8;

        res.json({
          kpis: {
            todaysRevenueCents,
            totalRevenueCents,
            totalOrders: nonCancelled.length,
            activeOrders: activeOrders.length,
            occupiedTables,
            availableTables,
            totalTables: allTables.length,
            averageOrderValueCents,
            avgPrepMinutes,
            avgRating,
            reviewCount: allReviews.length,
          },
          dailyRevenue: Array.from(dailyMap.values()),
          peakHours: hourBuckets,
          popularDishes: sortedDishes.slice(0, 6),
          lowPerformingDishes: [...sortedDishes].reverse().slice(0, 3),
          paymentDistribution: Array.from(payMap.entries()).map(([method, amount]) => ({
            method,
            amount,
          })),
          recentTransactions: allPayments.slice(0, 8),
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load analytics' });
      }
    }
  );

  router.get(
    '/analytics/export.csv',
    requireRoles(['super_admin', 'owner', 'manager', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.restaurantId, restaurantId))
        .orderBy(desc(orders.createdAt));

      const header = 'OrderNumber,Status,Customer,GuestCount,SubtotalINR,TaxINR,ServiceChargeINR,DiscountINR,TotalINR,CreatedAt\n';
      const csv =
        header +
        rows
          .map(
            (r) =>
              `"${r.orderNumber}","${r.status}","${r.customerName.replace(/"/g, '""')}",${r.guestCount},${(
                r.subtotalCents / 100
              ).toFixed(2)},${(r.taxCents / 100).toFixed(2)},${(r.serviceChargeCents / 100).toFixed(2)},${(
                r.discountCents / 100
              ).toFixed(2)},${(r.totalCents / 100).toFixed(2)},"${r.createdAt.toISOString()}"`
          )
          .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="embertable-orders-report.csv"');
      res.send(csv);
    }
  );

  // ---------------------------------------------------------------------------
  // FEATURE 1: AI FOOD RECOMMENDATIONS AFTER QR SCAN
  // ---------------------------------------------------------------------------
  router.post('/ai/recommendations', rateLimit(20, 60_000), async (req, res) => {
    const schema = z.object({
      restaurantId: z.number().int().positive(),
      tableSessionToken: z.string().optional(),
      guestCount: z.number().int().min(1).max(20).default(2),
      budgetRupees: z.number().min(50).max(50000).default(1000),
      budgetScope: z.enum(['per_person', 'entire_table']).default('entire_table'),
      dietaryType: z.enum(['any', 'veg', 'non_veg', 'vegan']).default('any'),
      foodPreference: z.string().max(160).default(''),
      spiceLevel: z.enum(['any', 'Mild', 'Medium', 'Hot']).default('Medium'),
      allergies: z.array(z.string().max(40)).default([]),
      coursePreference: z.string().max(60).default('complete_meal'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid recommendation criteria' });

    try {
      let tableId: number | null = null;
      let tableSessionId: number | null = null;
      if (parsed.data.tableSessionToken) {
        const [sess] = await db
          .select()
          .from(tableSessions)
          .where(
            and(
              eq(tableSessions.sessionToken, parsed.data.tableSessionToken),
              eq(tableSessions.restaurantId, parsed.data.restaurantId)
            )
          )
          .limit(1);
        if (sess) {
          tableId = sess.tableId;
          tableSessionId = sess.id;
        }
      }

      const result = await generateAiFoodRecommendations({
        restaurantId: parsed.data.restaurantId,
        tableId,
        tableSessionId,
        guestCount: parsed.data.guestCount,
        budgetCents: Math.round(parsed.data.budgetRupees * 100),
        budgetScope: parsed.data.budgetScope,
        dietaryType: parsed.data.dietaryType,
        foodPreference: parsed.data.foodPreference,
        spiceLevel: parsed.data.spiceLevel,
        allergies: parsed.data.allergies,
        coursePreference: parsed.data.coursePreference,
      });

      res.json(result);
    } catch (err: unknown) {
      console.error('AI recommendation error:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to generate AI recommendations.',
      });
    }
  });

  router.patch('/ai/recommendations/items/:id/added', async (req, res) => {
    try {
      const [updated] = await db
        .update(recommendationItems)
        .set({ wasAddedToCart: true })
        .where(eq(recommendationItems.id, Number(req.params.id)))
        .returning();
      res.json(updated || { ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to update recommendation item' });
    }
  });

  // ---------------------------------------------------------------------------
  // FEATURE 2: MULTILINGUAL VOICE-BASED FOOD ORDERING
  // ---------------------------------------------------------------------------
  router.post('/ai/voice-parse', rateLimit(25, 60_000), async (req, res) => {
    const schema = z.object({
      restaurantId: z.number().int().positive(),
      tableSessionToken: z.string().optional(),
      language: z.string().max(24).default('en-IN'),
      transcript: z.string().min(2).max(600),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please speak or type your order.' });

    try {
      let tableSessionId: number | null = null;
      if (parsed.data.tableSessionToken) {
        const [sess] = await db
          .select()
          .from(tableSessions)
          .where(
            and(
              eq(tableSessions.sessionToken, parsed.data.tableSessionToken),
              eq(tableSessions.restaurantId, parsed.data.restaurantId)
            )
          )
          .limit(1);
        if (sess) tableSessionId = sess.id;
      }

      const result = await parseVoiceFoodOrder({
        restaurantId: parsed.data.restaurantId,
        tableSessionId,
        language: parsed.data.language,
        transcript: parsed.data.transcript,
      });

      res.json(result);
    } catch (err: unknown) {
      console.error('Voice parse error:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Could not interpret voice order.',
      });
    }
  });

  router.post('/ai/voice-sessions/:id/status', async (req, res) => {
    const schema = z.object({ status: z.enum(['confirmed', 'cancelled']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });
    const [updated] = await db
      .update(voiceOrderSessions)
      .set({ status: parsed.data.status })
      .where(eq(voiceOrderSessions.id, Number(req.params.id)))
      .returning();
    res.json(updated || { ok: true });
  });

  // ---------------------------------------------------------------------------
  // FEATURE 3: AI RESTAURANT OWNER ASSISTANT (RBAC + TENANT ISOLATED)
  // ---------------------------------------------------------------------------
  router.get(
    '/ai/assistant/conversations',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      if (!req.auth!.isSuperAdmin && restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }
      const list = await db
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.restaurantId, restaurantId))
        .orderBy(desc(assistantConversations.updatedAt))
        .limit(20);
      res.json(list);
    }
  );

  router.get(
    '/ai/assistant/conversations/:id/messages',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const convId = Number(req.params.id);
      const [conv] = await db
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, convId))
        .limit(1);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      if (!req.auth!.isSuperAdmin && conv.restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }

      const msgs = await db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, convId))
        .orderBy(assistantMessages.createdAt);
      res.json(msgs);
    }
  );

  router.post(
    '/ai/assistant/chat',
    requireRoles(['super_admin', 'owner', 'manager']),
    rateLimit(25, 60_000),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive().optional(),
        conversationId: z.number().int().positive().optional(),
        message: z.string().min(1).max(600),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Message is required' });

      const restaurantId = parsed.data.restaurantId || req.auth!.restaurantId;
      if (!req.auth!.isSuperAdmin && restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }

      try {
        const result = await runOwnerAiAssistant({
          restaurantId,
          userId: req.auth!.userId,
          conversationId: parsed.data.conversationId,
          message: parsed.data.message,
        });
        res.json(result);
      } catch (err: unknown) {
        console.error('Owner AI Assistant error:', err);
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Assistant could not process request.',
        });
      }
    }
  );

  router.delete(
    '/ai/assistant/conversations/:id',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const convId = Number(req.params.id);
      const [conv] = await db
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, convId))
        .limit(1);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      if (!req.auth!.isSuperAdmin && conv.restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }
      await db.delete(assistantConversations).where(eq(assistantConversations.id, convId));
      res.json({ deleted: true });
    }
  );

  // ---------------------------------------------------------------------------
  // FEATURES 4 & 6: SMART NOTIFICATIONS, CUSTOMER MESSAGING & CONSENT
  // ---------------------------------------------------------------------------
  router.post('/sessions/:sessionToken/mode', async (req, res) => {
    const schema = z.object({ selectedMode: z.enum(['ai_recommendations', 'menu']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid mode' });

    const [updated] = await db
      .update(tableSessions)
      .set({ selectedMode: parsed.data.selectedMode })
      .where(eq(tableSessions.sessionToken, req.params.sessionToken))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Session not found' });
    res.json(updated);
  });

  router.post('/sessions/:sessionToken/consent', async (req, res) => {
    const schema = z.object({
      preferredLanguage: z.string().max(16).default('en'),
      browserPushOptIn: z.boolean().default(false),
      smsOptIn: z.boolean().default(false),
      whatsappOptIn: z.boolean().default(false),
      emailOptIn: z.boolean().default(false),
      phone: z.string().max(24).default(''),
      email: z.string().max(100).default(''),
      customerName: z.string().max(60).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid consent payload' });

    const [sess] = await db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.sessionToken, req.params.sessionToken))
      .limit(1);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const anyOptIn =
      parsed.data.browserPushOptIn ||
      parsed.data.smsOptIn ||
      parsed.data.whatsappOptIn ||
      parsed.data.emailOptIn;

    const [updatedSession] = await db
      .update(tableSessions)
      .set({
        preferredLanguage: parsed.data.preferredLanguage,
        notificationConsent: anyOptIn,
        guestPhone: parsed.data.phone,
        guestEmail: parsed.data.email,
      })
      .where(eq(tableSessions.id, sess.id))
      .returning();

    const [pref] = await db
      .insert(customerCommunicationPreferences)
      .values({
        restaurantId: sess.restaurantId,
        tableSessionId: sess.id,
        customerName: parsed.data.customerName || sess.hostName,
        phone: parsed.data.phone,
        email: parsed.data.email,
        preferredLanguage: parsed.data.preferredLanguage,
        inAppOptIn: true,
        browserPushOptIn: parsed.data.browserPushOptIn,
        smsOptIn: parsed.data.smsOptIn,
        whatsappOptIn: parsed.data.whatsappOptIn,
        emailOptIn: parsed.data.emailOptIn,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: customerCommunicationPreferences.tableSessionId,
        set: {
          customerName: parsed.data.customerName || sess.hostName,
          phone: parsed.data.phone,
          email: parsed.data.email,
          preferredLanguage: parsed.data.preferredLanguage,
          browserPushOptIn: parsed.data.browserPushOptIn,
          smsOptIn: parsed.data.smsOptIn,
          whatsappOptIn: parsed.data.whatsappOptIn,
          emailOptIn: parsed.data.emailOptIn,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json({ session: updatedSession, preferences: pref });
  });

  router.get('/sessions/:sessionToken/messages', async (req, res) => {
    const [sess] = await db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.sessionToken, req.params.sessionToken))
      .limit(1);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const logs = await db
      .select()
      .from(notificationLogs)
      .where(
        and(
          eq(notificationLogs.tableSessionId, sess.id),
          eq(notificationLogs.recipientRole, 'customer'),
          eq(notificationLogs.channel, 'in_app')
        )
      )
      .orderBy(desc(notificationLogs.createdAt))
      .limit(20);

    res.json(logs);
  });

  router.get(
    '/notifications/preferences',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen', 'waiter', 'cashier']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.restaurantId, restaurantId));
      res.json(rows);
    }
  );

  router.patch(
    '/notifications/preferences/:targetRole',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.body?.restaurantId || req.auth!.restaurantId);
      const schema = z.object({
        inAppEnabled: z.boolean().optional(),
        browserPushEnabled: z.boolean().optional(),
        smsEnabled: z.boolean().optional(),
        whatsappEnabled: z.boolean().optional(),
        emailEnabled: z.boolean().optional(),
        soundEnabled: z.boolean().optional(),
        mutedEventTypes: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid preference payload' });

      const [updated] = await db
        .update(notificationPreferences)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(notificationPreferences.restaurantId, restaurantId),
            eq(notificationPreferences.targetRole, req.params.targetRole)
          )
        )
        .returning();

      res.json(updated);
    }
  );

  router.get(
    '/notifications/logs',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(notificationLogs)
        .where(eq(notificationLogs.restaurantId, restaurantId))
        .orderBy(desc(notificationLogs.createdAt))
        .limit(60);
      res.json(rows);
    }
  );

  router.post(
    '/notifications/check-delays',
    requireRoles(['super_admin', 'owner', 'manager', 'kitchen']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.body?.restaurantId || req.auth!.restaurantId);
      const alerted = await checkAndNotifyDelayedOrders(restaurantId);
      res.json({ checked: true, alertsTriggered: alerted });
    }
  );

  router.get(
    '/communication/templates',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.query.restaurantId || req.auth!.restaurantId);
      const rows = await db
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.restaurantId, restaurantId))
        .orderBy(notificationTemplates.id);
      res.json(rows);
    }
  );

  router.patch(
    '/communication/templates/:eventKey',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const restaurantId = Number(req.body?.restaurantId || req.auth!.restaurantId);
      const schema = z.object({
        title: z.string().min(2).max(120).optional(),
        messageBody: z.string().min(4).max(500).optional(),
        preferredLanguage: z.string().max(16).optional(),
        isEnabled: z.boolean().optional(),
        channels: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid template update' });

      const [updated] = await db
        .update(notificationTemplates)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(notificationTemplates.restaurantId, restaurantId),
            eq(notificationTemplates.eventKey, req.params.eventKey)
          )
        )
        .returning();

      if (!updated) return res.status(404).json({ error: 'Template not found' });
      res.json(updated);
    }
  );

  // ---------------------------------------------------------------------------
  // FEATURE 5: 3D & AR FOOD MODELS MANAGEMENT
  // ---------------------------------------------------------------------------
  router.get('/restaurants/:slug/models', async (req, res) => {
    const [rest] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.slug, req.params.slug))
      .limit(1);
    if (!rest) return res.status(404).json({ error: 'Restaurant not found' });

    const rows = await db
      .select()
      .from(food3dModels)
      .where(eq(food3dModels.restaurantId, rest.id));
    res.json(rows);
  });

  router.post(
    '/admin/models',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const schema = z.object({
        restaurantId: z.number().int().positive(),
        menuItemId: z.number().int().positive(),
        modelTitle: z.string().min(2).max(100),
        proceduralPreset: z.string().max(40).default('generic_plate'),
        glbUrl: z.string().max(3_000_000).default(''),
        usdzUrl: z.string().max(500).default(''),
        scaleFactor: z.number().min(0.2).max(3).default(1),
        arEnabled: z.boolean().default(true),
        previewNotes: z.string().max(240).default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid 3D model payload' });

      if (!req.auth!.isSuperAdmin && parsed.data.restaurantId !== req.auth!.restaurantId) {
        return res.status(403).json({ error: 'Cross-tenant access denied' });
      }

      const [saved] = await db
        .insert(food3dModels)
        .values({ ...parsed.data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: food3dModels.menuItemId,
          set: {
            modelTitle: parsed.data.modelTitle,
            proceduralPreset: parsed.data.proceduralPreset,
            glbUrl: parsed.data.glbUrl,
            usdzUrl: parsed.data.usdzUrl,
            scaleFactor: parsed.data.scaleFactor,
            arEnabled: parsed.data.arEnabled,
            previewNotes: parsed.data.previewNotes,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json(saved);
    }
  );

  router.delete(
    '/admin/models/:menuItemId',
    requireRoles(['super_admin', 'owner', 'manager']),
    async (req: AuthRequest, res) => {
      const targetRestaurantId =
        req.auth!.isSuperAdmin && req.query.restaurantId
          ? Number(req.query.restaurantId)
          : req.auth!.restaurantId;
      const whereClause =
        req.auth!.isSuperAdmin && !req.query.restaurantId
          ? eq(food3dModels.menuItemId, Number(req.params.menuItemId))
          : and(
              eq(food3dModels.menuItemId, Number(req.params.menuItemId)),
              eq(food3dModels.restaurantId, targetRestaurantId)
            );
      await db.delete(food3dModels).where(whereClause);
      res.json({ deleted: true });
    }
  );

  return router;
}
