import { describe, it, expect } from 'vitest';

describe('outillage', () => {
  it('exécute les tests en ESM', () => {
    expect([1, 2, 3].at(-1)).toBe(3);
  });
});
