import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// En production, l'API est l'Edge Function Supabase, port des routes
// Fastify : une route ajoutée d'un seul côté marche en local et dans les
// tests, mais rend 404 une fois déployée.
const routes = (file) => new Set([...readFileSync(resolve(process.cwd(), file), 'utf8')
  .matchAll(/app\.(get|post|put|delete)\('(\/api[^']*)'/g)].map(([, m, path]) => `${m.toUpperCase()} ${path}`));

// Propres à l'Edge Function, volontairement.
const EDGE_ONLY = new Set(['GET /api/diagnostic']);

describe('routes Fastify et Edge Function', () => {
  it('sont les mêmes', () => {
    const fastify = routes('src/server/app.js');
    const edge = routes('supabase/functions/api/index.ts');
    expect([...fastify].filter((r) => !edge.has(r)), 'absentes de l\'Edge Function').toEqual([]);
    expect([...edge].filter((r) => !fastify.has(r) && !EDGE_ONLY.has(r)), 'absentes de Fastify').toEqual([]);
  });
});
