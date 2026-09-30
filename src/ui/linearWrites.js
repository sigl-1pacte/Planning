// Écritures vers Linear, faites directement depuis le navigateur avec la clé
// personnelle de l'utilisateur (celle déjà stockée en local) : le backend ne
// reçoit jamais de demande d'écriture vers Linear, il ne sert qu'à lire (et à
// resynchroniser son cache). La logique est celle qui vivait dans les routes
// d'écriture du serveur — mêmes modules purs (mutations, createFlow, parsing,
// reschedule), simplement appelés d'ici.
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from '../server/linear/client.js';
import * as mutations from '../server/linear/mutations.js';
import { createIssueWithExtras, buildProjectInput, buildMilestoneInput, withMove } from '../server/linear/createFlow.js';
import { setStartingDate, setContributors, setDescriptionText, setRealPoints } from '../server/linear/parsing.js';
import { computeReschedule } from '../shared/reschedule.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// Ce qu'une modification de tâche envoie à Linear, calculé depuis le domaine.
// Pur : sert à l'écriture elle-même et à son aperçu local (optimistic.js), qui
// doivent produire exactement la même description.
export function issueUpdateInput(domain, id, body) {
  const issue = domain?.issues.find((i) => i.id === id);
  const patch = withMove({ ...body }, issue, domain ?? null);
  // Texte libre puis date de début s'appliquent l'un sur l'autre : aucun ne
  // doit écraser l'autre (ni la ligne Contributors).
  if ('description' in patch || 'start' in patch || 'realPoints' in patch) {
    let desc = issue?.rawDescription ?? null;
    if ('description' in patch) desc = setDescriptionText(desc, patch.description);
    if ('realPoints' in patch) desc = setRealPoints(desc, patch.realPoints);
    if ('start' in patch) desc = setStartingDate(desc, patch.start);
    patch.description = desc;
    delete patch.start;
    delete patch.realPoints;
  }
  if ('end' in patch) {
    patch.dueDate = patch.end;
    delete patch.end;
  }
  return patch;
}

// Replanification en cascade : une entrée { id, input } par tâche décalée.
export function rescheduleInputs(domain, id, dates) {
  let changes;
  try {
    changes = computeReschedule(domain.issues, new Set(), id, dates);
  } catch (err) {
    throw Object.assign(err, { statusCode: 400 });
  }
  const byId = new Map(domain.issues.map((i) => [i.id, i]));
  return changes.map((change) => ({
    id: change.issueId,
    start: change.newStart,
    end: change.newEnd,
    input: {
      description: setStartingDate(byId.get(change.issueId)?.rawDescription ?? null, change.newStart),
      dueDate: change.newEnd,
    },
  }));
}

export function contributorsInput(domain, id, contributorIds) {
  const issue = domain.issues.find((i) => i.id === id);
  if (!issue) throw fail('Issue inconnue', 404);
  const byId = new Map(domain.users.map((u) => [u.id, u]));
  const selected = contributorIds.map((uid) => byId.get(uid)).filter(Boolean);
  return { issue, selected, input: { description: setContributors(issue.rawDescription, selected) } };
}

