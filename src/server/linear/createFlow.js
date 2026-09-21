import { isValidDate } from '../../shared/calendar.js';
import { setStartingDate, setContributors } from './parsing.js';

// Logique de création partagée par le serveur Fastify et l'Edge Function
// (mêmes règles des deux côtés, testées une seule fois). Tout ce qui peut être
// refusé l'est AVANT le premier appel d'écriture vers Linear : une création
// à moitié faite, qu'on serait tenté de rejouer, créerait des doublons.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

function assertIsoDay(value) {
  const m = ISO_RE.exec(value);
  if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw badRequest(`Date invalide : ${value}`);
}

function unavailable() {
  return Object.assign(new Error('Instantané indisponible'), { statusCode: 503 });
}

// Sans « Starting date » ni échéance, une tâche n'est pas planifiée : elle
// n'apparaît pas sur la frise. start/end vont donc ensemble (ou pas du tout).
function checkedDates(start, end) {
  if (start === undefined && end === undefined) return null;
  if (!start || !end) throw badRequest('Début et échéance vont ensemble');
  assertIsoDay(start);
  assertIsoDay(end);
  if (end < start) throw badRequest('L\'échéance précède le début');
  return { start, end };
}

export function buildProjectInput(body) {
  const { startDate, targetDate, color, ...input } = body;
  if (startDate) assertIsoDay(startDate);
  if (targetDate) assertIsoDay(targetDate);
  if (startDate && targetDate && targetDate < startDate) throw badRequest('L\'échéance précède le début');
  if (color !== undefined && !COLOR_RE.test(color)) throw badRequest(`Couleur invalide : ${color}`);
  if (startDate) input.startDate = startDate;
  if (targetDate) input.targetDate = targetDate;
  if (color) input.color = color;
  return input;
}

export function buildIssuePlan(body, domain) {
  const { start, end, blockedBy = [], contributorIds = [], ...input } = body;
  const dates = checkedDates(start, end);
  const needsDomain = blockedBy.length > 0 || contributorIds.length > 0;
  if (needsDomain && !domain) throw unavailable();

  if (domain) {
    if (input.stateId && !domain.workflowStates.some((s) => s.id === input.stateId && s.teamId === input.teamId)) {
      throw badRequest('Statut inconnu pour cette team');
    }
    if (input.assigneeId && !domain.users.some((u) => u.id === input.assigneeId)) throw badRequest('Responsable inconnu');
    const knownIssues = new Set(domain.issues.map((i) => i.id));
    if (blockedBy.some((id) => !knownIssues.has(id))) throw badRequest('Tâche bloquante inconnue');
    const knownUsers = new Set(domain.users.map((u) => u.id));
    if (contributorIds.some((id) => !knownUsers.has(id))) throw badRequest('Contributeur inconnu');
  }

  const contributors = contributorIds
    .map((id) => domain?.users.find((u) => u.id === id))
    .filter(Boolean);
  let description = dates ? setStartingDate(null, dates.start) : null;
  if (contributors.length) description = setContributors(description, contributors);
  if (description) input.description = description;
  if (dates) input.dueDate = dates.end;
  return { input, blockedBy: [...new Set(blockedBy)], contributors };
}

// Crée la tâche, puis ses dépendances et l'abonnement des contributeurs. Une
// fois la tâche créée, un échec de ces étapes ne fait plus échouer la requête
// (elle existe dans Linear ; l'erreur ferait rejouer la création) : il est
// rendu en `warnings`, que l'interface affiche.
export async function createIssueWithExtras({ linear, key, body, domain }) {
  const { input, blockedBy, contributors } = buildIssuePlan(body, domain);
  const issue = await linear.createIssue(key, input);
  const warnings = [];
  for (const blockerId of blockedBy) {
    try {
      await linear.addBlocker(key, issue.id, blockerId);
    } catch (err) {
      const blocker = domain.issues.find((i) => i.id === blockerId);
      warnings.push(`dépendance à ${blocker?.identifier ?? blockerId} non ajoutée (${err.message})`);
    }
  }
  if (contributors.length) {
    try {
      const names = contributors.map((u) => u.name).join(', ');
      await linear.addComment(key, issue.id, `Ajouté·e·s comme contributeurs : ${names}`);
      for (const u of contributors) await linear.subscribeToIssue(key, issue.id, u.id);
    } catch (err) {
      warnings.push(`contributeurs non notifiés (${err.message})`);
    }
  }
  return { issue, warnings };
}

// Changer la team ou le projet d'une tâche existante. Les statuts sont propres
// à chaque team et un projet n'est rattaché qu'à certaines teams : plutôt que
// de dépendre de ce que Linear fait implicitement, on décide ici.
//  - statut : sans statut demandé, l'équivalent dans la nouvelle team (même
//    type, le premier dans l'ordre du workflow) ;
//  - projet : conservé s'il existe aussi dans la nouvelle team, retiré sinon.
// Tout est validé avant l'appel à Linear.
export function withMove(patch, issue, domain) {
  if (!('teamId' in patch) && !('projectId' in patch)) return patch;
  if (!domain) throw unavailable();
  if (!issue) throw Object.assign(new Error('Tâche introuvable'), { statusCode: 404 });

  const out = { ...patch };
  const targetTeamId = out.teamId ?? issue.teamId;
  const moving = targetTeamId !== issue.teamId;
  if (!domain.teams.some((t) => t.id === targetTeamId)) throw badRequest('Team inconnue');

  if (out.projectId) {
    const project = domain.projects.find((p) => p.id === out.projectId);
    if (!project) throw badRequest('Projet inconnu');
    if (!project.teamIds.includes(targetTeamId)) throw badRequest('Ce projet n\'appartient pas à la team de la tâche');
  } else if (moving && !('projectId' in out) && issue.projectId) {
    const project = domain.projects.find((p) => p.id === issue.projectId);
    if (!project || !project.teamIds.includes(targetTeamId)) out.projectId = null;
  }

  if (moving) {
    const states = domain.workflowStates.filter((s) => s.teamId === targetTeamId).sort((a, b) => a.position - b.position);
    if (out.stateId) {
      if (!states.some((s) => s.id === out.stateId)) throw badRequest('Statut inconnu pour cette team');
    } else {
      const type = domain.workflowStates.find((s) => s.id === issue.stateId)?.type;
      const match = states.find((s) => s.type === type) ?? states.find((s) => s.type === 'unstarted') ?? states[0];
      if (match) out.stateId = match.id;
    }
  }
  return out;
}
