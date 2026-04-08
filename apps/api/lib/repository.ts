import { PrismaClient } from "@prisma/client"
import type { DiagnoseFailureResponse, SessionSummary } from "@prompt-optimizer/shared"
import { runtimeFlags } from "./env"

const prisma = runtimeFlags.enableDb ? new PrismaClient() : null

type PromptRecord = {
  id: string
  sessionId: string
  originalPrompt: string
  optimizedPrompt: string | null
  finalSentPrompt: string
  promptIntent: string
  strengthScore: string
}

type OutcomeRecord = {
  id: string
  promptEventId: string
  outputSnippet: string
  errorSummary: string | null
  retryCount: number
  changedFilesCount: number
  changedFilePathsSummary: string[]
  detectionFlags: Record<string, boolean>
  probableStatus: string
}

const memoryStore = {
  sessions: new Map<string, SessionSummary>(),
  prompts: new Map<string, PromptRecord>(),
  outcomes: new Map<string, OutcomeRecord>(),
  diagnoses: new Map<string, DiagnoseFailureResponse>(),
  patternCache: new Map<string, { template: DiagnoseFailureResponse; usageCount: number }>()
}

export async function upsertSessionSummary(session: SessionSummary) {
  memoryStore.sessions.set(session.sessionId, session)
  if (!prisma) return

  await prisma.session.upsert({
    where: { id: session.sessionId },
    create: {
      id: session.sessionId,
      source: "REPLIT",
      probableStatus: session.lastProbableStatus
    },
    update: {
      probableStatus: session.lastProbableStatus,
      endedAt: null
    }
  })
}

export async function savePromptEvent(record: PromptRecord) {
  memoryStore.prompts.set(record.id, record)
  if (!prisma) return

  await prisma.promptEvent.create({
    data: {
      id: record.id,
      sessionId: record.sessionId,
      originalPrompt: record.originalPrompt,
      optimizedPrompt: record.optimizedPrompt,
      finalSentPrompt: record.finalSentPrompt,
      promptIntent: record.promptIntent,
      strengthScore: record.strengthScore
    }
  })
}

export async function saveOutcomeEvent(record: OutcomeRecord) {
  memoryStore.outcomes.set(record.id, record)
  if (!prisma) return

  await prisma.outcomeEvent.create({
    data: {
      id: record.id,
      promptEventId: record.promptEventId,
      outputSnippet: record.outputSnippet,
      errorSummary: record.errorSummary,
      retryCount: record.retryCount,
      changedFilesCount: record.changedFilesCount,
      changedFilePathsSummary: record.changedFilePathsSummary,
      detectionFlags: record.detectionFlags,
      probableStatus: record.probableStatus
    }
  })
}

export async function saveDiagnosis(outcomeEventId: string, diagnosis: DiagnoseFailureResponse) {
  memoryStore.diagnoses.set(outcomeEventId, diagnosis)
  if (!prisma) return

  await prisma.diagnosis.create({
    data: {
      outcomeEventId,
      whyItLikelyFailed: diagnosis.why_it_likely_failed,
      whatAiMisunderstood: diagnosis.what_the_ai_likely_misunderstood,
      whatToFixNextTime: diagnosis.what_to_fix_next_time,
      improvedRetryPrompt: diagnosis.improved_retry_prompt,
      sourceType: diagnosis.source_type,
      tokenEstimate: diagnosis.token_estimate
    }
  })
}

export async function getPatternCache(patternKey: string) {
  const fromMemory = memoryStore.patternCache.get(patternKey)
  if (fromMemory) return fromMemory

  if (!prisma) return null

  const record = await prisma.patternCache.findUnique({ where: { patternKey } })
  if (!record) return null

  return {
    template: record.diagnosisTemplate as DiagnoseFailureResponse,
    usageCount: record.usageCount
  }
}

export async function setPatternCache(patternKey: string, template: DiagnoseFailureResponse) {
  const current = memoryStore.patternCache.get(patternKey)
  memoryStore.patternCache.set(patternKey, {
    template,
    usageCount: (current?.usageCount ?? 0) + 1
  })

  if (!prisma) return

  await prisma.patternCache.upsert({
    where: { patternKey },
    create: {
      patternKey,
      diagnosisTemplate: template,
      usageCount: 1
    },
    update: {
      diagnosisTemplate: template,
      usageCount: {
        increment: 1
      }
    }
  })
}

export async function saveFeedback(outcomeEventId: string, feedbackType: "WORKED" | "DID_NOT_WORK") {
  if (!prisma) return

  await prisma.userFeedback.create({
    data: {
      outcomeEventId,
      feedbackType
    }
  })
}