// Chaque écriture rend `sync` au lieu de relire Linear elle-même : le
// contrôleur relit une seule fois quand sa file est vide.
//  - sync.full : il faut une synchronisation complète pour la voir.
//    L'incrémentale ne relit que les issues modifiées : ni projets, jalons,
//    teams, ni issues supprimées, ni (par prudence) les relations de dépendance ;
//  - sync.reflected(domain), pour une création seulement : ce qui est créé
//    figure dans ce domaine (une lecture juste après l'écriture peut ne pas
//    encore le montrer). Les modifications, elles, sont vérifiées en rejouant
//    leur aperçu (optimistic.js) sur le domaine relu.
export function createLinearWrites({ getKey, getDomain, AuthError, ApiError, opts, linear }) {
  // `opts` (ex. { fetchImpl }) est transmis à chaque appel GraphQL : sert
  // aux tests, qui branchent un faux Linear.
  const m = linear ?? Object.fromEntries(Object.entries(mutations)
    .filter(([, fn]) => typeof fn === 'function')
    .map(([name, fn]) => [name, (...args) => (opts ? fn(...args, opts) : fn(...args))]));

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

  const milestoneIn = (d, id) => (d.projects ?? []).flatMap((p) => p.milestones).find((x) => x.id === id);

  return {
    updateIssue: guard(async (key, id, body) => {
      const patch = issueUpdateInput(getDomain(), id, body);
      await m.updateIssue(key, id, patch);
      return { sync: { full: false } };
    }),

    reschedule: guard(async (key, id, dates) => {
      const inputs = rescheduleInputs(needDomain(), id, dates);
      for (const { id: issueId, input } of inputs) await m.updateIssue(key, issueId, input);
      return { sync: { full: false }, changes: inputs.map(({ id: issueId, start, end }) => ({ issueId, newStart: start, newEnd: end })) };
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
      return { sync: { full: true } };
    }),

    setContributors: guard(async (key, id, contributorIds) => {
      const { issue, selected, input } = contributorsInput(needDomain(), id, contributorIds);
      await m.updateIssue(key, issue.id, input);
      const addedUsers = selected.filter((u) => !issue.contributorIds.includes(u.id));
      if (addedUsers.length) {
        await m.addComment(key, issue.id, `Ajouté·e·s comme contributeurs : ${addedUsers.map((u) => u.name).join(', ')}`);
        for (const u of addedUsers) await m.subscribeToIssue(key, issue.id, u.id);
      }
      // La resynchronisation côté backend purge les parts de qui n'est plus
      // contributeur (Linear reste la source de vérité).
      return { sync: { full: false } };
    }),

    createIssue: guard(async (key, body) => {
      const { issue, warnings } = await createIssueWithExtras({ linear: m, key, body, domain: getDomain() ?? null });
      return { sync: { full: false, reflected: (d) => d.issues.some((i) => i.id === issue.id) }, issueId: issue.id, warnings };
    }),

    deleteIssue: guard(async (key, id, confirm) => {
      const issue = needDomain().issues.find((i) => i.id === id);
      if (!issue) throw fail('Tâche introuvable', 404);
      if (confirm !== issue.identifier) throw fail('Confirmation incorrecte : saisissez l\'identifiant de la tâche', 400);
      await m.deleteIssue(key, issue.id);
      return { sync: { full: true } };
    }),

    updateProject: guard(async (key, id, patch) => {
      await m.updateProject(key, id, patch);
      return { sync: { full: true } };
    }),

    createProject: guard(async (key, body) => {
      const project = await m.createProject(key, buildProjectInput(body));
      return { sync: { full: true, reflected: (d) => d.projects.some((p) => p.id === project.id) }, projectId: project.id };
    }),

    deleteProject: guard(async (key, id, confirm) => {
      const project = needDomain().projects.find((p) => p.id === id);
      if (!project) throw fail('Projet introuvable', 404);
      if (confirm !== project.name) throw fail('Confirmation incorrecte : saisissez le nom du projet', 400);
      await m.deleteProject(key, project.id);
      return { sync: { full: true } };
    }),

    createTeam: guard(async (key, body) => {
      const team = await m.createTeam(key, body);
      return { sync: { full: true, reflected: (d) => !team?.id || d.teams.some((t) => t.id === team.id) } };
    }),

    createMilestone: guard(async (key, body) => {
      const input = buildMilestoneInput(body, needDomain());
      const milestone = await m.createMilestone(key, input);
      return { sync: { full: true, reflected: (d) => Boolean(milestoneIn(d, milestone.id)) }, milestoneId: milestone.id };
    }),

    // `change` : une date ISO (déplacement) ou un objet { name?, targetDate? }.
    updateMilestone: guard(async (key, id, change) => {
      const input = typeof change === 'string' ? { targetDate: change } : { ...change };
      await m.updateMilestone(key, id, input);
      return { sync: { full: true } };
    }),
  };
}
