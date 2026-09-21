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
