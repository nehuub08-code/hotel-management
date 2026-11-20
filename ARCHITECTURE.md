# EmberTable Architecture & Database Reference

## System Architecture

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Recharts + Lucide Icons + jsPDF + `vite-plugin-pwa`.
- **Backend**: Express (`server.ts`) + WebSocket Hub (`ws` mounted at `/ws` on port `3000`) + Drizzle ORM (`drizzle-orm/node-postgres`).
- **Database**: Cloud SQL PostgreSQL (28 normalized tables with foreign keys, unique constraints, and B-tree indexes).
- **Authentication & RBAC**: Firebase Authentication (`signInWithPopup` Google Sign-In verified via `firebase-admin`) + server-signed HMAC-SHA256 sandbox role tokens for workspace role previews (`super_admin`, `owner`, `manager`, `kitchen`, `waiter`, `cashier`, `customer`).

## Database Tables (28 Normalized Tables)

`restaurants`, `roles`, `users`, `restaurant_members`, `tables`, `table_sessions`, `menu_categories`, `allergens`, `menu_items`, `menu_variants`, `menu_addons`, `orders`, `order_items`, `order_status_history`, `kitchen_tasks`, `service_requests`, `invoices`, `invoice_items`, `payments`, `reviews`, `reservations`, `inventory_items`, `stock_transactions`, `recipes`, `recipe_ingredients`, `staff_shifts`, `notifications`, `audit_logs`.

## Security Controls

- **Server-Side Pricing**: Clients submit only item IDs, quantities, variant names, and addon names. All prices, taxes, service charges, and promo discounts are calculated on the server.
- **Duplicate Prevention**: Orders and payments enforce unique `idempotency_key` constraints.
- **Payment Integrity**: Invoices are marked `paid` only after `HMAC-SHA256` signature verification (`/api/payments/verify`) or signed webhook validation (`/api/payments/webhook`).
- **Tenant Isolation**: Every protected route verifies `restaurantId` against the authenticated session unless `isSuperAdmin === true`.
