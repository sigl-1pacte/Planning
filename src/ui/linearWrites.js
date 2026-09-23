// Écritures vers Linear, faites directement depuis le navigateur avec la clé
// personnelle de l'utilisateur (celle déjà stockée en local) : le backend ne
// reçoit jamais de demande d'écriture vers Linear, il ne sert qu'à lire (et à
// resynchroniser son cache). La logique est celle qui vivait dans les routes
// d'écriture du serveur — mêmes modules purs (mutations, createFlow, parsing,
// reschedule), simplement appelés d'ici.
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from '../server/linear/client.js';
import * as mutations from '../server/linear/mutations.js';
import { createIssueWithExtras, buildProjectInput, buildMilestoneInput, withMove } from '../server/linear/createFlow.js';
import { setStartingDate, setContributors, setDescriptionText } from '../server/linear/parsing.js';
import { computeReschedule } from '../shared/reschedule.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

export function createLinearWrites({ getKey, getDomain, resync, AuthError, ApiError, delayMs = 400, opts, linear }) {
  // `opts` (ex. { fetchImpl }) est transmis à chaque appel GraphQL : sert
  // aux tests, qui branchent un faux Linear.
  const m = linear ?? Object.fromEntries(Object.entries(mutations)
    .filter(([, fn]) => typeof fn === 'function')
    .map(([name, fn]) => [name, (...args) => (opts ? fn(...args, opts) : fn(...args))]));

  // Linear reste la source de vérité : après une écriture on demande au
  // backend de relire Linear (lecture), en réessayant quelques fois si ce qui
  // vient d'être écrit n'apparaît pas encore.
  async function syncUntil(isPresent) {
    let snap;
    for (let i = 0; i < 3; i += 1) {
      snap = await resync();
      if (isPresent(snap.domain)) break;
      if (i < 2) await wait(delayMs);
    }
    return snap;
  }

  const guard = (fn) => async (...args) => {
    try {
      return await fn(getKey(), ...args);
    } catch (err) {
      if (err instanceof LinearAuthError) throw new AuthError(err.message);
      if (err instanceof LinearRateLimitError || err instanceof LinearUnavailableError) throw new ApiError(err.message, 503);
      if (err.statusCode) throw new ApiError(err.message, err.statusCode);
      throw err;
    }
  };

  const needDomain = () => {
    const domain = getDomain();
    if (!domain) throw fail('Instantané indisponible', 503);
    return domain;
  };

  return {
    updateIssue: guard(async (key, id, body) => {
      const domain = getDomain();
      const issue = domain?.issues.find((i) => i.id === id);
      const patch = withMove({ ...body }, issue, domain ?? null);
      // Texte libre puis date de début s'appliquent l'un sur l'autre : aucun ne
      // doit écraser l'autre (ni la ligne Contributors).
      if ('description' in patch || 'start' in patch) {
        let desc = issue?.rawDescription ?? null;
        if ('description' in patch) desc = setDescriptionText(desc, patch.description);
        if ('start' in patch) desc = setStartingDate(desc, patch.start);
        patch.description = desc;
        delete patch.start;
      }
      if ('end' in patch) {
        patch.dueDate = patch.end;
        delete patch.end;
      }
      await m.updateIssue(key, id, patch);
      // Attend que les champs simples écrits soient bien relus (statut, team,
      // titre…) : une lecture juste après l'écriture peut encore renvoyer l'ancienne valeur.
      const checks = { stateId: 'stateId', teamId: 'teamId', title: 'title', assigneeId: 'assigneeId', estimate: 'estimate', projectId: 'projectId' };
      const reflected = (d) => {
        const now = d.issues.find((i) => i.id === id);
        if (now && 'description' in body && (now.rawDescription ?? '') !== (patch.description ?? '')) return false;
        return !now || Object.entries(checks).every(([field, prop]) => !(field in body) || now[prop] === body[field]);
      };
      return { domain: (await syncUntil(reflected)).domain };
    }),

    reschedule: guard(async (key, id, dates) => {
      const domain = needDomain();
      let changes;
      try {
        changes = computeReschedule(domain.issues, new Set(), id, dates);
      } catch (err) {
        throw Object.assign(err, { statusCode: 400 });
      }
      const byId = new Map(domain.issues.map((i) => [i.id, i]));
      for (const change of changes) {
        await m.updateIssue(key, change.issueId, {
          description: setStartingDate(byId.get(change.issueId)?.rawDescription ?? null, change.newStart),
          dueDate: change.newEnd,
        });
      }
      return { domain: (await syncUntil(() => true)).domain, changes };
    }),

    setDependencies: guard(async (key, id, blockedBy) => {
      const current = await m.issueBlockers(key, id);
      const desired = new Set(blockedBy);
      const existing = new Set(current.map((c) => c.blockerId));
      for (const { relationId, blockerId } of current) {
        if (!desired.has(blockerId)) await m.removeBlocker(key, relationId);
      }
      for (const blockerId of desired) {
        if (!existing.has(blockerId)) await m.addBlocker(key, id, blockerId);
      }
      return { domain: (await syncUntil(() => true)).domain };
    }),

    setContributors: guard(async (key, id, contributorIds) => {
      const domain = needDomain();
      const issue = domain.issues.find((i) => i.id === id);
      if (!issue) throw fail('Issue inconnue', 404);
      const byId = new Map(domain.users.map((u) => [u.id, u]));
      const selected = contributorIds.map((uid) => byId.get(uid)).filter(Boolean);
      await m.updateIssue(key, issue.id, { description: setContributors(issue.rawDescription, selected) });
      const addedUsers = contributorIds.filter((uid) => !issue.contributorIds.includes(uid)).map((uid) => byId.get(uid)).filter(Boolean);
      if (addedUsers.length) {
        await m.addComment(key, issue.id, `Ajouté·e·s comme contributeurs : ${addedUsers.map((u) => u.name).join(', ')}`);
        for (const u of addedUsers) await m.subscribeToIssue(key, issue.id, u.id);
      }
      // La resynchronisation complète côté backend purge les parts de qui
      // n'est plus contributeur (Linear reste la source de vérité).
      return { domain: (await syncUntil(() => true)).domain };
    }),

    createIssue: guard(async (key, body) => {
      const { issue, warnings } = await createIssueWithExtras({ linear: m, key, body, domain: getDomain() ?? null });
      const snap = await syncUntil((d) => d.issues.some((i) => i.id === issue.id));
      return { domain: snap.domain, issueId: issue.id, warnings };
    }),

    deleteIssue: guard(async (key, id, confirm) => {
      const issue = needDomain().issues.find((i) => i.id === id);
      if (!issue) throw fail('Tâche introuvable', 404);
      if (confirm !== issue.identifier) throw fail('Confirmation incorrecte : saisissez l\'identifiant de la tâche', 400);
      await m.deleteIssue(key, issue.id);
      return { domain: (await syncUntil((d) => !d.issues.some((i) => i.id === issue.id))).domain };
    }),

    updateProject: guard(async (key, id, patch) => {
      await m.updateProject(key, id, patch);
      return { domain: (await syncUntil(() => true)).domain };
    }),

    createProject: guard(async (key, body) => {
      const project = await m.createProject(key, buildProjectInput(body));
      const snap = await syncUntil((d) => d.projects.some((p) => p.id === project.id));
      return { domain: snap.domain, projectId: project.id };
    }),

    deleteProject: guard(async (key, id, confirm) => {
      const project = needDomain().projects.find((p) => p.id === id);
      if (!project) throw fail('Projet introuvable', 404);
      if (confirm !== project.name) throw fail('Confirmation incorrecte : saisissez le nom du projet', 400);
      await m.deleteProject(key, project.id);
      return { domain: (await syncUntil((d) => !d.projects.some((p) => p.id === project.id))).domain };
    }),

    createTeam: guard(async (key, body) => {
      const team = await m.createTeam(key, body);
      const snap = await syncUntil((d) => !team?.id || d.teams.some((t) => t.id === team.id));
      return { domain: snap.domain };
    }),

    createMilestone: guard(async (key, body) => {
      const input = buildMilestoneInput(body, needDomain());
      const milestone = await m.createMilestone(key, input);
      const snap = await syncUntil((d) => d.projects.some((p) => p.milestones.some((x) => x.id === milestone.id)));
      return { domain: snap.domain, milestoneId: milestone.id };
    }),

    // `change` : une date ISO (déplacement) ou un objet { name?, targetDate? }.
    updateMilestone: guard(async (key, id, change) => {
      const input = typeof change === 'string' ? { targetDate: change } : { ...change };
      await m.updateMilestone(key, id, input);
      const reflected = (d) => {
        const now = (d.projects ?? []).flatMap((p) => p.milestones).find((x) => x.id === id);
        return !now || (!('name' in input) || now.name === input.name);
      };
      return { domain: (await syncUntil(reflected)).domain };
    }),
  };
}
