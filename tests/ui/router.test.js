import { describe, it, expect } from 'vitest';
import { parseRoute, routeHash } from '../../src/ui/router.js';

describe('router', () => {
  it('reconnaît la vue globale et la vue d’une team', () => {
    expect(parseRoute('')).toEqual({ view: 'global', teamKey: null, tab: null });
    expect(parseRoute('#/')).toEqual({ view: 'global', teamKey: null, tab: null });
    expect(parseRoute('#/team/IOT')).toEqual({ view: 'team', teamKey: 'IOT', tab: null });
    expect(parseRoute('#/nimporte')).toEqual({ view: 'global', teamKey: null, tab: null });
  });

  it('retombe sur la vue globale si la clé de team est mal encodée', () => {
    expect(parseRoute('#/team/%E0')).toEqual({ view: 'global', teamKey: null, tab: null });
  });

  it('reconstruit le fragment', () => {
    expect(routeHash({ view: 'team', teamKey: 'IOT', tab: null })).toBe('#/team/IOT');
    expect(routeHash({ view: 'global', teamKey: null, tab: null })).toBe('#/');
  });

  it('reconnaît l’onglet des tâches non planifiées, global et par team', () => {
    expect(parseRoute('#/unplanned')).toEqual({ view: 'global', teamKey: null, tab: 'unplanned' });
    expect(parseRoute('#/team/IOT/unplanned')).toEqual({ view: 'team', teamKey: 'IOT', tab: 'unplanned' });
    expect(parseRoute('#/')).toEqual({ view: 'global', teamKey: null, tab: null });
  });

  it('reconstruit le fragment avec l’onglet', () => {
    expect(routeHash({ view: 'global', teamKey: null, tab: 'unplanned' })).toBe('#/unplanned');
    expect(routeHash({ view: 'team', teamKey: 'IOT', tab: 'unplanned' })).toBe('#/team/IOT/unplanned');
  });
});
