import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/db.js';
import { migrate } from '../../../src/server/db/migrate.js';
import {
  getPlanning, updateSettings, ensurePeople, updatePerson, setWeeklyCapacity, deleteWeeklyCapacity,
  setContributions, clearContributions, addHoliday, deleteHoliday, purgeContributions, pruneContributions,
} from '../../../src/server/db/repo.js';

let db;
beforeEach(async () => { db = await createTestDb(); });

describe('migrations', () => {
  it('ne rejoue pas une migration déjà appliquée', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe('repo', () => {
  it('fournit les réglages et jours chômés par défaut', async () => {
    const p = await getPlanning(db);
    expect(p.settings).toEqual({ hoursPerPoint: 5, loadCeilingPct: 80, defaultWeeklyHours: 28 });
    expect(p.holidays).toEqual([
      { day: '2026-11-11', label: 'Armistice' },
      { day: '2026-12-25', label: 'Noël' },
      { day: '2027-01-01', label: 'Jour de l\'an' },
    ]);
    expect(p.people).toEqual([]);
  });

  it('met à jour les réglages', async () => {
    await updateSettings(db, { hoursPerPoint: 4.5, loadCeilingPct: 90, defaultWeeklyHours: 35 });
    expect((await getPlanning(db)).settings).toEqual({ hoursPerPoint: 4.5, loadCeilingPct: 90, defaultWeeklyHours: 35 });
  });

  it('crée les personnes sans écraser celles qui existent', async () => {
    await ensurePeople(db, ['u1', 'u2']);
    await updatePerson(db, 'u1', { role: 'software', defaultWeeklyHours: 20 });
    await ensurePeople(db, ['u1', 'u3']);
    expect((await getPlanning(db)).people).toEqual([
      { linearUserId: 'u1', role: 'software', defaultWeeklyHours: 20, active: true },
      { linearUserId: 'u2', role: null, defaultWeeklyHours: null, active: true },
      { linearUserId: 'u3', role: null, defaultWeeklyHours: null, active: true },
    ]);
  });

  it('pose, remplace et retire une capacité exceptionnelle', async () => {
    await setWeeklyCapacity(db, 'u1', '2026-09-21', 0);
    await setWeeklyCapacity(db, 'u1', '2026-09-21', 14);
    expect((await getPlanning(db)).weeklyCapacities).toEqual([
      { linearUserId: 'u1', weekStart: '2026-09-21', hours: 14 },
    ]);
    await deleteWeeklyCapacity(db, 'u1', '2026-09-21');
    expect((await getPlanning(db)).weeklyCapacities).toEqual([]);
  });

  it('refuse une semaine qui ne commence pas un lundi', async () => {
    await expect(setWeeklyCapacity(db, 'u1', '2026-09-22', 10)).rejects.toThrow();
  });

  it('remplace puis efface les parts d’une issue', async () => {
    await setContributions(db, 'i1', [{ linearUserId: 'u1', share: 60 }, { linearUserId: 'u2', share: 40 }]);
    await setContributions(db, 'i1', [{ linearUserId: 'u1', share: 100 }]);
    expect((await getPlanning(db)).contributions).toEqual([{ issueId: 'i1', linearUserId: 'u1', share: 100 }]);
    await clearContributions(db, 'i1');
    expect((await getPlanning(db)).contributions).toEqual([]);
  });

  it('ajoute et retire un jour chômé', async () => {
    await addHoliday(db, '2026-12-24', 'Pont');
    await deleteHoliday(db, '2026-11-11');
    expect((await getPlanning(db)).holidays.map((h) => h.day)).toEqual(['2026-12-24', '2026-12-25', '2027-01-01']);
  });

  it('purge les parts des contributeurs disparus', async () => {
    await setContributions(db, 'i1', [{ linearUserId: 'u1', share: 50 }, { linearUserId: 'u2', share: 50 }]);
    await setContributions(db, 'i2', [{ linearUserId: 'u1', share: 100 }]);
    const removed = await purgeContributions(db, [{ issueId: 'i1', linearUserId: 'u1' }]);
    expect(removed).toBe(2);
    expect((await getPlanning(db)).contributions).toEqual([{ issueId: 'i1', linearUserId: 'u1', share: 50 }]);
  });

  it('retire les parts d\'une issue pour qui n\'est plus contributeur, sans toucher les autres issues', async () => {
    await setContributions(db, 'i1', [{ linearUserId: 'u1', share: 50 }, { linearUserId: 'u2', share: 50 }]);
    await setContributions(db, 'i2', [{ linearUserId: 'u2', share: 100 }]);
    await pruneContributions(db, 'i1', ['u1']);
    expect((await getPlanning(db)).contributions).toEqual([
      { issueId: 'i1', linearUserId: 'u1', share: 50 },
      { issueId: 'i2', linearUserId: 'u2', share: 100 },
    ]);
  });

  it('retire toutes les parts d\'une issue quand la liste voulue est vide', async () => {
    await setContributions(db, 'i1', [{ linearUserId: 'u1', share: 100 }]);
    await pruneContributions(db, 'i1', []);
    expect((await getPlanning(db)).contributions).toEqual([]);
  });
});
