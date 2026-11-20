import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const restaurants = pgTable('restaurants', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  description: text('description').notNull(),
  cuisineType: text('cuisine_type').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  openingHours: jsonb('opening_hours').$type<Record<string, string>>().notNull(),
  socialLinks: jsonb('social_links').$type<Record<string, string>>().notNull(),
  googleReviewUrl: text('google_review_url').default('').notNull(),
  currencyCode: text('currency_code').default('INR').notNull(),
  currencySymbol: text('currency_symbol').default('₹').notNull(),
  taxRatePercent: doublePrecision('tax_rate_percent').default(5).notNull(),
  serviceChargePercent: doublePrecision('service_charge_percent').default(5).notNull(),
  allowNegativeStock: boolean('allow_negative_stock').default(false).notNull(),
  cancellationRuleMinutes: integer('cancellation_rule_minutes').default(5).notNull(),
  upiVpa: text('upi_vpa').default('saffronhearth@okaxis').notNull(),
  upiMerchantName: text('upi_merchant_name').default('Saffron & Hearth Kitchen').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').default('').notNull(),
  phone: text('phone').default('').notNull(),
  avatarUrl: text('avatar_url').default('').notNull(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  activeRole: text('active_role').default('customer').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const restaurantMembers = pgTable(
  'restaurant_members',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleCode: text('role_code').notNull(),
    staffTitle: text('staff_title').default('').notNull(),
    pinCode: text('pin_code').default('').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('restaurant_member_unique_idx').on(table.restaurantId, table.userId),
    index('restaurant_members_restaurant_idx').on(table.restaurantId),
  ]
);

export const tables = pgTable(
  'tables',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableNumber: text('table_number').notNull(),
    label: text('label').notNull(),
    capacity: integer('capacity').default(4).notNull(),
    zone: text('zone').default('Main Dining').notNull(),
    posX: integer('pos_x').default(0).notNull(),
    posY: integer('pos_y').default(0).notNull(),
    status: text('status').default('Available').notNull(),
    qrToken: text('qr_token').notNull().unique(),
    qrVersion: integer('qr_version').default(1).notNull(),
    currentGuestCount: integer('current_guest_count').default(0).notNull(),
    activeSessionId: integer('active_session_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tables_restaurant_number_idx').on(table.restaurantId, table.tableNumber),
    index('tables_restaurant_idx').on(table.restaurantId),
  ]
);

export interface SessionParticipant {
  id: string;
  name: string;
  joinedAt: string;
}

export const tableSessions = pgTable(
  'table_sessions',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableId: integer('table_id')
      .references(() => tables.id, { onDelete: 'cascade' })
      .notNull(),
    sessionToken: text('session_token').notNull().unique(),
    guestCount: integer('guest_count').default(2).notNull(),
    hostName: text('host_name').default('Table Guest').notNull(),
    participants: jsonb('participants').$type<SessionParticipant[]>().default([]).notNull(),
    status: text('status').default('active').notNull(),
    selectedMode: text('selected_mode').default('pending').notNull(),
    preferredLanguage: text('preferred_language').default('en').notNull(),
    notificationConsent: boolean('notification_consent').default(false).notNull(),
    guestPhone: text('guest_phone').default('').notNull(),
    guestEmail: text('guest_email').default('').notNull(),
    welcomeShownAt: timestamp('welcome_shown_at'),
    goodbyeShownAt: timestamp('goodbye_shown_at'),
    openedAt: timestamp('opened_at').defaultNow().notNull(),
    closedAt: timestamp('closed_at'),
  },
  (table) => [index('table_sessions_restaurant_table_idx').on(table.restaurantId, table.tableId)]
);

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('menu_categories_restaurant_idx').on(table.restaurantId)]
);

export const allergens = pgTable('allergens', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
});

export const menuItems = pgTable(
  'menu_items',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: integer('category_id')
      .references(() => menuCategories.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    basePriceCents: integer('base_price_cents').notNull(),
    imageKey: text('image_key').default('hearth_plate').notNull(),
    isVegetarian: boolean('is_vegetarian').default(false).notNull(),
    isVegan: boolean('is_vegan').default(false).notNull(),
    isFeatured: boolean('is_featured').default(false).notNull(),
    isAvailable: boolean('is_available').default(true).notNull(),
    prepTimeMinutes: integer('prep_time_minutes').default(15).notNull(),
    defaultSpiceLevel: text('default_spice_level').default('Medium').notNull(),
    allergenCodes: jsonb('allergen_codes').$type<string[]>().default([]).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('menu_items_restaurant_idx').on(table.restaurantId),
    index('menu_items_category_idx').on(table.categoryId),
  ]
);

