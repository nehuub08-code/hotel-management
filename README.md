# EmberTable — Multi-Restaurant Management & QR Ordering Platform

EmberTable is a full-stack, multi-tenant Restaurant Management & Automation SaaS platform connecting guests, kitchen teams, floor staff, cashiers, managers, and restaurant owners in real time.

## Core Capabilities

- **Customizable Restaurant Website**: Hero showcase, signature plates, category-filtered menu, hours, location, real-time table reservations, and verified guest reviews.
- **Cryptographic QR Table Ordering**: Each table has an unguessable 24-character `qrToken` (never editable table numbers in URLs), collaborative multi-guest table sessions, dish variants, add-ons, spice levels, allergens, and idempotent order submission.
- **Kitchen Display System (KDS)**: Live WebSocket ticket queue, synthesized Web Audio new-order chimes, prep timers, delay warnings, priority highlights, and 1-tap `Accept → Cook → Ready → Serve` workflow.
- **Customer Live Tracking & Waiting Lounge**: Real-time order status progress synchronized from KDS, countdown timer, grace-period cancellation, interactive spice quiz, and memory game.
- **Waiter Calling & Interactive Floor Map**: Instant table service calls (`Water`, `Napkins`, `Cutlery`, `Waiter Assistance`, `Bill Request`) routed to floor staff with status lifecycle (`Pending → Acknowledged → In Progress → Completed`) and QR management/printing.
- **Digital Billing, UPI & Razorpay Verification**: Itemized invoices, downloadable PDF receipts (`jspdf`), UPI QR deep links, and server-side HMAC-SHA256 signature & webhook verification.
- **Inventory & Automatic Recipe Deduction**: Ingredients automatically deduct when orders reach their configured consumption stage inside PostgreSQL transactions, triggering low-stock alerts.
- **17-Module Admin Console**: Real PostgreSQL KPIs, Recharts analytics, CSV/PDF reports, menu CRUD, staff shifts, audit logs, and multi-tenant isolation (`Saffron & Hearth` and `Kuroki Izakaya`).
- **PWA Support**: Installable web app with offline connectivity banner and Web App Manifest.

## Environment Setup

Copy `.env.example` to `.env` and ensure Cloud SQL PostgreSQL credentials (`SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`) and `firebase-applet-config.json` are configured.

## Running Locally

```bash
npm install
npm run test
npm run lint
npm run dev
```

The Express + WebSocket + Vite server runs on port `3000`.
