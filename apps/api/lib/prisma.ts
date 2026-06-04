import { PrismaClient } from "@prisma/client"
import { runtimeFlags } from "./env"

const globalForPrisma = globalThis as typeof globalThis & {
  promptOptimizerPrisma?: PrismaClient | null
}

export const prisma =
  runtimeFlags.enableDb
    ? (globalForPrisma.promptOptimizerPrisma ??= new PrismaClient())
    : null