export const menuVariants = pgTable(
  'menu_variants',
  {
    id: serial('id').primaryKey(),
    menuItemId: integer('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    priceDeltaCents: integer('price_delta_cents').default(0).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
  },
  (table) => [index('menu_variants_item_idx').on(table.menuItemId)]
);

export const menuAddons = pgTable(
  'menu_addons',
  {
    id: serial('id').primaryKey(),
    menuItemId: integer('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    isAvailable: boolean('is_available').default(true).notNull(),
  },
  (table) => [index('menu_addons_item_idx').on(table.menuItemId)]
);

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableId: integer('table_id').references(() => tables.id, { onDelete: 'set null' }),
    tableSessionId: integer('table_session_id').references(() => tableSessions.id, {
      onDelete: 'set null',
    }),
    orderNumber: text('order_number').notNull().unique(),
    customerUserId: integer('customer_user_id').references(() => users.id, { onDelete: 'set null' }),
    customerName: text('customer_name').default('Table Guest').notNull(),
    guestCount: integer('guest_count').default(2).notNull(),
    idempotencyKey: text('idempotency_key').unique(),
    status: text('status').default('Pending').notNull(),
    priority: text('priority').default('normal').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    serviceChargeCents: integer('service_charge_cents').default(0).notNull(),
    discountCents: integer('discount_cents').default(0).notNull(),
    discountCode: text('discount_code').default('').notNull(),
    totalCents: integer('total_cents').notNull(),
    estimatedPrepMinutes: integer('estimated_prep_minutes').default(18).notNull(),
    notes: text('notes').default('').notNull(),
    acceptedAt: timestamp('accepted_at'),
    cookingAt: timestamp('cooking_at'),
    readyAt: timestamp('ready_at'),
    servedAt: timestamp('served_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelReason: text('cancel_reason').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('orders_restaurant_status_idx').on(table.restaurantId, table.status),
    index('orders_session_idx').on(table.tableSessionId),
  ]
);

export interface OrderItemAddon {
  name: string;
  priceCents: number;
}

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    menuItemId: integer('menu_item_id').references(() => menuItems.id, { onDelete: 'set null' }),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    variantName: text('variant_name').default('Regular').notNull(),
    variantPriceDeltaCents: integer('variant_price_delta_cents').default(0).notNull(),
    addons: jsonb('addons').$type<OrderItemAddon[]>().default([]).notNull(),
    spiceLevel: text('spice_level').default('Medium').notNull(),
    specialInstructions: text('special_instructions').default('').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    kitchenStatus: text('kitchen_status').default('Pending').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('order_items_order_idx').on(table.orderId)]
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    changedByUserId: integer('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedByName: text('changed_by_name').default('System').notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('order_status_history_order_idx').on(table.orderId)]
);

