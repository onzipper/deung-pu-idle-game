/**
 * Prisma client singleton.
 *
 * Next.js dev hot-reloads modules, which would otherwise spawn a new
 * PrismaClient (and a new connection pool) on every reload. Cache it on
 * `globalThis` to reuse one instance.
 *
 * Requires `pnpm db:generate` to have produced the client.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
