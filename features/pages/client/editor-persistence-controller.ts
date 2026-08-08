export type EditorPersistenceController = ReturnType<
	typeof createEditorPersistenceController
>;

export function createEditorPersistenceController({
	initiallyDirty = false,
	initialConflict = false,
	autosaveDelayMs,
	onAutosave,
}: {
	initiallyDirty?: boolean;
	initialConflict?: boolean;
	autosaveDelayMs: number;
	onAutosave: () => void;
}) {
	let dirty = initiallyDirty;
	let applyingRemote = false;
	let conflict = initialConflict;
	let allowConflictSave = false;
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function clearPendingTimer() {
		if (timeout) clearTimeout(timeout);
		timeout = null;
	}

	return {
		get dirty() {
			return dirty;
		},
		set dirty(next: boolean) {
			dirty = next;
		},
		get applyingRemote() {
			return applyingRemote;
		},
		set applyingRemote(next: boolean) {
			applyingRemote = next;
		},
		get hasConflict() {
			return conflict;
		},
		set hasConflict(next: boolean) {
			conflict = next;
		},
		get allowConflictSave() {
			return allowConflictSave;
		},
		set allowConflictSave(next: boolean) {
			allowConflictSave = next;
		},
		markChanged() {
			dirty = true;
		},
		beginSave() {
			if ((conflict && !allowConflictSave) || !dirty) return false;
			dirty = false;
			return true;
		},
		markSaveFailed() {
			dirty = true;
		},
		scheduleAutosave() {
			clearPendingTimer();
			timeout = setTimeout(() => {
				timeout = null;
				onAutosave();
			}, autosaveDelayMs);
		},
		clearPendingTimer,
		dispose() {
			clearPendingTimer();
		},
	};
}