export const kitchenTasks = pgTable(
  'kitchen_tasks',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: integer('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    orderItemId: integer('order_item_id')
      .references(() => orderItems.id, { onDelete: 'cascade' })
      .notNull(),
    station: text('station').default('Hearth').notNull(),
    status: text('status').default('queued').notNull(),
    assignedToName: text('assigned_to_name').default('').notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('kitchen_tasks_restaurant_idx').on(table.restaurantId)]
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableId: integer('table_id')
      .references(() => tables.id, { onDelete: 'cascade' })
      .notNull(),
    tableNumber: text('table_number').notNull(),
    requestType: text('request_type').notNull(),
    customMessage: text('custom_message').default('').notNull(),
    status: text('status').default('Pending').notNull(),
    handledByUserId: integer('handled_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    handledByName: text('handled_by_name').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [index('service_requests_restaurant_status_idx').on(table.restaurantId, table.status)]
);

export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    tableSessionId: integer('table_session_id').references(() => tableSessions.id, {
      onDelete: 'set null',
    }),
    invoiceNumber: text('invoice_number').notNull().unique(),
    subtotalCents: integer('subtotal_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    serviceChargeCents: integer('service_charge_cents').default(0).notNull(),
    discountCents: integer('discount_cents').default(0).notNull(),
    totalCents: integer('total_cents').notNull(),
    status: text('status').default('unpaid').notNull(),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    paidAt: timestamp('paid_at'),
  },
  (table) => [index('invoices_restaurant_idx').on(table.restaurantId)]
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
  },
  (table) => [index('invoice_items_invoice_idx').on(table.invoiceId)]
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceId: integer('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    paymentMethod: text('payment_method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').default('INR').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerPaymentId: text('provider_payment_id').default('').notNull(),
    providerSignature: text('provider_signature').default('').notNull(),
    webhookVerified: boolean('webhook_verified').default(false).notNull(),
    status: text('status').default('created').notNull(),
    idempotencyKey: text('idempotency_key').unique(),
    reconciliationNote: text('reconciliation_note').default('').notNull(),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('payments_restaurant_idx').on(table.restaurantId)]
);

export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    customerName: text('customer_name').notNull(),
    overallRating: integer('overall_rating').notNull(),
    foodRating: integer('food_rating').notNull(),
    serviceRating: integer('service_rating').notNull(),
    experienceRating: integer('experience_rating').notNull(),
    comment: text('comment').notNull(),
    isApproved: boolean('is_approved').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('reviews_restaurant_idx').on(table.restaurantId)]
);

export const reservations = pgTable(
  'reservations',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    customerPhone: text('customer_phone').notNull(),
    partySize: integer('party_size').notNull(),
    reservationDate: text('reservation_date').notNull(),
    reservationTime: text('reservation_time').notNull(),
    preferredZone: text('preferred_zone').default('Main Dining').notNull(),
    specialRequests: text('special_requests').default('').notNull(),
    status: text('status').default('confirmed').notNull(),
    assignedTableId: integer('assigned_table_id').references(() => tables.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('reservations_restaurant_date_idx').on(table.restaurantId, table.reservationDate)]
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    category: text('category').notNull(),
    currentStock: doublePrecision('current_stock').default(0).notNull(),
    unit: text('unit').default('kg').notNull(),
    minThreshold: doublePrecision('min_threshold').default(5).notNull(),
    costPerUnitCents: integer('cost_per_unit_cents').default(0).notNull(),
    supplierName: text('supplier_name').default('').notNull(),
    lastRestockedAt: timestamp('last_restocked_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inventory_restaurant_sku_idx').on(table.restaurantId, table.sku),
    index('inventory_restaurant_idx').on(table.restaurantId),
  ]
);

export const stockTransactions = pgTable(
  'stock_transactions',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    transactionType: text('transaction_type').notNull(),
    quantityDelta: doublePrecision('quantity_delta').notNull(),
    balanceAfter: doublePrecision('balance_after').notNull(),
    referenceOrderId: integer('reference_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    note: text('note').default('').notNull(),
    performedByName: text('performed_by_name').default('System').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('stock_transactions_restaurant_idx').on(table.restaurantId)]
);

export const recipes = pgTable(
  'recipes',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    menuItemId: integer('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    yieldServings: integer('yield_servings').default(1).notNull(),
    instructions: text('instructions').default('').notNull(),
    consumeOnStatus: text('consume_on_status').default('Accepted').notNull(),
  },
  (table) => [uniqueIndex('recipes_menu_item_unique_idx').on(table.menuItemId)]
);

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: serial('id').primaryKey(),
    recipeId: integer('recipe_id')
      .references(() => recipes.id, { onDelete: 'cascade' })
      .notNull(),
    inventoryItemId: integer('inventory_item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    quantityRequired: doublePrecision('quantity_required').notNull(),
  },
  (table) => [index('recipe_ingredients_recipe_idx').on(table.recipeId)]
);

