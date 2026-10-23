export type BatchDraftValidation = {
  ready: boolean;
  hasConflicts: boolean;
  hasChanges: boolean;
  conflictRows: Set<string>;
};

export function stageBatchAssignment(draft: Record<string, string>, targetRoom: string, sourceRoom: string): Record<string, string> {
  return { ...draft, [targetRoom]: sourceRoom };
}

export function validateBatchDraft(roomNumbers: string[], draft: Record<string, string>): BatchDraftValidation {
  const validRooms = new Set(roomNumbers);
  const sourceCounts = new Map<string, number>();
  for (const room of roomNumbers) {
    const sourceRoom = draft[room];
    if (sourceRoom) sourceCounts.set(sourceRoom, (sourceCounts.get(sourceRoom) ?? 0) + 1);
  }

  const duplicateSources = new Set(
    [...sourceCounts].filter(([, count]) => count > 1).map(([room]) => room),
  );
  const usedSources = new Set(sourceCounts.keys());
  const missingSources = new Set(roomNumbers.filter(room => !usedSources.has(room)));
  const ready = roomNumbers.length > 0 && roomNumbers.every(room => validRooms.has(draft[room]));
  const conflictRows = new Set<string>();

  for (const room of roomNumbers) {
    const sourceRoom = draft[room];
    if (!sourceRoom || !validRooms.has(sourceRoom) || duplicateSources.has(sourceRoom) || missingSources.has(room)) {
      conflictRows.add(room);
    }
  }

  const hasConflicts = !ready || duplicateSources.size > 0 || missingSources.size > 0;
  const hasChanges = ready && roomNumbers.some(room => draft[room] !== room);
  return { ready, hasConflicts, hasChanges, conflictRows };
}
