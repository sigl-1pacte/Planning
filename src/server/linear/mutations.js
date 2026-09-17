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

const ISSUE_SUBSCRIBE = `mutation IssueSubscribe($id: String!, $userId: String) {
  issueSubscribe(id: $id, userId: $userId) { success }
}`;

const MILESTONE_UPDATE = `mutation ProjectMilestoneUpdate($id: String!, $input: ProjectMilestoneUpdateInput!) {
  projectMilestoneUpdate(id: $id, input: $input) { success projectMilestone { id name targetDate } }
}`;

export const MUTATIONS = [
  ISSUE_UPDATE, ISSUE_CREATE, ISSUE_RELATION_CREATE, ISSUE_RELATION_DELETE,
  PROJECT_UPDATE, PROJECT_CREATE, TEAM_CREATE, COMMENT_CREATE, ISSUE_SUBSCRIBE, MILESTONE_UPDATE,
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

// Abonne directement quelqu'un à l'issue (fait apparaître les mises à jour
// dans son inbox Linear), sans dépendre du rendu d'une mention dans un
// texte — cette conversion (URL de profil en clair → mention) s'est
// montrée peu fiable dans les retours de la communauté Linear
// (github.com/linear/linear/issues/351), y compris avec la bonne URL.
export async function subscribeToIssue(key, issueId, userId, opts) {
  const data = await gql(key, ISSUE_SUBSCRIBE, { id: issueId, userId }, opts);
  if (!data.issueSubscribe.success) throw new Error('Linear a refusé l\'abonnement');
}

export async function updateMilestone(key, milestoneId, input, opts) {
  const data = await gql(key, MILESTONE_UPDATE, { id: milestoneId, input }, opts);
  if (!data.projectMilestoneUpdate.success) throw new Error('Linear a refusé la modification du jalon');
  return data.projectMilestoneUpdate.projectMilestone;
}