export const staffShifts = pgTable(
  'staff_shifts',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    memberId: integer('member_id')
      .references(() => restaurantMembers.id, { onDelete: 'cascade' })
      .notNull(),
    shiftDate: text('shift_date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    station: text('station').default('Dining Floor').notNull(),
    status: text('status').default('scheduled').notNull(),
    notes: text('notes').default('').notNull(),
  },
  (table) => [index('staff_shifts_restaurant_idx').on(table.restaurantId)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    targetRole: text('target_role').default('all').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    linkTarget: text('link_target').default('').notNull(),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_restaurant_idx').on(table.restaurantId)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id').references(() => restaurants.id, {
      onDelete: 'set null',
    }),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').default('guest').notNull(),
    actorRole: text('actor_role').default('customer').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ipAddress: text('ip_address').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_restaurant_idx').on(table.restaurantId)]
);

// ---------------------------------------------------------------------------
// ADD-ON FEATURE TABLES (AI Recommendations, Voice Ordering, Owner AI,
// Smart Notifications, Personalized Messaging, and 3D/AR Food Models)
// ---------------------------------------------------------------------------

export const aiRecommendationSessions = pgTable(
  'ai_recommendation_sessions',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableId: integer('table_id').references(() => tables.id, { onDelete: 'set null' }),
    tableSessionId: integer('table_session_id').references(() => tableSessions.id, {
      onDelete: 'set null',
    }),
    guestCount: integer('guest_count').default(2).notNull(),
    budgetCents: integer('budget_cents').default(100000).notNull(),
    budgetScope: text('budget_scope').default('entire_table').notNull(),
    dietaryType: text('dietary_type').default('any').notNull(),
    foodPreference: text('food_preference').default('').notNull(),
    spiceLevel: text('spice_level').default('Medium').notNull(),
    allergies: jsonb('allergies').$type<string[]>().default([]).notNull(),
    coursePreference: text('course_preference').default('complete_meal').notNull(),
    summaryText: text('summary_text').default('').notNull(),
    totalRecommendedCents: integer('total_recommended_cents').default(0).notNull(),
    status: text('status').default('completed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_rec_sessions_restaurant_idx').on(table.restaurantId)]
);

export const recommendationItems = pgTable(
  'recommendation_items',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => aiRecommendationSessions.id, { onDelete: 'cascade' })
      .notNull(),
    menuItemId: integer('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: integer('quantity').default(1).notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    reason: text('reason').notNull(),
    wasAddedToCart: boolean('was_added_to_cart').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('rec_items_session_idx').on(table.sessionId)]
);

export interface VoiceParsedItemPayload {
  menuItemId: number | null;
  spokenPhrase: string;
  matchedItemName: string;
  quantity: number;
  variantName: string;
  spiceLevel: 'Mild' | 'Medium' | 'Hot';
  specialInstructions: string;
  unitPriceCents: number;
  lineTotalCents: number;
  isAvailable: boolean;
  confidence: 'exact' | 'fuzzy' | 'ambiguous' | 'unavailable';
}

export const voiceOrderSessions = pgTable(
  'voice_order_sessions',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableSessionId: integer('table_session_id').references(() => tableSessions.id, {
      onDelete: 'set null',
    }),
    language: text('language').default('en-IN').notNull(),
    rawTranscript: text('raw_transcript').notNull(),
    editedTranscript: text('edited_transcript').default('').notNull(),
    parsedItems: jsonb('parsed_items').$type<VoiceParsedItemPayload[]>().default([]).notNull(),
    ambiguities: jsonb('ambiguities').$type<string[]>().default([]).notNull(),
    estimatedTotalCents: integer('estimated_total_cents').default(0).notNull(),
    status: text('status').default('parsed').notNull(),
    errorMessage: text('error_message').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('voice_order_sessions_restaurant_idx').on(table.restaurantId)]
);

export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').default('Restaurant Insights Chat').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('assistant_conv_restaurant_idx').on(table.restaurantId)]
);

