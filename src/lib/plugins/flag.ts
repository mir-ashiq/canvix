// ─────────────────────────────────────────────────────────────
// CANVIX_PLUGINS — the instance-wide plugin kill switch
// (research §4.2). Default OFF: self-hosters get third-party
// code only when they explicitly ask for it — the same opt-in
// pattern as CANVIX_MCP_TOKEN and the AI keys. With the flag
// off every plugin route answers 503 PLUGINS_DISABLED, the
// runtime import never fires, and behavior is byte-identical
// to a plugin-less Canvix.
// ─────────────────────────────────────────────────────────────

/** True when this instance has opted into the plugin system. */
export function pluginsEnabled(): boolean {
  const v = process.env.CANVIX_PLUGINS
  return v === '1' || v === 'true' || v === 'on'
}

/** Shared 503 body for disabled instances. */
export const PLUGINS_DISABLED = {
  error: 'Plugins are disabled on this instance.',
  code: 'PLUGINS_DISABLED',
  hint: 'Set CANVIX_PLUGINS=1 to enable the plugin system.',
} as const
