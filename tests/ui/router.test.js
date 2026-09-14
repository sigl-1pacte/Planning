import { describe, it, expect } from 'vitest';
import { parseRoute, routeHash } from '../../src/ui/router.js';

describe('router', () => {
  it('reconnaît la vue globale et la vue d’une team', () => {
    expect(parseRoute('')).toEqual({ view: 'global', teamKey: null });
    expect(parseRoute('#/')).toEqual({ view: 'global', teamKey: null });
    expect(parseRoute('#/team/IOT')).toEqual({ view: 'team', teamKey: 'IOT' });
    expect(parseRoute('#/nimporte')).toEqual({ view: 'global', teamKey: null });
  });

  it('reconstruit le fragment', () => {
    expect(routeHash({ view: 'team', teamKey: 'IOT' })).toBe('#/team/IOT');
    expect(routeHash({ view: 'global', teamKey: null })).toBe('#/');
  });
});
