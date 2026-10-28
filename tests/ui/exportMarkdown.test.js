import { describe, it, expect } from 'vitest';
import { buildMarkdown, markdownFileName } from '../../src/ui/exportMarkdown.js';
import { mapWorkspace } from '../../src/server/linear/mapper.js';
import { rawWorkspace } from '../fixtures/workspace.js';

const domain = () => mapWorkspace(rawWorkspace());
const global = { view: 'global', teamKey: null };
const options = (route) => ({ route, showCanceled: false, today: '2026-10-25', fetchedAt: '2026-10-25T08:00:00.000Z' });

describe('buildMarkdown', () => {
  it('décrit toutes les teams, leurs projets, jalons et tâches', () => {
    const md = buildMarkdown(domain(), options(global));
    expect(md).toMatch(/^# 1PACTE Planning · toutes les teams/);
    expect(md).toContain('## Team IoT (IOT)');
    expect(md).toContain('## Team Web (WEB)');
    expect(md).toContain('### Projet : Réalisation POC v1');
    expect(md).toContain('  - 05/11/2026 · Objet construit');
    expect(md).toContain('#### IOT-11 · Conception');
    expect(md).toContain('- Statut : En cours (Linear : In Progress)');
    expect(md).toContain('- Dates : du 16/09/2026 au 25/09/2026');
    expect(md).toContain('- Contributeurs : Sacha, Louis');
    expect(md).toContain('### Hors projet');
    expect(md).toContain('#### WEB-1 · Hors projet');
    expect(md).not.toContain('—');
  });

  it('suit le filtre de la vue, et le dit', () => {
    const md = buildMarkdown(domain(), { ...options(global), filter: (i) => i.identifier === 'IOT-11', filterLabel: 'personne : Sacha' });
    expect(md).toContain('Vue filtrée (personne : Sacha) : seules les tâches retenues figurent ci-dessous.');
    expect(md).toContain('#### IOT-11 · Conception');
    expect(md).not.toContain('#### IOT-12');
    expect(md).not.toContain('#### WEB-1');
  });

  it('garde la description libre, sans les lignes structurées', () => {
    const md = buildMarkdown(domain(), options(global));
    const task = md.slice(md.indexOf('#### IOT-13'));
    expect(task).toContain('> Pas encore planifiée');
    expect(task).toContain('- Dates : non planifiée');
    expect(task).not.toContain('> Starting date');
  });

  it('rend les dépendances lisibles dans les deux sens et en liste', () => {
    const md = buildMarkdown(domain(), options(global));
    expect(md).toContain('- Bloque : IOT-12 (Software)');
    expect(md).toContain('- Bloquée par : IOT-11 (Conception)');
    expect(md).toContain('- IOT-11 (Conception) [En cours, fin 25/09/2026] bloque IOT-12 (Software) [À faire, début 28/09/2026]');
  });

  it('signale un conflit de dépendance', () => {
    const raw = rawWorkspace();
    raw.issues[1].description = 'Starting date: 20/09/2026';
    const md = buildMarkdown(mapWorkspace(raw), options(global));
    expect(md).toContain('IOT-11 (Conception) **conflit : commence avant sa fin**');
    expect(md).toMatch(/bloque IOT-12 \(Software\) \[.*\] · \*\*conflit\*\*/);
    expect(md).toContain('- Conflits de dépendances : 1');
  });

  it('se limite à la team ouverte', () => {
    const md = buildMarkdown(domain(), options({ view: 'team', teamKey: 'WEB' }));
    expect(md).toMatch(/^# 1PACTE Planning · Web/);
    expect(md).not.toContain('## Team IoT');
    expect(md).toContain('#### WEB-1 · Hors projet');
  });

  it('nomme le fichier selon la vue', () => {
    expect(markdownFileName(domain(), global, '2026-10-25')).toBe('planning-toutes-les-teams-2026-10-25.md');
    expect(markdownFileName(domain(), { view: 'team', teamKey: 'IOT' }, '2026-10-25')).toBe('planning-IOT-2026-10-25.md');
  });
});
