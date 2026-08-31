export function resolveProjectPlanningSeedText(input: {
  latestUserPromptText?: string | null
  draftPromptText?: string | null
  existingDescription?: string | null
}) {
  const latestUserPrompt = input.latestUserPromptText?.trim() ?? ""
  if (latestUserPrompt) return latestUserPrompt

  const draftPrompt = input.draftPromptText?.trim() ?? ""
  if (draftPrompt) return draftPrompt

  return input.existingDescription?.trim() ?? ""
}
