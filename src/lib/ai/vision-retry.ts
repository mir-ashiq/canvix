/**
 * v0.29: vision-slot call hardening.
 *
 * NVIDIA NIM's media screening occasionally rejects a perfectly valid
 * data URL with 422 "media could not be screened/downloaded" — a
 * transient service blip, not a client error (verified: the SAME data
 * URL fails once then succeeds). One immediate retry, then a final
 * attempt with ZAI_VISION_FALLBACK_MODEL (e.g. the omni model, which
 * takes data URLs through a different path) if it is configured.
 */
export async function visionChatWithRetry<T>(
  call: (model: string | undefined) => Promise<T>,
  primaryModel: string | undefined,
): Promise<T> {
  const isScreeningError = (e: unknown) =>
    /could not be (screened|downloaded)/i.test(String((e as Error | undefined)?.message ?? e))
  try {
    return await call(primaryModel)
  } catch (e) {
    if (!isScreeningError(e)) throw e
  }
  try {
    return await call(primaryModel)
  } catch (e) {
    if (!isScreeningError(e)) throw e
    const fallback = process.env.ZAI_VISION_FALLBACK_MODEL?.trim()
    if (fallback && fallback !== primaryModel) return await call(fallback)
    throw e
  }
}
