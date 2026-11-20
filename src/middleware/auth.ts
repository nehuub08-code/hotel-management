import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { restaurantMembers, users } from '../db/schema.ts';
import type { RoleCode } from '../shared/types.ts';

const SANDBOX_TOKEN_SECRET =
  process.env.SANDBOX_JWT_SECRET ||
  crypto.createHash('sha256').update(process.env.APP_URL || 'embertable-dev-secret-key').digest('hex');

export interface AuthenticatedContext {
  userId: number;
  uid: string;
  email: string;
  fullName: string;
  role: RoleCode;
  isSuperAdmin: boolean;
  restaurantId: number;
  isSandbox: boolean;
}

export interface AuthRequest extends Request {
  auth?: AuthenticatedContext;
}

export function signSandboxToken(payload: AuthenticatedContext): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', SANDBOX_TOKEN_SECRET).update(data).digest('base64url');
  return `sbx.${data}.${sig}`;
}

export function verifySandboxToken(token: string): AuthenticatedContext | null {
  if (!token.startsWith('sbx.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, data, sig] = parts;
  const expected = crypto.createHmac('sha256', SANDBOX_TOKEN_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed as AuthenticatedContext;
  } catch {
    return null;
  }
}

export async function upsertFirebaseUser(uid: string, email: string, fullName?: string) {
  const result = await db
    .insert(users)
    .values({
      uid,
      email,
      fullName: fullName || email.split('@')[0] || 'User',
      activeRole: 'owner',
      isSuperAdmin: true,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        fullName: fullName || email.split('@')[0] || 'User',
        updatedAt: new Date(),
      },
    })
    .returning();
  return result[0];
}

export async function resolveAuthFromRequest(req: AuthRequest): Promise<AuthenticatedContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // 1. Check signed server sandbox token
  if (token.startsWith('sbx.')) {
    return verifySandboxToken(token);
  }

  // 2. Verify real Firebase ID token
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@embertable.local`;
    const dbUser = await upsertFirebaseUser(decoded.uid, email, decoded.name);
    const requestedRestaurantId = Number(req.headers['x-restaurant-id'] || req.query.restaurantId || 1);

    const membership = await db
      .select()
      .from(restaurantMembers)
      .where(
        and(
          eq(restaurantMembers.userId, dbUser.id),
          eq(restaurantMembers.restaurantId, requestedRestaurantId),
          eq(restaurantMembers.isActive, true)
        )
      )
      .limit(1);

    const role = (membership[0]?.roleCode || dbUser.activeRole || 'owner') as RoleCode;

    return {
      userId: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      fullName: dbUser.fullName,
      role,
      isSuperAdmin: dbUser.isSuperAdmin,
      restaurantId: requestedRestaurantId,
      isSandbox: false,
    };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  resolveAuthFromRequest(req)
    .then((ctx) => {
      if (!ctx) {
        return res.status(401).json({ error: 'Unauthorized: Valid authentication token required.' });
      }
      req.auth = ctx;
      next();
    })
    .catch((err) => {
      console.error('Auth middleware error:', err);
      res.status(401).json({ error: 'Unauthorized' });
    });
}

export function requireRoles(allowedRoles: RoleCode[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    resolveAuthFromRequest(req)
      .then((ctx) => {
        if (!ctx) {
          return res.status(401).json({ error: 'Unauthorized: Sign in required.' });
        }
        req.auth = ctx;

        if (ctx.isSuperAdmin || allowedRoles.includes(ctx.role)) {
          // Enforce tenant isolation unless super_admin
          const targetRestaurantId = Number(
            req.params.restaurantId || req.body?.restaurantId || req.query.restaurantId || ctx.restaurantId
          );
          if (!ctx.isSuperAdmin && targetRestaurantId && targetRestaurantId !== ctx.restaurantId) {
            return res.status(403).json({
              error: 'Forbidden: Cross-tenant restaurant access is prohibited.',
            });
          }
          return next();
        }

        return res.status(403).json({
          error: `Forbidden: Role '${ctx.role}' does not have permission for this resource.`,
        });
      })
      .catch((err) => {
        console.error('RBAC error:', err);
        res.status(403).json({ error: 'Forbidden' });
      });
  };
}
