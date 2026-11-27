-- v0.32.7 · PERSISTENT EXECUTION — an interrupted run's live state.
-- status: running | interrupted | completed | stopped — a run cut
-- off mid-flight (429/502/network) persists 'interrupted' so the
-- next message COMPLETES it instead of restarting (and duplicating).
-- state: RunStateSnapshot (intent, request, brief, plan bands,
-- applied tool calls, pending items, verification milestones).
ALTER TABLE "DesignAgentRun" ADD COLUMN "status" TEXT;
ALTER TABLE "DesignAgentRun" ADD COLUMN "state" JSONB;