export interface AssistantChartPayload {
  chartType: 'bar' | 'line';
  title: string;
  xKey: string;
  yKey: string;
  data: Record<string, string | number>[];
}

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .references(() => assistantConversations.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolsUsed: jsonb('tools_used').$type<string[]>().default([]).notNull(),
    chartData: jsonb('chart_data').$type<AssistantChartPayload | null>(),
    dateRangeLabel: text('date_range_label').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('assistant_msg_conv_idx').on(table.conversationId)]
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    targetRole: text('target_role').notNull(),
    inAppEnabled: boolean('in_app_enabled').default(true).notNull(),
    browserPushEnabled: boolean('browser_push_enabled').default(true).notNull(),
    smsEnabled: boolean('sms_enabled').default(false).notNull(),
    whatsappEnabled: boolean('whatsapp_enabled').default(false).notNull(),
    emailEnabled: boolean('email_enabled').default(false).notNull(),
    soundEnabled: boolean('sound_enabled').default(true).notNull(),
    mutedEventTypes: jsonb('muted_event_types').$type<string[]>().default([]).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notif_pref_restaurant_role_idx').on(table.restaurantId, table.targetRole),
  ]
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    eventKey: text('event_key').notNull(),
    title: text('title').notNull(),
    messageBody: text('message_body').notNull(),
    preferredLanguage: text('preferred_language').default('en').notNull(),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    channels: jsonb('channels').$type<string[]>().default(['in_app']).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notif_template_restaurant_event_idx').on(table.restaurantId, table.eventKey),
  ]
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableSessionId: integer('table_session_id').references(() => tableSessions.id, {
      onDelete: 'set null',
    }),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    eventKey: text('event_key').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    recipientRole: text('recipient_role').notNull(),
    recipientName: text('recipient_name').default('Guest').notNull(),
    channel: text('channel').default('in_app').notNull(),
    title: text('title').notNull(),
    renderedMessage: text('rendered_message').notNull(),
    deliveryStatus: text('delivery_status').default('delivered_in_app').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    errorDetail: text('error_detail').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('notif_logs_restaurant_idx').on(table.restaurantId),
    index('notif_logs_session_idx').on(table.tableSessionId),
  ]
);

export const customerCommunicationPreferences = pgTable(
  'customer_communication_preferences',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    tableSessionId: integer('table_session_id')
      .references(() => tableSessions.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    customerName: text('customer_name').default('Table Guest').notNull(),
    phone: text('phone').default('').notNull(),
    email: text('email').default('').notNull(),
    preferredLanguage: text('preferred_language').default('en').notNull(),
    inAppOptIn: boolean('in_app_opt_in').default(true).notNull(),
    browserPushOptIn: boolean('browser_push_opt_in').default(false).notNull(),
    smsOptIn: boolean('sms_opt_in').default(false).notNull(),
    whatsappOptIn: boolean('whatsapp_opt_in').default(false).notNull(),
    emailOptIn: boolean('email_opt_in').default(false).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('cust_comm_pref_restaurant_idx').on(table.restaurantId)]
);

export const food3dModels = pgTable(
  'food_3d_models',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    menuItemId: integer('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    modelTitle: text('model_title').notNull(),
    proceduralPreset: text('procedural_preset').default('generic_plate').notNull(),
    glbUrl: text('glb_url').default('').notNull(),
    usdzUrl: text('usdz_url').default('').notNull(),
    scaleFactor: doublePrecision('scale_factor').default(1).notNull(),
    arEnabled: boolean('ar_enabled').default(true).notNull(),
    previewNotes: text('preview_notes').default('').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('food_3d_models_restaurant_idx').on(table.restaurantId)]
);

// Drizzle Relations
export const restaurantsRelations = relations(restaurants, ({ many }) => ({
  members: many(restaurantMembers),
  tables: many(tables),
  menuCategories: many(menuCategories),
  menuItems: many(menuItems),
  orders: many(orders),
  reviews: many(reviews),
  reservations: many(reservations),
  inventoryItems: many(inventoryItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [menuItems.restaurantId],
    references: [restaurants.id],
  }),
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
  variants: many(menuVariants),
  addons: many(menuAddons),
}));

export const menuVariantsRelations = relations(menuVariants, ({ one }) => ({
  menuItem: one(menuItems, {
    fields: [menuVariants.menuItemId],
    references: [menuItems.id],
  }),
}));

export const menuAddonsRelations = relations(menuAddons, ({ one }) => ({
  menuItem: one(menuItems, {
    fields: [menuAddons.menuItemId],
    references: [menuItems.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [orders.restaurantId],
    references: [restaurants.id],
  }),
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  items: many(orderItems),
  history: many(orderStatusHistory),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, {
    fields: [orderStatusHistory.orderId],
    references: [orders.id],
  }),
}));
