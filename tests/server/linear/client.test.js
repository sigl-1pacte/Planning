import { describe, it, expect } from 'vitest';
import {
  gql, LINEAR_URL, LinearAuthError, LinearRateLimitError, LinearUnavailableError,
} from '../../../src/server/linear/client.js';
import { QUERIES, paginate, fetchViewer, fetchIssuesSince, fetchWorkspace } from '../../../src/server/linear/queries.js';
import { fakeFetch, jsonResponse } from '../../helpers/fakeFetch.js';

const page = (field, nodes, endCursor = null) => jsonResponse({
  data: { [field]: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } },
});

describe('gql', () => {
  it('envoie la clé brute sans Bearer et renvoie data', async () => {
    const f = fakeFetch([jsonResponse({ data: { viewer: { id: 'u1' } } })]);
    const data = await gql('lin_api_xyz', 'query { viewer { id } }', {}, { fetchImpl: f });
    expect(data).toEqual({ viewer: { id: 'u1' } });
    expect(f.calls[0].url).toBe(LINEAR_URL);
    expect(f.calls[0].headers.Authorization).toBe('lin_api_xyz');
  });

  it('traduit les erreurs d\'authentification', async () => {
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse({}, 401)]) }))
      .rejects.toBeInstanceOf(LinearAuthError);
    const body = { errors: [{ message: 'bad', extensions: { code: 'AUTHENTICATION_ERROR' } }] };
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse(body, 400)]) }))
      .rejects.toBeInstanceOf(LinearAuthError);
  });

  it('traduit le dépassement de quota', async () => {
    const body = { errors: [{ message: 'slow down', extensions: { code: 'RATELIMITED' } }] };
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse(body, 400)]) }))
      .rejects.toBeInstanceOf(LinearRateLimitError);
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse({}, 429)]) }))
      .rejects.toBeInstanceOf(LinearRateLimitError);
  });

  it('traduit l\'indisponibilité', async () => {
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([new TypeError('fetch failed')]) }))
      .rejects.toBeInstanceOf(LinearUnavailableError);
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse({}, 503)]) }))
      .rejects.toBeInstanceOf(LinearUnavailableError);
  });

  it('remonte les autres erreurs GraphQL avec leur message', async () => {
    const body = { errors: [{ message: 'Query too complex' }] };
    await expect(gql('k', 'q', {}, { fetchImpl: fakeFetch([jsonResponse(body, 400)]) }))
      .rejects.toThrow('Erreur GraphQL Linear : Query too complex');
  });
});

describe('requêtes', () => {
  it('ne contient aucune mutation', () => {
    for (const q of QUERIES) expect(q).not.toMatch(/\bmutation\b/i);
  });

  it('suit les curseurs de pagination', async () => {
    const f = fakeFetch([page('teams', [{ id: 't1' }], 'c1'), page('teams', [{ id: 't2' }])]);
    const nodes = await paginate('k', QUERIES[0], 'teams', {}, { fetchImpl: f });
    expect(nodes).toEqual([{ id: 't1' }, { id: 't2' }]);
    expect(f.calls[0].body.variables.after).toBeNull();
    expect(f.calls[1].body.variables.after).toBe('c1');
  });

  it('lit l\'utilisateur de la clé', async () => {
    const f = fakeFetch([jsonResponse({ data: { viewer: { id: 'u1', name: 'Sacha', email: 's@ex.fr' } } })]);
    expect(await fetchViewer('k', { fetchImpl: f })).toEqual({ id: 'u1', name: 'Sacha', email: 's@ex.fr' });
  });

  it('filtre les issues modifiées après une date', async () => {
    const f = fakeFetch([page('issues', [{ id: 'i1' }])]);
    expect(await fetchIssuesSince('k', '2026-09-14T10:00:00.000Z', { fetchImpl: f })).toEqual([{ id: 'i1' }]);
    expect(f.calls[0].body.variables.filter).toEqual({ updatedAt: { gt: '2026-09-14T10:00:00.000Z' } });
  });

  it('charge tout le workspace', async () => {
    const f = fakeFetch([
      page('teams', [{ id: 't1' }]),
      page('users', [{ id: 'u1' }]),
      page('projects', [{ id: 'p1' }]),
      page('issues', [{ id: 'i1' }]),
    ]);
    expect(await fetchWorkspace('k', { fetchImpl: f })).toEqual({
      teams: [{ id: 't1' }], users: [{ id: 'u1' }], projects: [{ id: 'p1' }], issues: [{ id: 'i1' }],
    });
    expect(f.calls[3].body.variables.filter).toBeNull();
  });
});
