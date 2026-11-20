import crypto from 'crypto';
import { count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  allergens,
  auditLogs,
  food3dModels,
  inventoryItems,
  invoiceItems,
  invoices,
  kitchenTasks,
  menuAddons,
  menuCategories,
  menuItems,
  menuVariants,
  notificationPreferences,
  notificationTemplates,
  notifications,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  recipeIngredients,
  recipes,
  reservations,
  restaurantMembers,
  restaurants,
  reviews,
  roles,
  serviceRequests,
  staffShifts,
  stockTransactions,
  tableSessions,
  tables,
  users,
} from '../db/schema.ts';
import { DEFAULT_CUSTOMER_TEMPLATES } from './notifications.ts';

let seedPromise: Promise<void> | null = null;

function makeQrToken(seed: string): string {
  return crypto.createHash('sha256').update(`ember-qr-${seed}`).digest('hex').slice(0, 24);
}

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      console.error('Database seed failed:', err);
      throw err;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  const existing = await db.select({ value: count() }).from(restaurants);
  if (Number(existing[0]?.value || 0) > 0) {
    await ensureAddOnDefaults();
    return;
  }

  // 1. Seed Roles
  await db
    .insert(roles)
    .values([
      {
        code: 'super_admin',
        name: 'Super Admin',
        description: 'Platform-wide access across all tenant restaurants.',
        permissions: ['*'],
      },
      {
        code: 'owner',
        name: 'Restaurant Owner',
        description: 'Full control over restaurant settings, staff, billing, and analytics.',
        permissions: ['restaurant:*', 'orders:*', 'menu:*', 'floor:*', 'billing:*', 'inventory:*', 'analytics:*'],
      },
      {
        code: 'manager',
        name: 'Restaurant Manager',
        description: 'Daily operations, floor, staff shifts, inventory, and reporting.',
        permissions: ['orders:*', 'menu:write', 'floor:*', 'service:*', 'inventory:*', 'analytics:read'],
      },
      {
        code: 'kitchen',
        name: 'Kitchen Staff',
        description: 'Kitchen Display System access to accept, cook, and mark dishes ready.',
        permissions: ['kds:read', 'kds:update'],
      },
      {
        code: 'waiter',
        name: 'Waiter & Floor Staff',
        description: 'Floor map, table status, serving ready orders, and service requests.',
        permissions: ['floor:read', 'floor:update', 'service:*', 'orders:serve'],
      },
      {
        code: 'cashier',
        name: 'Cashier',
        description: 'Digital billing, invoices, UPI & Razorpay payment reconciliation.',
        permissions: ['billing:*', 'payments:*'],
      },
      {
        code: 'customer',
        name: 'Guest Customer',
        description: 'Digital menu, QR table ordering, live tracking, and reviews.',
        permissions: ['menu:read', 'order:create', 'order:track', 'review:create'],
      },
    ])
    .onConflictDoNothing();

  // 2. Seed Allergens
  await db
    .insert(allergens)
    .values([
      { code: 'dairy', name: 'Dairy', description: 'Contains milk, cream, butter, or cheese.' },
      { code: 'nuts', name: 'Tree Nuts', description: 'Contains almonds, hazelnuts, cashews, or pistachios.' },
      { code: 'gluten', name: 'Gluten', description: 'Contains wheat, barley, or rye flour.' },
      { code: 'soy', name: 'Soy', description: 'Contains soy sauce, miso, or tofu.' },
      { code: 'shellfish', name: 'Shellfish', description: 'Contains prawns, crab, or bivalves.' },
      { code: 'eggs', name: 'Eggs', description: 'Contains egg yolk or albumen.' },
    ])
    .onConflictDoNothing();

  // 3. Seed Two Isolated Tenant Restaurants
  const [saffron] = await db
    .insert(restaurants)
    .values({
      slug: 'saffron-hearth',
      name: 'Saffron & Hearth',
      tagline: 'Wood-Fired Craft Kitchen & Contemporary Dining',
      description:
        'An open-hearth modern dining room celebrating slow-fermented sourdough flatbreads, charcoal-seared coastal seafood, and botanical small plates roasted over aged fruitwood.',
      cuisineType: 'Modern Wood-Fired & Artisanal',
      phone: '+91 80 4128 9400',
      email: 'concierge@saffronhearth.in',
      address: '42 Lavelle Road, Shanthala Nagar',
      city: 'Bengaluru, Karnataka 560001',
      openingHours: {
        'Mon – Thu': '12:00 PM – 11:00 PM',
        'Fri – Sat': '12:00 PM – 12:30 AM',
        Sunday: '11:30 AM – 11:00 PM',
      },
      socialLinks: {
        instagram: 'https://instagram.com/saffronandhearth',
        website: 'https://saffronhearth.example.com',
      },
      googleReviewUrl: 'https://g.page/r/saffron-hearth-review/review',
      currencyCode: 'INR',
      currencySymbol: '₹',
      taxRatePercent: 5,
      serviceChargePercent: 5,
      allowNegativeStock: false,
      cancellationRuleMinutes: 5,
      upiVpa: 'saffronhearth@okaxis',
      upiMerchantName: 'Saffron & Hearth Kitchen',
      isActive: true,
    })
    .returning();

  const [kuroki] = await db
    .insert(restaurants)
    .values({
      slug: 'kuroki-izakaya',
      name: 'Kuroki Izakaya',
      tagline: 'Binchotan Charcoal Robata & Hand-Pulled Ramen',
      description:
        'Intimate late-night izakaya featuring binchotan-grilled yakitori skewers, 18-hour tonkotsu broths, and yuzu highballs.',
      cuisineType: 'Japanese Robata & Ramen',
      phone: '+91 22 2640 8821',
      email: 'hello@kuroki.in',
      address: '14 Pali Hill Road, Bandra West',
      city: 'Mumbai, Maharashtra 400050',
      openingHours: {
        'Tue – Fri': '5:30 PM – 12:30 AM',
        'Sat – Sun': '12:30 PM – 1:00 AM',
        Monday: 'Closed',
      },
      socialLinks: {
        instagram: 'https://instagram.com/kurokiizakaya',
      },
      googleReviewUrl: 'https://g.page/r/kuroki-izakaya-review/review',
      currencyCode: 'INR',
      currencySymbol: '₹',
      taxRatePercent: 5,
      serviceChargePercent: 0,
      allowNegativeStock: false,
      cancellationRuleMinutes: 5,
      upiVpa: 'kuroki@okaxis',
      upiMerchantName: 'Kuroki Izakaya Pvt Ltd',
      isActive: true,
    })
    .returning();

  // 4. Seed Demo Users & Staff Members
  const insertedUsers = await db
    .insert(users)
    .values([
      {
        uid: 'demo-owner-saffron',
        email: 'aarav.mehta@saffronhearth.in',
        fullName: 'Aarav Mehta',
        phone: '+91 98450 11200',
        isSuperAdmin: true,
        activeRole: 'owner',
      },
      {
        uid: 'demo-manager-saffron',
        email: 'kavya.nair@saffronhearth.in',
        fullName: 'Kavya Nair',
        phone: '+91 98450 22311',
        isSuperAdmin: false,
        activeRole: 'manager',
      },
      {
        uid: 'demo-kitchen-saffron',
        email: 'chef.rohan@saffronhearth.in',
        fullName: 'Chef Rohan Verma',
        phone: '+91 98450 33422',
        isSuperAdmin: false,
        activeRole: 'kitchen',
      },
      {
        uid: 'demo-waiter-saffron',
        email: 'dev.kapoor@saffronhearth.in',
        fullName: 'Dev Kapoor',
        phone: '+91 98450 44533',
        isSuperAdmin: false,
        activeRole: 'waiter',
      },
      {
        uid: 'demo-cashier-saffron',
        email: 'meera.iyer@saffronhearth.in',
        fullName: 'Meera Iyer',
        phone: '+91 98450 55644',
        isSuperAdmin: false,
        activeRole: 'cashier',
      },
      {
        uid: 'demo-owner-kuroki',
        email: 'kenji@kuroki.in',
        fullName: 'Kenji Takahashi',
        phone: '+91 98200 77889',
        isSuperAdmin: false,
        activeRole: 'owner',
      },
    ])
    .returning();

  const [ownerUser, managerUser, kitchenUser, waiterUser, cashierUser, kurokiOwner] = insertedUsers;

  const saffronMembers = await db
    .insert(restaurantMembers)
    .values([
      {
        restaurantId: saffron.id,
        userId: ownerUser.id,
        roleCode: 'owner',
        staffTitle: 'Founder & Managing Partner',
        pinCode: '1001',
      },
      {
        restaurantId: saffron.id,
        userId: managerUser.id,
        roleCode: 'manager',
        staffTitle: 'Floor Operations Manager',
        pinCode: '2002',
      },
      {
        restaurantId: saffron.id,
        userId: kitchenUser.id,
        roleCode: 'kitchen',
        staffTitle: 'Executive Hearth Chef',
        pinCode: '3003',
      },
      {
        restaurantId: saffron.id,
        userId: waiterUser.id,
        roleCode: 'waiter',
        staffTitle: 'Lead Sommelier & Captain',
        pinCode: '4004',
      },
      {
        restaurantId: saffron.id,
        userId: cashierUser.id,
        roleCode: 'cashier',
        staffTitle: 'Billing & Reconciliation Lead',
        pinCode: '5005',
      },
      {
        restaurantId: kuroki.id,
        userId: kurokiOwner.id,
        roleCode: 'owner',
        staffTitle: 'Chef-Owner',
        pinCode: '9001',
      },
    ])
    .returning();

  // Seed Staff Shifts
  const todayStr = new Date().toISOString().slice(0, 10);
  await db.insert(staffShifts).values([
    {
      restaurantId: saffron.id,
      memberId: saffronMembers[1].id,
      shiftDate: todayStr,
      startTime: '11:30',
      endTime: '22:30',
      station: 'Dining Floor',
      status: 'active',
      notes: 'Evening VIP reservations briefing at 6:00 PM',
    },
    {
      restaurantId: saffron.id,
      memberId: saffronMembers[2].id,
      shiftDate: todayStr,
      startTime: '11:00',
      endTime: '23:00',
      station: 'Wood Hearth & Grill',
      status: 'active',
      notes: 'Hearth prep & dinner service',
    },
    {
      restaurantId: saffron.id,
      memberId: saffronMembers[3].id,
      shiftDate: todayStr,
      startTime: '12:00',
      endTime: '23:00',
      station: 'Patio & Main Dining',
      status: 'active',
      notes: 'Tables T-01 through T-06',
    },
    {
      restaurantId: saffron.id,
      memberId: saffronMembers[4].id,
      shiftDate: todayStr,
      startTime: '12:00',
      endTime: '23:30',
      station: 'POS & UPI Desk',
      status: 'active',
      notes: 'End-of-day Razorpay settlement',
    },
  ]);

  // 5. Seed Tables with Cryptographic QR Tokens
  const saffronTables = await db
    .insert(tables)
    .values([
      {
        restaurantId: saffron.id,
        tableNumber: 'T-01',
        label: 'Window Table 1',
        capacity: 2,
        zone: 'Main Dining',
        posX: 0,
        posY: 0,
        status: 'Food Preparing',
        qrToken: makeQrToken('saffron-t01-v1'),
        currentGuestCount: 2,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-02',
        label: 'Hearth View 2',
        capacity: 4,
        zone: 'Main Dining',
        posX: 1,
        posY: 0,
        status: 'Ready to Serve',
        qrToken: makeQrToken('saffron-t02-v1'),
        currentGuestCount: 4,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-03',
        label: 'Center Walnut 3',
        capacity: 4,
        zone: 'Main Dining',
        posX: 2,
        posY: 0,
        status: 'Available',
        qrToken: makeQrToken('saffron-t03-v1'),
        currentGuestCount: 0,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-04',
        label: 'Garden Courtyard 4',
        capacity: 6,
        zone: 'Patio',
        posX: 0,
        posY: 1,
        status: 'Ordering',
        qrToken: makeQrToken('saffron-t04-v1'),
        currentGuestCount: 5,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-05',
        label: 'Olive Tree Patio 5',
        capacity: 4,
        zone: 'Patio',
        posX: 1,
        posY: 1,
        status: 'Available',
        qrToken: makeQrToken('saffron-t05-v1'),
        currentGuestCount: 0,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-06',
        label: "Chef's Counter A",
        capacity: 2,
        zone: "Chef's Counter",
        posX: 2,
        posY: 1,
        status: 'Billing',
        qrToken: makeQrToken('saffron-t06-v1'),
        currentGuestCount: 2,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-07',
        label: "Chef's Counter B",
        capacity: 2,
        zone: "Chef's Counter",
        posX: 0,
        posY: 2,
        status: 'Reserved',
        qrToken: makeQrToken('saffron-t07-v1'),
        currentGuestCount: 0,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-08',
        label: 'Private Alcove 8',
        capacity: 8,
        zone: 'Private Booth',
        posX: 1,
        posY: 2,
        status: 'Occupied',
        qrToken: makeQrToken('saffron-t08-v1'),
        currentGuestCount: 6,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-09',
        label: 'Terrace Lounge 9',
        capacity: 4,
        zone: 'Patio',
        posX: 2,
        posY: 2,
        status: 'Cleaning',
        qrToken: makeQrToken('saffron-t09-v1'),
        currentGuestCount: 0,
      },
      {
        restaurantId: saffron.id,
        tableNumber: 'T-10',
        label: 'Corner Banquette 10',
        capacity: 4,
        zone: 'Main Dining',
        posX: 3,
        posY: 0,
        status: 'Available',
        qrToken: makeQrToken('saffron-t10-v1'),
        currentGuestCount: 0,
      },
    ])
    .returning();

  await db.insert(tables).values([
    {
      restaurantId: kuroki.id,
      tableNumber: 'K-01',
      label: 'Robata Counter 1',
      capacity: 2,
      zone: 'Counter',
      posX: 0,
      posY: 0,
      status: 'Available',
      qrToken: makeQrToken('kuroki-k01-v1'),
      currentGuestCount: 0,
    },
    {
      restaurantId: kuroki.id,
      tableNumber: 'K-02',
      label: 'Tatami Booth 2',
      capacity: 4,
      zone: 'Tatami',
      posX: 1,
      posY: 0,
      status: 'Occupied',
      qrToken: makeQrToken('kuroki-k02-v1'),
      currentGuestCount: 3,
    },
    {
      restaurantId: kuroki.id,
      tableNumber: 'K-03',
      label: 'Lantern Table 3',
      capacity: 4,
      zone: 'Main Hall',
      posX: 0,
      posY: 1,
      status: 'Available',
      qrToken: makeQrToken('kuroki-k03-v1'),
      currentGuestCount: 0,
    },
    {
      restaurantId: kuroki.id,
      tableNumber: 'K-04',
      label: 'Sakura Room 4',
      capacity: 6,
      zone: 'Private',
      posX: 1,
      posY: 1,
      status: 'Reserved',
      qrToken: makeQrToken('kuroki-k04-v1'),
      currentGuestCount: 0,
    },
  ]);

  // Create active sessions for occupied tables
  const [sessionT1, sessionT2, sessionT4, sessionT6] = await db
    .insert(tableSessions)
    .values([
      {
        restaurantId: saffron.id,
        tableId: saffronTables[0].id,
        sessionToken: makeQrToken('session-t01-active'),
        guestCount: 2,
        hostName: 'Ananya & Vikram',
        participants: [
          { id: 'p1', name: 'Ananya', joinedAt: new Date(Date.now() - 25 * 60000).toISOString() },
          { id: 'p2', name: 'Vikram', joinedAt: new Date(Date.now() - 24 * 60000).toISOString() },
        ],
        status: 'active',
      },
      {
        restaurantId: saffron.id,
        tableId: saffronTables[1].id,
        sessionToken: makeQrToken('session-t02-active'),
        guestCount: 4,
        hostName: 'Riya Sharma',
        participants: [{ id: 'p3', name: 'Riya', joinedAt: new Date(Date.now() - 32 * 60000).toISOString() }],
        status: 'active',
      },
      {
        restaurantId: saffron.id,
        tableId: saffronTables[3].id,
        sessionToken: makeQrToken('session-t04-active'),
        guestCount: 5,
        hostName: 'Siddharth Rao',
        participants: [
          { id: 'p4', name: 'Siddharth', joinedAt: new Date(Date.now() - 10 * 60000).toISOString() },
          { id: 'p5', name: 'Tara', joinedAt: new Date(Date.now() - 8 * 60000).toISOString() },
        ],
        status: 'active',
      },
      {
        restaurantId: saffron.id,
        tableId: saffronTables[5].id,
        sessionToken: makeQrToken('session-t06-active'),
        guestCount: 2,
        hostName: 'Kabir Malhotra',
        participants: [{ id: 'p6', name: 'Kabir', joinedAt: new Date(Date.now() - 45 * 60000).toISOString() }],
        status: 'billing',
      },
    ])
    .returning();

  await db.update(tables).set({ activeSessionId: sessionT1.id }).where(eq(tables.id, saffronTables[0].id));
  await db.update(tables).set({ activeSessionId: sessionT2.id }).where(eq(tables.id, saffronTables[1].id));
  await db.update(tables).set({ activeSessionId: sessionT4.id }).where(eq(tables.id, saffronTables[3].id));
  await db.update(tables).set({ activeSessionId: sessionT6.id }).where(eq(tables.id, saffronTables[5].id));

  // 6. Seed Menu Categories & Dishes for Saffron & Hearth
  const [catStarters, catFlatbreads, catMains, catDesserts, catBeverages] = await db
    .insert(menuCategories)
    .values([
      {
        restaurantId: saffron.id,
        name: 'Small Plates & Hearth Starters',
        description: 'Charred botanicals, whipped labneh, and ember-roasted openers.',
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        name: 'Sourdough Flatbreads',
        description: '48-hour naturally leavened dough blistered in our oak-fired oven.',
        sortOrder: 2,
      },
      {
        restaurantId: saffron.id,
        name: 'Signature Mains',
        description: 'Coastal seafood, pasture-raised cuts, and saffron-braised bowls.',
        sortOrder: 3,
      },
      {
        restaurantId: saffron.id,
        name: 'Artisanal Desserts',
        description: 'Single-origin dark chocolate, toasted hazelnuts, and saffron reductions.',
        sortOrder: 4,
      },
      {
        restaurantId: saffron.id,
        name: 'Zero-Proof & Craft Elixirs',
        description: 'House-fermented shrubs, cold-brew infusions, and spiced tonics.',
        sortOrder: 5,
      },
    ])
    .returning();

  const saffronDishes = await db
    .insert(menuItems)
    .values([
      {
        restaurantId: saffron.id,
        categoryId: catStarters.id,
        name: 'Charred Burrata & Heirloom Fig',
        description:
          'Creamy Pugliese burrata over wood-roasted figs, toasted pistachio dukkah, aged pomegranate molasses, and blistered sourdough.',
        basePriceCents: 54000,
        imageKey: 'burrata_fig',
        isVegetarian: true,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 10,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['dairy', 'nuts', 'gluten'],
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        categoryId: catStarters.id,
        name: 'Crispy Chili Lotus Stem',
        description:
          'Wok-tossed lotus root glazed in smoked Kashmiri chili honey, toasted sesame, and pickled scallions.',
        basePriceCents: 42000,
        imageKey: 'lotus_stem',
        isVegetarian: true,
        isVegan: true,
        isFeatured: false,
        isAvailable: true,
        prepTimeMinutes: 12,
        defaultSpiceLevel: 'Hot',
        allergenCodes: ['soy'],
        sortOrder: 2,
      },
      {
        restaurantId: saffron.id,
        categoryId: catFlatbreads.id,
        name: 'Wild Mushroom & Truffle Flatbread',
        description:
          'Oak-blistered sourdough crust with roasted shiitake & oyster mushrooms, confit garlic crema, fontina, and fresh thyme.',
        basePriceCents: 68000,
        imageKey: 'truffle_flatbread',
        isVegetarian: true,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 14,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['dairy', 'gluten'],
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        categoryId: catFlatbreads.id,
        name: 'Smoked Pepperoni & Hot Honey',
        description:
          'San Marzano tomato passata, artisanal spiced pepperoni, fior di latte, pickled jalapenos, and wildflower chili honey.',
        basePriceCents: 74000,
        imageKey: 'pepperoni_flatbread',
        isVegetarian: false,
        isVegan: false,
        isFeatured: false,
        isAvailable: true,
        prepTimeMinutes: 14,
        defaultSpiceLevel: 'Medium',
        allergenCodes: ['dairy', 'gluten'],
        sortOrder: 2,
      },
      {
        restaurantId: saffron.id,
        categoryId: catMains.id,
        name: 'Miso-Glazed Seared Salmon Bowl',
        description:
          'Crispy-skin Atlantic salmon lacquered in white miso glaze over charred jasmine rice, pickled watermelon radish, and herb oil.',
        basePriceCents: 98000,
        imageKey: 'salmon_bowl',
        isVegetarian: false,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 18,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['soy'],
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        categoryId: catMains.id,
        name: 'Charcoal-Grilled Spiced Lamb Chops',
        description:
          '24-hour saffron & Tellicherry pepper marinated lamb cutlets over whipped garlic labneh, pomegranate jewels, and charred lemon.',
        basePriceCents: 124000,
        imageKey: 'lamb_chops',
        isVegetarian: false,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 22,
        defaultSpiceLevel: 'Medium',
        allergenCodes: ['dairy'],
        sortOrder: 2,
      },
      {
        restaurantId: saffron.id,
        categoryId: catMains.id,
        name: 'Saffron & Roasted Cauliflower Risotto',
        description:
          'Acquerello carnaroli rice simmered in Kashmiri saffron vegetable broth with caramelized Romanesco and crispy sage.',
        basePriceCents: 72000,
        imageKey: 'saffron_risotto',
        isVegetarian: true,
        isVegan: false,
        isFeatured: false,
        isAvailable: true,
        prepTimeMinutes: 18,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['dairy'],
        sortOrder: 3,
      },
      {
        restaurantId: saffron.id,
        categoryId: catDesserts.id,
        name: 'Roasted Hazelnut & Dark Chocolate Torte',
        description:
          '70% single-origin Coorg cacao ganache layered with Piedmont hazelnut praline crunch and espresso caramel.',
        basePriceCents: 46000,
        imageKey: 'hazelnut_torte',
        isVegetarian: true,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 8,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['dairy', 'nuts', 'eggs', 'gluten'],
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        categoryId: catBeverages.id,
        name: 'Smoked Blood Orange & Rosemary Tonic',
        description:
          'Cold-pressed blood orange juice, charred rosemary syrup, and botanical quinine tonic over hand-carved ice.',
        basePriceCents: 28000,
        imageKey: 'orange_tonic',
        isVegetarian: true,
        isVegan: true,
        isFeatured: false,
        isAvailable: true,
        prepTimeMinutes: 5,
        defaultSpiceLevel: 'Mild',
        allergenCodes: [],
        sortOrder: 1,
      },
      {
        restaurantId: saffron.id,
        categoryId: catBeverages.id,
        name: 'Kashmiri Saffron Cardamom Cold Brew',
        description:
          '18-hour single-estate Chikmagalur cold brew infused with green cardamom pods and saffron cream foam.',
        basePriceCents: 29000,
        imageKey: 'saffron_brew',
        isVegetarian: true,
        isVegan: false,
        isFeatured: false,
        isAvailable: true,
        prepTimeMinutes: 5,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['dairy'],
        sortOrder: 2,
      },
    ])
    .returning();

  // Add Variants & Add-ons to Saffron & Hearth Dishes
  for (const dish of saffronDishes) {
    await db.insert(menuVariants).values([
      { menuItemId: dish.id, name: 'Regular', priceDeltaCents: 0, isDefault: true },
      { menuItemId: dish.id, name: 'Sharing / Large', priceDeltaCents: 22000, isDefault: false },
    ]);
    await db.insert(menuAddons).values([
      { menuItemId: dish.id, name: 'Extra Truffle Drizzle', priceCents: 9500, isAvailable: true },
      { menuItemId: dish.id, name: 'Charred Sourdough Side', priceCents: 8000, isAvailable: true },
    ]);
  }

  // Seed Kuroki Izakaya Menu (Tenant 2 Isolation Proof)
  const [catRobata, catRamen] = await db
    .insert(menuCategories)
    .values([
      { restaurantId: kuroki.id, name: 'Binchotan Robata', description: 'Charcoal skewers.', sortOrder: 1 },
      { restaurantId: kuroki.id, name: 'Artisanal Ramen', description: 'Slow-simmered broths.', sortOrder: 2 },
    ])
    .returning();

  const kurokiDishes = await db
    .insert(menuItems)
    .values([
      {
        restaurantId: kuroki.id,
        categoryId: catRobata.id,
        name: 'Tsukune Chicken Skewers',
        description: 'Binchotan-grilled minced chicken tare glaze with cured egg yolk.',
        basePriceCents: 48000,
        imageKey: 'lamb_chops',
        isVegetarian: false,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 12,
        defaultSpiceLevel: 'Mild',
        allergenCodes: ['soy', 'eggs'],
        sortOrder: 1,
      },
      {
        restaurantId: kuroki.id,
        categoryId: catRamen.id,
        name: 'Black Garlic Tonkotsu Ramen',
        description: '18-hour pork bone broth, chashu belly, ajitama egg, and charred scallions.',
        basePriceCents: 69000,
        imageKey: 'salmon_bowl',
        isVegetarian: false,
        isVegan: false,
        isFeatured: true,
        isAvailable: true,
        prepTimeMinutes: 15,
        defaultSpiceLevel: 'Medium',
        allergenCodes: ['soy', 'gluten', 'eggs'],
        sortOrder: 1,
      },
    ])
    .returning();

  for (const dish of kurokiDishes) {
    await db.insert(menuVariants).values([
      { menuItemId: dish.id, name: 'Standard Bowl', priceDeltaCents: 0, isDefault: true },
    ]);
  }

  // 7. Seed Inventory & Recipes
  const invRows = await db
    .insert(inventoryItems)
    .values([
      {
        restaurantId: saffron.id,
        name: 'Artisanal Sourdough Dough Balls',
        sku: 'INV-SD-001',
        category: 'Bakery',
        currentStock: 42,
        unit: 'pcs',
        minThreshold: 12,
        costPerUnitCents: 4500,
        supplierName: 'Hearth Mill Grains',
      },
      {
        restaurantId: saffron.id,
        name: 'Wild Forest Mushrooms',
        sku: 'INV-VG-002',
        category: 'Produce',
        currentStock: 8.5,
        unit: 'kg',
        minThreshold: 3,
        costPerUnitCents: 85000,
        supplierName: 'Nilgiri Foragers',
      },
      {
        restaurantId: saffron.id,
        name: 'Pugliese Burrata Cheese',
        sku: 'INV-DY-003',
        category: 'Dairy',
        currentStock: 14,
        unit: 'pcs',
        minThreshold: 6,
        costPerUnitCents: 18000,
        supplierName: 'Craft Creamery Co.',
      },
      {
        restaurantId: saffron.id,
        name: 'Atlantic Salmon Fillets',
        sku: 'INV-SF-004',
        category: 'Seafood',
        currentStock: 6.2,
        unit: 'kg',
        minThreshold: 2.5,
        costPerUnitCents: 190000,
        supplierName: 'Bluewater Imports',
      },
      {
        restaurantId: saffron.id,
        name: 'Grass-Fed Lamb Cutlets',
        sku: 'INV-MT-005',
        category: 'Butchery',
        currentStock: 4.1,
        unit: 'kg',
        minThreshold: 4.5,
        costPerUnitCents: 165000,
        supplierName: 'Deccan Pastures',
      },
      {
        restaurantId: saffron.id,
        name: 'Kashmiri Saffron Threads',
        sku: 'INV-SP-006',
        category: 'Spices',
        currentStock: 180,
        unit: 'g',
        minThreshold: 40,
        costPerUnitCents: 6500,
        supplierName: 'Pampore Spice Guild',
      },
    ])
    .returning();

  await db.insert(stockTransactions).values([
    {
      restaurantId: saffron.id,
      inventoryItemId: invRows[0].id,
      transactionType: 'purchase',
      quantityDelta: 50,
      balanceAfter: 42,
      note: 'Morning fermentation batch',
      performedByName: 'Chef Rohan Verma',
    },
    {
      restaurantId: saffron.id,
      inventoryItemId: invRows[4].id,
      transactionType: 'consumption',
      quantityDelta: -1.4,
      balanceAfter: 4.1,
      note: 'Lunch service lamb cutlets (low stock alert triggered)',
      performedByName: 'System Recipe Engine',
    },
  ]);

  // Link Recipes to Menu Items for Automatic Stock Consumption
  const [recipeFlatbread] = await db
    .insert(recipes)
    .values({
      restaurantId: saffron.id,
      menuItemId: saffronDishes[2].id,
      yieldServings: 1,
      instructions: 'Stretch 240g sourdough, top with 120g roasted mushrooms, bake at 430C for 90s.',
      consumeOnStatus: 'Accepted',
    })
    .returning();

  await db.insert(recipeIngredients).values([
    { recipeId: recipeFlatbread.id, inventoryItemId: invRows[0].id, quantityRequired: 1 },
    { recipeId: recipeFlatbread.id, inventoryItemId: invRows[1].id, quantityRequired: 0.15 },
  ]);

  const [recipeSalmon] = await db
    .insert(recipes)
    .values({
      restaurantId: saffron.id,
      menuItemId: saffronDishes[4].id,
      yieldServings: 1,
      instructions: 'Sear 200g salmon skin-side down, glaze with white miso.',
      consumeOnStatus: 'Accepted',
    })
    .returning();

  await db.insert(recipeIngredients).values([
    { recipeId: recipeSalmon.id, inventoryItemId: invRows[3].id, quantityRequired: 0.22 },
  ]);

  // 8. Seed Live & Historical Orders (past 7 days + active today)
  const now = Date.now();
  const hour = 3600000;
  const day = 24 * hour;

  const historicalSpecs = [
    { daysAgo: 6, num: 'ORD-1031', total: 242000, sub: 220000, tax: 11000, svc: 11000, tableIdx: 2, guest: 'Priya Nair' },
    { daysAgo: 5, num: 'ORD-1032', total: 319000, sub: 290000, tax: 14500, svc: 14500, tableIdx: 4, guest: 'Arjun Kapoor' },
    { daysAgo: 4, num: 'ORD-1033', total: 187000, sub: 170000, tax: 8500, svc: 8500, tableIdx: 7, guest: 'Sneha Kulkarni' },
    { daysAgo: 3, num: 'ORD-1034', total: 407000, sub: 370000, tax: 18500, svc: 18500, tableIdx: 2, guest: 'Vikramaditya Rao' },
    { daysAgo: 2, num: 'ORD-1035', total: 275000, sub: 250000, tax: 12500, svc: 12500, tableIdx: 4, guest: 'Neha Deshmukh' },
    { daysAgo: 1, num: 'ORD-1036', total: 352000, sub: 320000, tax: 16000, svc: 16000, tableIdx: 7, guest: 'Rohan Joshi' },
    { daysAgo: 0, num: 'ORD-1037', total: 215600, sub: 196000, tax: 9800, svc: 9800, tableIdx: 5, guest: 'Kabir Malhotra' },
  ];

  for (const h of historicalSpecs) {
    const createdAt = new Date(now - h.daysAgo * day - 2 * hour);
    const [ord] = await db
      .insert(orders)
      .values({
        restaurantId: saffron.id,
        tableId: saffronTables[h.tableIdx].id,
        tableSessionId: h.tableIdx === 5 ? sessionT6.id : null,
        orderNumber: h.num,
        customerName: h.guest,
        guestCount: 3,
        status: h.tableIdx === 5 ? 'Served' : 'Completed',
        priority: 'normal',
        subtotalCents: h.sub,
        taxCents: h.tax,
        serviceChargeCents: h.svc,
        discountCents: 0,
        totalCents: h.total,
        estimatedPrepMinutes: 18,
        acceptedAt: new Date(createdAt.getTime() + 2 * 60000),
        cookingAt: new Date(createdAt.getTime() + 4 * 60000),
        readyAt: new Date(createdAt.getTime() + 16 * 60000),
        servedAt: new Date(createdAt.getTime() + 19 * 60000),
        completedAt: h.tableIdx === 5 ? null : new Date(createdAt.getTime() + 50 * 60000),
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    await db.insert(orderItems).values([
      {
        orderId: ord.id,
        menuItemId: saffronDishes[2].id,
        itemName: saffronDishes[2].name,
        quantity: 1,
        unitPriceCents: saffronDishes[2].basePriceCents,
        variantName: 'Regular',
        variantPriceDeltaCents: 0,
        addons: [],
        spiceLevel: 'Mild',
        lineTotalCents: saffronDishes[2].basePriceCents,
        kitchenStatus: 'Served',
      },
      {
        orderId: ord.id,
        menuItemId: saffronDishes[4].id,
        itemName: saffronDishes[4].name,
        quantity: 1,
        unitPriceCents: saffronDishes[4].basePriceCents,
        variantName: 'Regular',
        variantPriceDeltaCents: 0,
        addons: [],
        spiceLevel: 'Medium',
        lineTotalCents: saffronDishes[4].basePriceCents,
        kitchenStatus: 'Served',
      },
    ]);

    const invNum = `INV-${h.num.replace('ORD-', '')}`;
    const isPaid = h.tableIdx !== 5;
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: saffron.id,
        orderId: ord.id,
        invoiceNumber: invNum,
        subtotalCents: h.sub,
        taxCents: h.tax,
        serviceChargeCents: h.svc,
        discountCents: 0,
        totalCents: h.total,
        status: isPaid ? 'paid' : 'unpaid',
        issuedAt: createdAt,
        paidAt: isPaid ? new Date(createdAt.getTime() + 45 * 60000) : null,
      })
      .returning();

    await db.insert(invoiceItems).values([
      {
        invoiceId: inv.id,
        description: saffronDishes[2].name,
        quantity: 1,
        unitPriceCents: saffronDishes[2].basePriceCents,
        totalCents: saffronDishes[2].basePriceCents,
      },
      {
        invoiceId: inv.id,
        description: saffronDishes[4].name,
        quantity: 1,
        unitPriceCents: saffronDishes[4].basePriceCents,
        totalCents: saffronDishes[4].basePriceCents,
      },
    ]);

    if (isPaid) {
      await db.insert(payments).values({
        restaurantId: saffron.id,
        invoiceId: inv.id,
        orderId: ord.id,
        paymentMethod: h.daysAgo % 2 === 0 ? 'UPI' : 'Razorpay Card',
        amountCents: h.total,
        currency: 'INR',
        providerOrderId: `order_rzp_${h.num}`,
        providerPaymentId: `pay_rzp_${h.num}`,
        providerSignature: `sig_verified_${h.num}`,
        webhookVerified: true,
        status: 'captured',
        reconciliationNote: 'Auto-reconciled via Razorpay webhook',
        paidAt: new Date(createdAt.getTime() + 45 * 60000),
      });
    }
  }

  // Live Active Kitchen Orders for Today
  const [liveOrd1] = await db
    .insert(orders)
    .values({
      restaurantId: saffron.id,
      tableId: saffronTables[0].id,
      tableSessionId: sessionT1.id,
      orderNumber: 'ORD-1041',
      customerName: 'Ananya & Vikram',
      guestCount: 2,
      status: 'Cooking',
      priority: 'rush',
      subtotalCents: 192000,
      taxCents: 9600,
      serviceChargeCents: 9600,
      discountCents: 0,
      totalCents: 211200,
      estimatedPrepMinutes: 18,
      notes: 'Serve flatbread first as starter.',
      acceptedAt: new Date(now - 9 * 60000),
      cookingAt: new Date(now - 6 * 60000),
      createdAt: new Date(now - 11 * 60000),
      updatedAt: new Date(now - 6 * 60000),
    })
    .returning();

  const liveItems1 = await db
    .insert(orderItems)
    .values([
      {
        orderId: liveOrd1.id,
        menuItemId: saffronDishes[2].id,
        itemName: saffronDishes[2].name,
        quantity: 1,
        unitPriceCents: 68000,
        variantName: 'Regular',
        variantPriceDeltaCents: 0,
        addons: [{ name: 'Extra Truffle Drizzle', priceCents: 9500 }],
        spiceLevel: 'Mild',
        specialInstructions: 'Extra crispy edges please',
        lineTotalCents: 77500,
        kitchenStatus: 'Cooking',
      },
      {
        orderId: liveOrd1.id,
        menuItemId: saffronDishes[5].id,
        itemName: saffronDishes[5].name,
        quantity: 1,
        unitPriceCents: 124000,
        variantName: 'Regular',
        variantPriceDeltaCents: 0,
        addons: [],
        spiceLevel: 'Medium',
        specialInstructions: 'Medium-rare sear',
        lineTotalCents: 124000,
        kitchenStatus: 'Cooking',
      },
    ])
    .returning();

  await db.insert(kitchenTasks).values(
    liveItems1.map((item) => ({
      restaurantId: saffron.id,
      orderId: liveOrd1.id,
      orderItemId: item.id,
      station: 'Hearth',
      status: 'active',
      assignedToName: 'Chef Rohan Verma',
      startedAt: new Date(now - 6 * 60000),
    }))
  );

  const [liveOrd2] = await db
    .insert(orders)
    .values({
      restaurantId: saffron.id,
      tableId: saffronTables[1].id,
      tableSessionId: sessionT2.id,
      orderNumber: 'ORD-1042',
      customerName: 'Riya Sharma',
      guestCount: 4,
      status: 'Ready',
      priority: 'normal',
      subtotalCents: 152000,
      taxCents: 7600,
      serviceChargeCents: 7600,
      discountCents: 0,
      totalCents: 167200,
      estimatedPrepMinutes: 15,
      acceptedAt: new Date(now - 18 * 60000),
      cookingAt: new Date(now - 14 * 60000),
      readyAt: new Date(now - 2 * 60000),
      createdAt: new Date(now - 20 * 60000),
      updatedAt: new Date(now - 2 * 60000),
    })
    .returning();

  await db.insert(orderItems).values([
    {
      orderId: liveOrd2.id,
      menuItemId: saffronDishes[0].id,
      itemName: saffronDishes[0].name,
      quantity: 1,
      unitPriceCents: 54000,
      variantName: 'Regular',
      variantPriceDeltaCents: 0,
      addons: [],
      spiceLevel: 'Mild',
      lineTotalCents: 54000,
      kitchenStatus: 'Ready',
    },
    {
      orderId: liveOrd2.id,
      menuItemId: saffronDishes[4].id,
      itemName: saffronDishes[4].name,
      quantity: 1,
      unitPriceCents: 98000,
      variantName: 'Regular',
      variantPriceDeltaCents: 0,
      addons: [],
      spiceLevel: 'Mild',
      lineTotalCents: 98000,
      kitchenStatus: 'Ready',
    },
  ]);

  const [liveOrd3] = await db
    .insert(orders)
    .values({
      restaurantId: saffron.id,
      tableId: saffronTables[3].id,
      tableSessionId: sessionT4.id,
      orderNumber: 'ORD-1043',
      customerName: 'Siddharth Rao',
      guestCount: 5,
      status: 'Pending',
      priority: 'vip',
      subtotalCents: 146000,
      taxCents: 7300,
      serviceChargeCents: 7300,
      discountCents: 0,
      totalCents: 160600,
      estimatedPrepMinutes: 16,
      notes: 'Nut allergy at table — please omit pistachio dukkah on burrata.',
      createdAt: new Date(now - 2 * 60000),
      updatedAt: new Date(now - 2 * 60000),
    })
    .returning();

  await db.insert(orderItems).values([
    {
      orderId: liveOrd3.id,
      menuItemId: saffronDishes[0].id,
      itemName: saffronDishes[0].name,
      quantity: 1,
      unitPriceCents: 54000,
      variantName: 'Regular',
      variantPriceDeltaCents: 0,
      addons: [],
      spiceLevel: 'Mild',
      specialInstructions: 'NO PISTACHIOS (Nut Allergy)',
      lineTotalCents: 54000,
      kitchenStatus: 'Pending',
    },
    {
      orderId: liveOrd3.id,
      menuItemId: saffronDishes[7].id,
      itemName: saffronDishes[7].name,
      quantity: 2,
      unitPriceCents: 46000,
      variantName: 'Regular',
      variantPriceDeltaCents: 0,
      addons: [],
      spiceLevel: 'Mild',
      lineTotalCents: 92000,
      kitchenStatus: 'Pending',
    },
  ]);

  await db.insert(orderStatusHistory).values([
    {
      orderId: liveOrd1.id,
      fromStatus: 'Pending',
      toStatus: 'Cooking',
      changedByName: 'Chef Rohan Verma',
      note: 'Fired on main wood hearth',
    },
    {
      orderId: liveOrd2.id,
      fromStatus: 'Cooking',
      toStatus: 'Ready',
      changedByName: 'Chef Rohan Verma',
      note: 'Plated at pass — ready for runner',
    },
  ]);

  // 9. Seed Service Requests
  await db.insert(serviceRequests).values([
    {
      restaurantId: saffron.id,
      tableId: saffronTables[3].id,
      tableNumber: 'T-04',
      requestType: 'Water',
      customMessage: 'Chilled sparkling water for 5 guests please.',
      status: 'Pending',
      createdAt: new Date(now - 3 * 60000),
    },
    {
      restaurantId: saffron.id,
      tableId: saffronTables[5].id,
      tableNumber: 'T-06',
      requestType: 'Bill Request',
      customMessage: 'Ready to settle via UPI.',
      status: 'Acknowledged',
      handledByName: 'Dev Kapoor',
      createdAt: new Date(now - 6 * 60000),
    },
  ]);

  // 10. Seed Customer Reviews
  await db.insert(reviews).values([
    {
      restaurantId: saffron.id,
      customerName: 'Aditi Rao',
      overallRating: 5,
      foodRating: 5,
      serviceRating: 5,
      experienceRating: 5,
      comment:
        'Scanning the table QR and watching our sourdough flatbread fire in real time made dinner effortless. The burrata & fig opener is extraordinary.',
      isApproved: true,
    },
    {
      restaurantId: saffron.id,
      customerName: 'Karanveer Singh',
      overallRating: 5,
      foodRating: 5,
      serviceRating: 4,
      experienceRating: 5,
      comment:
        'Lamb chops had incredible charcoal depth and saffron aroma. Being able to call for water and pay via UPI straight from our phone was seamless.',
      isApproved: true,
    },
    {
      restaurantId: saffron.id,
      customerName: 'Meenakshi Pillai',
      overallRating: 4,
      foodRating: 5,
      serviceRating: 4,
      experienceRating: 4,
      comment:
        'Vibrant atmosphere around the open hearth. Miso salmon skin was glass-crisp and the hazelnut torte finished the evening beautifully.',
      isApproved: true,
    },
  ]);

  // 11. Seed Reservations
  const tomorrow = new Date(now + day).toISOString().slice(0, 10);
  await db.insert(reservations).values([
    {
      restaurantId: saffron.id,
      customerName: 'Ishaan Chatterjee',
      customerEmail: 'ishaan.c@example.com',
      customerPhone: '+91 98801 44120',
      partySize: 2,
      reservationDate: todayStr,
      reservationTime: '20:00',
      preferredZone: "Chef's Counter",
      specialRequests: 'Anniversary seating near the hearth if possible.',
      status: 'confirmed',
      assignedTableId: saffronTables[6].id,
    },
    {
      restaurantId: saffron.id,
      customerName: 'Zoya Merchant',
      customerEmail: 'zoya.m@example.com',
      customerPhone: '+91 98451 99012',
      partySize: 6,
      reservationDate: tomorrow,
      reservationTime: '19:30',
      preferredZone: 'Private Booth',
      specialRequests: 'Two vegetarian tasting menus.',
      status: 'confirmed',
      assignedTableId: saffronTables[7].id,
    },
  ]);

  // 12. Seed Notifications & Audit Logs
  await db.insert(notifications).values([
    {
      restaurantId: saffron.id,
      targetRole: 'kitchen',
      type: 'order_new',
      title: 'New VIP Order ORD-1043',
      message: 'Table T-04 submitted 3 items — Note: Nut allergy at table.',
      linkTarget: 'kds',
      isRead: false,
    },
    {
      restaurantId: saffron.id,
      targetRole: 'waiter',
      type: 'order_status',
      title: 'Order ORD-1042 Ready to Serve',
      message: 'Table T-02 dishes are plated at the pass.',
      linkTarget: 'floor',
      isRead: false,
    },
    {
      restaurantId: saffron.id,
      targetRole: 'manager',
      type: 'inventory_low',
      title: 'Low Stock Alert: Grass-Fed Lamb Cutlets',
      message: 'Current stock (4.1 kg) is below minimum threshold (4.5 kg).',
      linkTarget: 'inventory',
      isRead: false,
    },
  ]);

  await db.insert(auditLogs).values([
    {
      restaurantId: saffron.id,
      actorEmail: 'system@embertable.io',
      actorRole: 'super_admin',
      action: 'TENANT_INITIALIZED',
      entityType: 'restaurant',
      entityId: String(saffron.id),
      metadata: { slug: saffron.slug, tablesSeeded: saffronTables.length },
    },
  ]);

  await ensureAddOnDefaults();
}

