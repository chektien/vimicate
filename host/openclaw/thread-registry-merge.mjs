// Storage-neutral extraction of the existing host-current-v1 merge rules.
function registryComparableText(value) {
	if (typeof value !== "string") return "";
	return value.trim().toLocaleLowerCase("en-US").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean).join(" ");
}
function registryEntryIdentity(entry) {
	const parentProjectID = registryComparableText(entry?.parentProjectID);
	const label = registryComparableText(entry?.label);
	return parentProjectID && label ? `${parentProjectID}\n${label}` : "";
}
function registryEntryKeys(entry) {
	const keys = new Set();
	const add = (value) => {
		if (typeof value === "string" && value.trim()) keys.add(value.trim());
	};
	add(entry?.threadID);
	add(entry?.currentBinding?.stableSessionKey);
	for (const binding of Array.isArray(entry?.bindings) ? entry.bindings : []) add(binding?.stableSessionKey);
	return keys;
}
function registryFindThreadIndex(threads, incoming, mode) {
	const incomingKeys = registryEntryKeys(incoming);
	const incomingIdentity = registryEntryIdentity(incoming);
	for (let index = 0; index < threads.length; index += 1) {
		const candidate = threads[index];
		const candidateKeys = registryEntryKeys(candidate);
		for (const key of incomingKeys) if (candidateKeys.has(key)) return index;
		if (incomingIdentity && registryEntryIdentity(candidate) === incomingIdentity) {
			if (mode === "remove" || candidate?.state === "removed" || incoming?.explicitlyCreatedAtSeconds == null) return index;
		}
	}
	return -1;
}
function registryNormalizedRevision(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 253402300800
		? value
		: null;
}
function registrySessionIDConflictKey(value) {
	return typeof value === "string" ? `0:${value}` : "1:";
}
function registryExistingBindingOwnsSessionID(existing, incoming) {
	const existingEpoch = registryNormalizedRevision(existing?.sessionStartedAtSeconds);
	const incomingEpoch = registryNormalizedRevision(incoming?.sessionStartedAtSeconds);
	if (existingEpoch !== null || incomingEpoch !== null) {
		if (existingEpoch === null) return false;
		if (incomingEpoch === null) return true;
		if (existingEpoch !== incomingEpoch) return existingEpoch > incomingEpoch;
		return registrySessionIDConflictKey(existing?.sessionID)
			>= registrySessionIDConflictKey(incoming?.sessionID);
	}
	const existingRevision = registryNormalizedRevision(existing?.sessionIDUpdatedAtSeconds);
	const incomingRevision = registryNormalizedRevision(incoming?.sessionIDUpdatedAtSeconds);
	if (existingRevision === null) return false;
	if (incomingRevision === null) return true;
	if (existingRevision !== incomingRevision) return existingRevision > incomingRevision;
	const existingTieBreaker = typeof existing?.sessionIDRevisionTieBreaker === "string"
		? existing.sessionIDRevisionTieBreaker
		: "";
	const incomingTieBreaker = typeof incoming?.sessionIDRevisionTieBreaker === "string"
		? incoming.sessionIDRevisionTieBreaker
		: "";
	if (existingTieBreaker !== incomingTieBreaker) return existingTieBreaker > incomingTieBreaker;
	return registrySessionIDConflictKey(existing?.sessionID)
		>= registrySessionIDConflictKey(incoming?.sessionID);
}
function registryMergeBinding(existing, incoming) {
	if (!existing) return incoming;
	if (!incoming) return existing;
	const merged = { ...existing, ...incoming };
	if (registryExistingBindingOwnsSessionID(existing, incoming)) {
		merged.sessionID = existing.sessionID;
		merged.sessionStartedAtSeconds = existing.sessionStartedAtSeconds;
		merged.sessionIDUpdatedAtSeconds = existing.sessionIDUpdatedAtSeconds;
		merged.sessionIDRevisionTieBreaker = existing.sessionIDRevisionTieBreaker;
	}
	return merged;
}
function registryMergeBindingLists(existing, incoming) {
	const merged = Array.isArray(incoming) ? incoming.map((binding) => ({ ...binding })) : [];
	for (const existingBinding of Array.isArray(existing) ? existing : []) {
		const key = typeof existingBinding?.stableSessionKey === "string"
			? existingBinding.stableSessionKey.trim().toLocaleLowerCase("en-US")
			: "";
		const index = merged.findIndex((binding) => (
			typeof binding?.stableSessionKey === "string"
				? binding.stableSessionKey.trim().toLocaleLowerCase("en-US")
				: ""
		) === key);
		if (index >= 0) merged[index] = registryMergeBinding(existingBinding, merged[index]);
		else merged.push(existingBinding);
	}
	return merged;
}
function registryMergeThread(existing, incoming, mode) {
	const merged = {
		...existing,
		...incoming,
		state: mode === "remove" ? "removed" : "active"
	};
	merged.currentBinding = registryMergeBinding(
		existing?.currentBinding,
		incoming?.currentBinding
	);
	merged.bindings = registryMergeBindingLists(existing?.bindings, incoming?.bindings);
	if (mode === "remove") {
		merged.explicitlyCreatedAtSeconds = incoming?.explicitlyCreatedAtSeconds ?? existing?.explicitlyCreatedAtSeconds;
	}
	return merged;
}

export { registryFindThreadIndex, registryMergeThread, registryNormalizedRevision };
