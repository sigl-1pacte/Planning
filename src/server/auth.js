import { createHash } from 'node:crypto';
import { LinearAuthError } from './linear/client.js';

export const fingerprint = (key) => createHash('sha256').update(key).digest('hex');

export function createKeyValidator({ fetchViewer, ttlMs = 300_000, now = () => Date.now() }) {
  const cache = new Map();
  return async function validate(key) {
    if (!key) throw new LinearAuthError('Clé Linear manquante');
    const fp = fingerprint(key);
    const hit = cache.get(fp);
    if (hit && hit.expiresAt > now()) return hit.viewer;
    const viewer = await fetchViewer(key);
    cache.set(fp, { viewer, expiresAt: now() + ttlMs });
    return viewer;
  };
}