async function ensureAddOnDefaults(): Promise<void> {
  const allRestaurants = await db.select().from(restaurants);
  for (const rest of allRestaurants) {
    // 1. Notification Templates (8 lifecycle messages)
    for (const tpl of DEFAULT_CUSTOMER_TEMPLATES) {
      await db
        .insert(notificationTemplates)
        .values({
          restaurantId: rest.id,
          eventKey: tpl.eventKey,
          title: tpl.title,
          messageBody: tpl.messageBody,
          preferredLanguage: 'en',
          isEnabled: true,
          channels: tpl.channels,
        })
        .onConflictDoNothing();
    }

    // 2. Role Notification Preferences
    for (const role of ['owner', 'manager', 'kitchen', 'waiter', 'cashier']) {
      await db
        .insert(notificationPreferences)
        .values({
          restaurantId: rest.id,
          targetRole: role,
          inAppEnabled: true,
          browserPushEnabled: true,
          smsEnabled: false,
          whatsappEnabled: false,
          emailEnabled: false,
          soundEnabled: true,
          mutedEventTypes: [],
        })
        .onConflictDoNothing();
    }

    // 3. 3D/AR Food Models for Menu Items
    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, rest.id));
    for (const item of items) {
      await db
        .insert(food3dModels)
        .values({
          restaurantId: rest.id,
          menuItemId: item.id,
          modelTitle: `${item.name} 3D Table Preview`,
          proceduralPreset: item.imageKey || 'generic_plate',
          glbUrl: '',
          usdzUrl: '',
          scaleFactor: 1,
          arEnabled: true,
          previewNotes: 'Interactive 3D dish model calibrated for real-world table proportions.',
        })
        .onConflictDoNothing();
    }
  }
}
