import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface HeadersLike {
  headers?: { cookie?: string };
}

let cachedToken: string | null = null;

export function getAdminToken(): string {
  if (!cachedToken) {
    cachedToken = process.env.ADMIN_TOKEN?.trim() || `admin-${crypto.randomBytes(6).toString("hex")}`;
  }
  return cachedToken;
}

export function adminTokenFromEnv(): boolean {
  return Boolean(process.env.ADMIN_TOKEN?.trim());
}

const sessions = new Map<string, number>();

export function pruneSessions(): void {
  const now = Date.now();
  for (const [id, exp] of sessions) {
    if (exp < now) sessions.delete(id);
  }
}

export function createSession(): string {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  pruneSessions();
  return id;
}

export function sessionCookie(id: string): string {
  return `${COOKIE_NAME}=${id}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

export function destroySession(req: HeadersLike): void {
  const id = getSessionId(req);
  if (id) sessions.delete(id);
}

export function getSessionId(req: HeadersLike): string | null {
  const cookie = req.headers?.cookie ?? "";
  for (const part of cookie.split(";")) {
    const eq = part.trim().indexOf("=");
    if (eq <= 0) continue;
    const key = part.trim().slice(0, eq);
    if (key === COOKIE_NAME) return part.trim().slice(eq + 1) || null;
  }
  return null;
}

export function isAuthed(req: HeadersLike): boolean {
  const id = getSessionId(req);
  if (!id) return false;
  const exp = sessions.get(id);
  if (exp === undefined) return false;
  if (exp < Date.now()) {
    sessions.delete(id);
    return false;
  }
  return true;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: "Chưa đăng nhập." });
}
