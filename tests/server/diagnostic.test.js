import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { buildDiagnostic, registerDiagnosticRoute } from '../../src/server/diagnostic.js';
import { QUERIES } from '../../src/server/linear/queries.js';
import { rawWorkspace } from '../fixtures/workspace.js';
import { buildApp } from '../../src/server/app.js';
import { createTestDb } from '../helpers/db.js';
import { LinearAuthError } from '../../src/server/linear/client.js';

describe('buildDiagnostic', () => {
  it('montre ce que l\'application a compris de chaque issue', () => {
    const { users, issues } = rawWorkspace();
    const entries = buildDiagnostic({ users, issues });
    const conception = entries.find((e) => e.identifier === 'IOT-11');
    expect(conception).toEqual({
      identifier: 'IOT-11',
      title: 'Conception',
      description: 'Starting date: 16/09/2026\nContributors: @sacha @louis',
      startingDate: { ok: true, date: '2026-09-16' },
      dueDate: '2026-09-25',
      estimate: 8,
      contributors: [{ id: 'u-sacha', name: 'Sacha' }, { id: 'u-louis', name: 'Louis' }],
      unresolvedMentions: [],
      contributorsSource: 'description',
      blockedBy: [],
      unplannedReason: null,
    });
    expect(entries.find((e) => e.identifier === 'IOT-12').blockedBy).toEqual(['IOT-11']);
    expect(entries.find((e) => e.identifier === 'IOT-13').startingDate).toEqual({
      ok: false, reason: 'Aucune ligne « Starting date » dans la description',
    });
  });

  it('expose la route avec une limite bornée', async () => {
    const fetchDiagnosticSample = vi.fn(async () => {
      const { users, issues } = rawWorkspace();
      return { users, issues };
    });
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.linearKey = 'k'; });
    registerDiagnosticRoute(app, { fetchDiagnosticSample });
    const res = await app.inject({ method: 'GET', url: '/api/diagnostic?limit=500' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(4);
    expect(fetchDiagnosticSample).toHaveBeenCalledWith('k', 50);
    await app.close();
  });

  it('protège la route de diagnostic par la clé dans l\'application réelle', async () => {
    const fetchDiagnosticSample = vi.fn();
    const app = buildApp({
      db: await createTestDb(),
      store: { get: vi.fn(), forceRefresh: vi.fn() },
      validateKey: async (k) => { if (k !== 'good') throw new LinearAuthError(); return {}; },
    });
    registerDiagnosticRoute(app, { fetchDiagnosticSample });
    expect((await app.inject({ method: 'GET', url: '/api/diagnostic' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/%61pi/diagnostic' })).statusCode).toBe(401);
    expect(fetchDiagnosticSample).not.toHaveBeenCalled();
    await app.close();
  });

  it('ajoute la requête d\'échantillon aux requêtes contrôlées', () => {
    expect(QUERIES).toHaveLength(7);
  });
});
