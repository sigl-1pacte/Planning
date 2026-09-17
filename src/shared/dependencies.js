export function dependencyConflicts(issues) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = [];
  for (const issue of issues) {
    if (!issue.start) continue;
    for (const blockerId of issue.blockedBy) {
      const blocker = byId.get(blockerId);
      if (blocker?.end && issue.start <= blocker.end) out.push({ issueId: issue.id, blockerId });
    }
  }
  return out;
}

export function blockedIssueIds(issues) {
  return new Set(dependencyConflicts(issues).map((c) => c.issueId));
}

export function findCycles(issues) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const state = new Map(); // 1 : en cours de visite, 2 : terminé
  const stack = [];
  const seen = new Set();
  const cycles = [];

  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id).blockedBy) {
      if (!byId.has(next)) continue;
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const issue of issues) if (!state.has(issue.id)) visit(issue.id);
  return cycles;
}
