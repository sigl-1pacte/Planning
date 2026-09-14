import { gql } from './client.js';

const PAGE_SIZE = 25;
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

const TEAMS = `query Teams($after: String) {
  teams(first: ${PAGE_SIZE}, after: $after) { nodes { id key name } ${PAGE_INFO} }
}`;

const USERS = `query Users($after: String) {
  users(first: ${PAGE_SIZE}, after: $after) { nodes { id name displayName email active } ${PAGE_INFO} }
}`;

const PROJECTS = `query Projects($after: String) {
  projects(first: ${PAGE_SIZE}, after: $after) {
    nodes {
      id name color startDate targetDate
      teams { nodes { id } }
      projectMilestones { nodes { id name targetDate } }
    }
    ${PAGE_INFO}
  }
}`;

const ISSUES = `query Issues($after: String, $filter: IssueFilter) {
  issues(first: ${PAGE_SIZE}, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes {
      id identifier title description estimate dueDate updatedAt archivedAt
      state { type }
      assignee { id }
      team { id }
      project { id }
      relations { nodes { type relatedIssue { id } } }
      inverseRelations { nodes { type issue { id } } }
      comments(last: 50) { nodes { id body createdAt } }
    }
    ${PAGE_INFO}
  }
}`;

const VIEWER = 'query Viewer { viewer { id name email } }';

const DIAGNOSTIC_ISSUES = `query DiagnosticIssues($first: Int!) {
  issues(first: $first, orderBy: updatedAt) {
    nodes {
      id identifier title description estimate dueDate updatedAt archivedAt
      state { type }
      assignee { id }
      team { id }
      project { id }
      relations { nodes { type relatedIssue { id } } }
      inverseRelations { nodes { type issue { id } } }
      comments(last: 50) { nodes { id body createdAt } }
    }
  }
}`;

export const QUERIES = [TEAMS, USERS, PROJECTS, ISSUES, VIEWER, DIAGNOSTIC_ISSUES];

export async function paginate(key, query, field, variables, opts) {
  const nodes = [];
  let after = null;
  do {
    const data = await gql(key, query, { ...variables, after }, opts);
    const connection = data[field];
    nodes.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return nodes;
}

export async function fetchViewer(key, opts) {
  return (await gql(key, VIEWER, {}, opts)).viewer;
}

export async function fetchWorkspace(key, opts) {
  const teams = await paginate(key, TEAMS, 'teams', {}, opts);
  const users = await paginate(key, USERS, 'users', {}, opts);
  const projects = await paginate(key, PROJECTS, 'projects', {}, opts);
  const issues = await paginate(key, ISSUES, 'issues', { filter: null }, opts);
  return { teams, users, projects, issues };
}

export function fetchIssuesSince(key, sinceIso, opts) {
  return paginate(key, ISSUES, 'issues', { filter: { updatedAt: { gt: sinceIso } } }, opts);
}

export async function fetchDiagnosticSample(key, limit, opts) {
  const users = await paginate(key, USERS, 'users', {}, opts);
  const data = await gql(key, DIAGNOSTIC_ISSUES, { first: limit }, opts);
  return { users, issues: data.issues.nodes };
}
