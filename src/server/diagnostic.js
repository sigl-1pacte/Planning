import { mapWorkspace } from './linear/mapper.js';
import { parseStartingDate, parseContributors } from './linear/parsing.js';

export function buildDiagnostic({ users, issues }) {
  const domain = mapWorkspace({ teams: [], projects: [], users, issues });
  const mapped = new Map(domain.issues.map((i) => [i.id, i]));
  const identifiers = new Map(issues.map((i) => [i.id, i.identifier]));
  const names = new Map(domain.users.map((u) => [u.id, u.name]));

  return issues.map((raw) => {
    const issue = mapped.get(raw.id);
    const contrib = parseContributors(raw.comments.nodes, domain.users);
    const comment = raw.comments.nodes.find((c) => c.id === contrib.commentId);
    return {
      identifier: raw.identifier,
      title: raw.title,
      description: raw.description,
      startingDate: parseStartingDate(raw.description),
      dueDate: raw.dueDate,
      estimate: raw.estimate,
      contributorsComment: comment ? { id: comment.id, body: comment.body } : null,
      contributors: issue.contributorIds.map((id) => ({ id, name: names.get(id) })),
      unresolvedMentions: issue.unresolvedMentions,
      contributorsSource: issue.contributorsSource,
      blockedBy: issue.blockedBy.map((id) => identifiers.get(id)),
      unplannedReason: issue.unplannedReason,
    };
  });
}

export function registerDiagnosticRoute(app, { fetchDiagnosticSample }) {
  app.get('/api/diagnostic', async (req) => {
    const requested = Number(req.query.limit ?? 20);
    const limit = Math.min(50, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 20));
    return buildDiagnostic(await fetchDiagnosticSample(req.linearKey, limit));
  });
}
