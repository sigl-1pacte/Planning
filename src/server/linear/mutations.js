import { gql } from './client.js';

const ISSUE_FIELDS = 'id identifier title description estimate dueDate updatedAt state { type } assignee { id } team { id } project { id }';

const ISSUE_UPDATE = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
}`;

const ISSUE_CREATE = `mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
}`;

const ISSUE_BLOCKERS = `query IssueBlockers($id: String!) {
  issue(id: $id) { inverseRelations(first: 50) { nodes { id type issue { id } } } }
}`;

const ISSUE_RELATION_CREATE = `mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) { success }
}`;

const ISSUE_RELATION_DELETE = `mutation IssueRelationDelete($id: String!) {
  issueRelationDelete(id: $id) { success }
}`;

const PROJECT_FIELDS = 'id name color startDate targetDate teams { nodes { id } } projectMilestones { nodes { id name targetDate } }';

const PROJECT_UPDATE = `mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) { success project { ${PROJECT_FIELDS} } }
}`;

const PROJECT_CREATE = `mutation ProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) { success project { ${PROJECT_FIELDS} } }
}`;

const TEAM_CREATE = `mutation TeamCreate($input: TeamCreateInput!) {
  teamCreate(input: $input) { success team { id key name } }
}`;

const COMMENT_CREATE = `mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { id } }
}`;

export const MUTATIONS = [
  ISSUE_UPDATE, ISSUE_CREATE, ISSUE_RELATION_CREATE, ISSUE_RELATION_DELETE,
  PROJECT_UPDATE, PROJECT_CREATE, TEAM_CREATE, COMMENT_CREATE,
];

export async function updateIssue(key, issueId, input, opts) {
  const data = await gql(key, ISSUE_UPDATE, { id: issueId, input }, opts);
  if (!data.issueUpdate.success) throw new Error('Linear a refusé la modification');
  return data.issueUpdate.issue;
}

export async function createIssue(key, input, opts) {
  const data = await gql(key, ISSUE_CREATE, { input }, opts);
  if (!data.issueCreate.success) throw new Error('Linear a refusé la création');
  return data.issueCreate.issue;
}

export async function issueBlockers(key, issueId, opts) {
  const data = await gql(key, ISSUE_BLOCKERS, { id: issueId }, opts);
  return data.issue.inverseRelations.nodes
    .filter((r) => r.type === 'blocks')
    .map((r) => ({ relationId: r.id, blockerId: r.issue.id }));
}

export async function addBlocker(key, issueId, blockerId, opts) {
  const data = await gql(key, ISSUE_RELATION_CREATE, { input: { issueId: blockerId, relatedIssueId: issueId, type: 'blocks' } }, opts);
  if (!data.issueRelationCreate.success) throw new Error('Linear a refusé l\'ajout de la dépendance');
}

export async function removeBlocker(key, relationId, opts) {
  const data = await gql(key, ISSUE_RELATION_DELETE, { id: relationId }, opts);
  if (!data.issueRelationDelete.success) throw new Error('Linear a refusé le retrait de la dépendance');
}

export async function updateProject(key, projectId, input, opts) {
  const data = await gql(key, PROJECT_UPDATE, { id: projectId, input }, opts);
  if (!data.projectUpdate.success) throw new Error('Linear a refusé la modification du projet');
  return data.projectUpdate.project;
}

export async function createProject(key, input, opts) {
  const data = await gql(key, PROJECT_CREATE, { input }, opts);
  if (!data.projectCreate.success) throw new Error('Linear a refusé la création du projet');
  return data.projectCreate.project;
}

export async function createTeam(key, input, opts) {
  const data = await gql(key, TEAM_CREATE, { input }, opts);
  if (!data.teamCreate.success) throw new Error('Linear a refusé la création de la team');
  return data.teamCreate.team;
}

export async function addComment(key, issueId, body, opts) {
  const data = await gql(key, COMMENT_CREATE, { input: { issueId, body } }, opts);
  if (!data.commentCreate.success) throw new Error('Linear a refusé l\'ajout du commentaire');
}

// Un simple texte « @nom » posté via l'API n'est jamais converti en mention
// réelle (Linear ne fait cette conversion que dans son propre éditeur). La
// seule façon documentée de produire une mention identifiante — donc une
// notification — depuis l'API est d'inclure l'URL de profil en clair dans le
// texte ; Linear la convertit alors en mention à l'affichage.
// https://linear.app/developers/agent-interaction
export function mentionUrl(orgUrlKey, user) {
  return `https://linear.app/${orgUrlKey}/profiles/${encodeURIComponent(user.displayName ?? user.name)}`;
}
