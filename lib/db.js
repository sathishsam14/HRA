// lib/db.js
// Shared singleton Prisma Client instance for HRA application

import { PrismaClient } from "@prisma/client";

const globalForPrisma = global;

export const db =
  globalForPrisma.prismaClientInstance ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClientInstance = db;
}

export default db;
