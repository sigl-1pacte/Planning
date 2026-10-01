// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { weekCardHtml, weekLabel } from '../../src/ui/render/weekCard.js';

const users = [{ id: 'u1', name: 'Sacha Martin' }];
const projects = [{ id: 'p1', color: '#0D7278' }];
const issue = (over) => ({ id: 'i1', identifier: 'IOT-1', title: 'Conception', projectId: 'p1', ...over });

function render(rows, capacity = 28) {
  const el = document.createElement('div');
  el.innerHTML = weekCardHtml({
    user: users[0], users, weekStart: '2026-09-14', rows, capacity, ceiling: 80, projects, holidays: new Set(),
  });
  return el;
}

describe('weekLabel', () => {
  it('nomme la semaine, sur un ou deux mois', () => {
    expect(weekLabel('2026-09-14')).toBe('Semaine du 14 au 20 sept.');
    expect(weekLabel('2026-09-28')).toBe('Semaine du 28 sept. au 4 oct.');
  });
});

describe('weekCardHtml', () => {
  it('résume la semaine : jauge, barre composée, tâches et jours occupés', () => {
    const el = render([
      { issue: issue(), days: ['2026-09-14', '2026-09-15'], hours: 14, realHours: 0, unassigned: false },
      { issue: issue({ id: 'i2', identifier: 'IOT-2', title: 'Sans personne', projectId: null }), days: ['2026-09-16'], hours: 7, realHours: 0, unassigned: true },
    ]);
    expect(el.querySelector('.wc-who').textContent).toContain('Semaine du 14 au 20 sept.');
    expect(el.querySelector('.wc-gauge text').textContent).toBe('75%');
    expect(el.querySelector('.wc-sum').textContent).toContain('21,0 h prévues sur 28,0 h');
    expect(el.querySelectorAll('.wc-bar i')).toHaveLength(2);
    expect(el.querySelector('.wc-bar i.ua')).not.toBeNull();
    const rows = [...el.querySelectorAll('.wc-row')];
    expect(rows.map((r) => r.dataset.open)).toEqual(['i1', 'i2']);
    expect([...rows[0].querySelectorAll('.wc-days i')].map((d) => d.classList.contains('on'))).toEqual([true, true, false, false, false, false, false]);
    expect(rows[0].querySelector('.wc-h').textContent).toBe('14,0 h67 %');
    expect(rows[1].textContent).toContain('sans personne, réparti dans la team');
    expect(el.querySelector('.wc-over')).toBeNull();
  });

  it('marque le dépassement de capacité', () => {
    const el = render([{ issue: issue(), days: ['2026-09-14'], hours: 35, realHours: 0, unassigned: false }]);
    expect(el.querySelector('.wc-over')).not.toBeNull();
    expect(el.querySelector('.wc-gauge text').textContent).toBe('125%');
  });

  it('dit quand la semaine est vide', () => {
    expect(render([]).querySelector('.wc-empty').textContent).toBe('Aucune tâche cette semaine.');
  });
});
