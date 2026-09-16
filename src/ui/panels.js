import { esc, initials, personColor, fr1, shortDay, longDay, ddmmyyyy } from './render/format.js';
import { defaultWeeklyHours } from '../shared/load.js';

// [Hypothèse] Le barème d'estimation Linear de cette équipe plafonne à 8
// points (Fibonacci tronqué) ; à ajuster si le barème change côté Linear.
const FIB = [1, 2, 3, 5, 8];

const ro = (label, value) => `<div class="ro"><span>${label}</span><span>${esc(value)}</span></div>`;
const errorSlot = '<p class="warn" data-error hidden></p>';

const SOURCE_HINT = {
  description: 'Contributeurs lus dans la ligne « Contributors » de la description.',
  assignee: 'Pas de ligne « Contributors » : l\'assigné porte toute la charge.',
  none: 'Ni ligne « Contributors » ni assigné : la tâche ne pèse sur personne.',
};

function showError(form, message) {
  const slot = form.querySelector('[data-error]');
  slot.textContent = message;
  slot.hidden = false;
}

export function createPanels({ drawer, title, body, closeButton, onMutate, onPrefs, onForgetKey, onWrite }) {
  let current = null;
  let ctx = null;

  function open(next) {
    current = next;
    draw();
  }

  function close() {
    current = null;
    drawer.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
    body.innerHTML = '';
  }

  function update(nextContext) {
    ctx = nextContext;
    const active = document.activeElement;
    // Une case à cocher n'est jamais "en cours de saisie" (contrairement à un
    // champ texte) : son changement est une action ponctuelle déjà terminée,
    // donc ne doit pas bloquer le redessin qui affiche son effet (ici, les
    // parts recalculées sous la liste des contributeurs).
    const editing = body.contains(active) && active.matches('input:not([type="checkbox"]), select, textarea');
    if (current && !editing) draw();
  }

  function draw() {
    if (!ctx || !current) return;
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    if (current.kind === 'issue') drawIssue(current.id, current.seed);
    else if (current.kind === 'person') drawPerson(current.id);
    else if (current.kind === 'proj') drawProj(current.id, current.seed);
    else if (current.kind === 'team') drawNewTeam();
    else drawSettings();
  }

  function drawIssue(issueId, seed) {
    const { domain, planning, load, view } = ctx;
    if (issueId === null) return drawNewIssue(seed ?? {});
    const issue = domain.issues.find((i) => i.id === issueId);
    if (!issue) {
      title.textContent = 'Tâche introuvable';
      body.innerHTML = '<p class="warn">Cette issue ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    const userOf = (id) => domain.users.find((u) => u.id === id);
    const identifierOf = (id) => domain.issues.find((i) => i.id === id)?.identifier ?? id;
    const info = load.issues[issue.id];
    const blockers = view.conflicts.filter((c) => c.issueId === issue.id).map((c) => identifierOf(c.blockerId));
    const ids = issue.contributorIds;
    const rows = planning.contributions.filter((c) => c.issueId === issue.id && ids.includes(c.linearUserId));
    const equal = ids.length ? Math.round(1000 / ids.length) / 10 : 0;
    const shareOf = (uid) => rows.find((r) => r.linearUserId === uid)?.share ?? equal;

    title.textContent = issue.identifier;
    const otherIssues = domain.issues.filter((x) => x.id !== issue.id);

    // La dernière part se calcule automatiquement (100 moins les autres) : le
    // total fait toujours 100 sans calcul mental, comme un partage d'addition.
    // Avec un seul contributeur, sa part n'a pas d'importance (il porte 100 %
    // de toute façon) : le champ reste alors librement éditable.
    const lastUid = ids.length > 1 ? ids[ids.length - 1] : null;
    const lastValue = lastUid !== null
      ? Math.round((100 - ids.slice(0, -1).reduce((s, uid) => s + shareOf(uid), 0)) * 10) / 10
      : 0;
    const sharesForm = ids.length ? `<form data-form="shares">
        ${ids.map((uid) => {
          const user = userOf(uid);
          const person = info?.perPerson[uid];
          const isLast = uid === lastUid;
          const value = isLast ? lastValue : shareOf(uid);
          return `<div class="cbo">
            <span class="ci" style="background:${personColor(uid, domain.users)}">${esc(initials(user))}</span>
            <span class="cn">${esc(user?.name ?? uid)}</span>
            <input type="number" min="0" step="any" name="${esc(uid)}" value="${value}"
              ${isLast ? 'readonly title="Calculée pour que le total fasse 100 %"' : ''}
              aria-label="Part de ${esc(user?.name ?? uid)}">
            <span class="cx">${person ? `${fr1(person.hours)} h · ${person.ratePct ?? '—'} %` : '—'}</span>
          </div>`;
        }).join('')}
        <p class="hint">${lastUid !== null ? `La part de ${esc(userOf(lastUid)?.name ?? lastUid)} complète les autres jusqu'à 100 %.` : 'Les parts sont ramenées à 100 %.'} ${rows.length ? 'Répartition ajustée à la main.' : 'Répartition égale par défaut.'}</p>
        ${errorSlot}
        <div class="actions">
          <button class="btn pri" type="submit">Enregistrer les parts</button>
          ${rows.length ? '<button class="btn" type="button" data-action="equal-shares">Répartition égale</button>' : ''}
        </div>
      </form>` : '';

    body.innerHTML = `
      ${blockers.length ? `<div class="warn">Démarre avant la fin de ${esc(blockers.join(', '))}.</div>` : ''}
      ${issue.unresolvedMentions.length ? `<div class="warn">Mentions non reconnues : ${issue.unresolvedMentions.map((m) => `@${esc(m)}`).join(', ')}.</div>` : ''}
      ${ro('Team', domain.teams.find((t) => t.id === issue.teamId)?.name ?? '—')}
      ${ro('Projet', domain.projects.find((p) => p.id === issue.projectId)?.name ?? 'Sans projet')}
      <div class="fg"><label for="f-title">Titre</label>
        <input id="f-title" data-field="title" value="${esc(issue.title)}"></div>
      <div class="fg"><label for="f-state">Statut</label>
        <select id="f-state" data-field="state">
          ${(domain.workflowStates ?? []).filter((s) => s.teamId === issue.teamId)
            .map((s) => `<option value="${esc(s.id)}"${s.id === issue.stateId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-assignee">Responsable</label>
        <select id="f-assignee" data-field="assignee">
          <option value="">— aucun —</option>
          ${domain.users.map((u) => `<option value="${esc(u.id)}"${u.id === issue.assigneeId ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-estimate">Estimation (points)</label>
        <select id="f-estimate" data-field="estimate">
          <option value="">— aucune —</option>
          ${FIB.map((f) => `<option value="${f}"${f === issue.estimate ? ' selected' : ''}>${f}</option>`).join('')}
        </select></div>
      <div class="f2">
        <div class="fg"><label for="f-start">Début</label><div class="dfield">
          <input id="f-start" type="date" data-field="start" value="${issue.start ?? ''}">
          <span class="dovl">${issue.start ? ddmmyyyy(issue.start) : ''}</span></div></div>
        <div class="fg"><label for="f-end">Échéance</label><div class="dfield">
          <input id="f-end" type="date" data-field="end" value="${issue.end ?? ''}">
          <span class="dovl">${issue.end ? ddmmyyyy(issue.end) : ''}</span></div></div>
      </div>
      ${issue.unplannedReason ? `<p class="hint">${esc(issue.unplannedReason)}</p>` : ''}
      <div class="actions"><button class="btn pri" type="button" data-action="reschedule">Replanifier</button></div>
      <div class="fg"><label for="f-deps">Bloquée par</label>
        <select id="f-deps" data-field="deps" multiple size="6">
          ${otherIssues.map((x) => `<option value="${esc(x.id)}"${issue.blockedBy.includes(x.id) ? ' selected' : ''}>${esc(x.identifier)} · ${esc(x.title)}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Contributeurs</label>
        <div class="chklist" data-field="contributors">
          ${domain.users.map((u) => `<label class="chkrow">
            <input type="checkbox" value="${esc(u.id)}"${issue.contributorIds.includes(u.id) ? ' checked' : ''}>
            <span class="ini" style="background:${personColor(u.id, domain.users)}">${esc(initials(u))}</span>
            <span>${esc(u.name)}</span>
          </label>`).join('')}
        </div></div>
      <p class="hint">${SOURCE_HINT[issue.contributorsSource]} Cocher/décocher ajoute ou retire une personne ; un commentaire signale les nouveaux venus dans Linear.</p>
      <div class="sec">Parts des contributeurs</div>
      ${sharesForm}`;

    body.querySelector('[data-field="title"]').addEventListener('blur', (e) => {
      const value = e.target.value.trim();
      if (value && value !== issue.title) {
        onWrite((api) => api.updateIssue(issue.id, { title: value }), `Titre de ${issue.identifier} modifié`, (api) => api.updateIssue(issue.id, { title: issue.title }));
      }
    });
    body.querySelector('[data-field="assignee"]').addEventListener('change', (e) => {
      const value = e.target.value || null;
      onWrite((api) => api.updateIssue(issue.id, { assigneeId: value }), `Responsable de ${issue.identifier} modifié`, (api) => api.updateIssue(issue.id, { assigneeId: issue.assigneeId }));
    });
    body.querySelector('[data-field="state"]').addEventListener('change', (e) => {
      const value = e.target.value;
      onWrite((api) => api.updateIssue(issue.id, { stateId: value }), `Statut de ${issue.identifier} modifié`, (api) => api.updateIssue(issue.id, { stateId: issue.stateId }));
    });
    body.querySelector('[data-field="estimate"]').addEventListener('change', (e) => {
      const value = e.target.value ? Number(e.target.value) : null;
      onWrite((api) => api.updateIssue(issue.id, { estimate: value }), `Estimation de ${issue.identifier} modifiée`, (api) => api.updateIssue(issue.id, { estimate: issue.estimate }));
    });
    body.querySelector('[data-action="reschedule"]').addEventListener('click', () => {
      const start = body.querySelector('[data-field="start"]').value || undefined;
      const end = body.querySelector('[data-field="end"]').value || undefined;
      if (!start && !end) return;
      onWrite(
        (api) => api.reschedule(issue.id, { start, end }),
        `${issue.identifier} replanifiée`,
        (api) => api.reschedule(issue.id, { start: issue.start ?? undefined, end: issue.end ?? undefined }),
      );
    });
    body.querySelector('[data-field="deps"]').addEventListener('change', (e) => {
      const blockedBy = [...e.target.selectedOptions].map((o) => o.value);
      onWrite((api) => api.setDependencies(issue.id, blockedBy), `Dépendances de ${issue.identifier} modifiées`, (api) => api.setDependencies(issue.id, issue.blockedBy));
    });
    body.querySelector('[data-field="contributors"]').addEventListener('change', (e) => {
      if (e.target.type !== 'checkbox') return;
      const contributorIds = [...body.querySelectorAll('[data-field="contributors"] input:checked')].map((i) => i.value);
      onWrite(
        (api) => api.setContributors(issue.id, contributorIds),
        `Contributeurs de ${issue.identifier} modifiés`,
        (api) => api.setContributors(issue.id, issue.contributorIds),
      );
    });
    if (lastUid !== null) {
      const numberInputs = [...body.querySelectorAll('form[data-form="shares"] input[type="number"]')];
      const lastInput = numberInputs.at(-1);
      const others = numberInputs.slice(0, -1);
      const recomputeLast = () => {
        const sum = others.reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        lastInput.value = Math.round((100 - sum) * 10) / 10;
      };
      for (const inp of others) inp.addEventListener('input', recomputeLast);
    }
  }

  function drawNewIssue({ teamId, projectId }) {
    title.textContent = 'Nouvelle tâche';
    body.innerHTML = `
      <div class="fg"><label for="f-title">Titre</label><input id="f-title" data-field="title"></div>
      ${errorSlot}
      <div class="actions"><button class="btn pri" type="button" data-action="create-issue">Créer la tâche</button></div>`;
    body.querySelector('[data-action="create-issue"]').addEventListener('click', () => {
      const value = body.querySelector('[data-field="title"]').value.trim();
      if (!value) return showError(body, 'Le titre est obligatoire.');
      const input = { teamId, title: value };
      if (projectId) input.projectId = projectId;
      onWrite((api) => api.createIssue(input), `Tâche « ${value} » créée`, null);
    });
  }

  function drawNewProject({ teamId } = {}) {
    const { domain } = ctx;
    title.textContent = 'Nouveau projet';
    body.innerHTML = `
      <div class="fg"><label for="f-pname">Nom du projet</label><input id="f-pname" data-field="pname"></div>
      <div class="fg"><label for="f-pteam">Team</label>
        <select id="f-pteam" data-field="pteam">
          ${domain.teams.map((t) => `<option value="${esc(t.id)}"${t.id === teamId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></div>
      ${errorSlot}
      <div class="actions"><button class="btn pri" type="button" data-action="create-project">Créer le projet</button></div>`;
    body.querySelector('[data-action="create-project"]').addEventListener('click', () => {
      const value = body.querySelector('[data-field="pname"]').value.trim();
      if (!value) return showError(body, 'Le nom est obligatoire.');
      const team = body.querySelector('[data-field="pteam"]').value;
      onWrite((api) => api.createProject({ teamIds: [team], name: value }), `Projet « ${value} » créé`, null);
    });
  }

  function drawNewTeam() {
    title.textContent = 'Nouvelle team';
    body.innerHTML = `
      <div class="fg"><label for="f-tkey">Clé (ex. IOT)</label><input id="f-tkey" data-field="tkey" maxlength="5" style="text-transform:uppercase"></div>
      <div class="fg"><label for="f-tname">Nom</label><input id="f-tname" data-field="tname"></div>
      ${errorSlot}
      <div class="actions"><button class="btn pri" type="button" data-action="create-team">Créer la team</button></div>`;
    body.querySelector('[data-action="create-team"]').addEventListener('click', () => {
      const key = body.querySelector('[data-field="tkey"]').value.trim().toUpperCase();
      const name = body.querySelector('[data-field="tname"]').value.trim();
      if (!key || !name) return showError(body, 'La clé et le nom sont obligatoires.');
      onWrite((api) => api.createTeam({ key, name }), `Team « ${name} » créée`, null);
    });
  }

  function drawProj(projectId, seed) {
    if (projectId === null) return drawNewProject(seed ?? {});
    const { domain } = ctx;
    const project = domain.projects.find((p) => p.id === projectId);
    if (!project) {
      title.textContent = 'Projet introuvable';
      body.innerHTML = '<p class="warn">Ce projet ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    title.textContent = project.name;
    const teamNames = project.teamIds.map((id) => domain.teams.find((t) => t.id === id)?.name ?? id);
    body.innerHTML = `
      <div class="fg"><label for="f-pname">Nom du projet</label>
        <input id="f-pname" data-field="pname" value="${esc(project.name)}"></div>
      ${ro('Teams', teamNames.join(', ') || 'aucune')}
      ${ro('Début', project.startDate ? longDay(project.startDate) : '—')}
      ${ro('Échéance', project.targetDate ? longDay(project.targetDate) : '—')}
      ${project.milestones.length ? `<div class="sec">Jalons</div>${project.milestones.map((m) => ro(m.name, m.date ? longDay(m.date) : '—')).join('')}` : ''}`;
    body.querySelector('[data-field="pname"]').addEventListener('blur', (e) => {
      const value = e.target.value.trim();
      if (value && value !== project.name) {
        onWrite((api) => api.updateProject(project.id, { name: value }), `Nom du projet ${project.name} modifié`, (api) => api.updateProject(project.id, { name: project.name }));
      }
    });
  }

  function drawPerson(userId) {
    const { domain, planning, load } = ctx;
    const user = domain.users.find((u) => u.id === userId);
    if (!user) {
      title.textContent = 'Personne introuvable';
      body.innerHTML = '<p class="warn">Ce membre ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    const person = planning.people.find((p) => p.linearUserId === userId);
    const fallback = defaultWeeklyHours(userId, planning);
    const weeks = load.people[userId] ?? [];
    title.textContent = user.name;
    body.innerHTML = `
      ${ro('Compte Linear', user.email)}
      <form data-form="person">
        <div class="fg"><label for="p-role">Rôle</label>
          <input id="p-role" name="role" value="${esc(person?.role ?? '')}" placeholder="rôle à préciser"></div>
        <div class="fg"><label for="p-hours">Capacité par défaut (h / semaine)</label>
          <input id="p-hours" name="hours" type="number" min="0" step="0.5" value="${person?.defaultWeeklyHours ?? ''}"
            placeholder="${planning.settings.defaultWeeklyHours} (réglage global)"></div>
        ${errorSlot}
        <div class="actions"><button class="btn pri" type="submit">Enregistrer</button></div>
      </form>
      <div class="sec">Capacité semaine par semaine</div>
      <p class="hint">Laissez vide pour reprendre la capacité par défaut (${fr1(fallback)} h). Saisissez 0 pour une absence.</p>
      <p class="warn" data-capacity-error hidden></p>
      ${weeks.map((w) => {
        const override = planning.weeklyCapacities.find((c) => c.linearUserId === userId && c.weekStart === w.weekStart);
        return `<div class="cbo">
          <span class="cn">sem. du ${shortDay(w.weekStart)}</span>
          <input type="number" min="0" step="0.5" data-week="${w.weekStart}" value="${override ? override.hours : ''}"
            placeholder="${fr1(fallback)}" aria-label="Capacité de la semaine du ${shortDay(w.weekStart)}">
          <span class="cx">${fr1(w.hours)} h prévues</span>
        </div>`;
      }).join('')}`;
  }

  function drawSettings() {
    const { planning, prefs } = ctx;
    const s = planning.settings;
    title.textContent = 'Réglages';
    body.innerHTML = `
      <form data-form="settings">
        <div class="f2">
          <div class="fg"><label for="s-hpp">Heures par point</label>
            <input id="s-hpp" name="hoursPerPoint" type="number" min="0.5" step="0.5" value="${s.hoursPerPoint}"></div>
          <div class="fg"><label for="s-ceil">Plafond de charge (%)</label>
            <input id="s-ceil" name="loadCeilingPct" type="number" min="10" max="200" step="5" value="${s.loadCeilingPct}"></div>
        </div>
        <div class="fg"><label for="s-week">Capacité par défaut (h / semaine)</label>
          <input id="s-week" name="defaultWeeklyHours" type="number" min="0" step="0.5" value="${s.defaultWeeklyHours}"></div>
        ${errorSlot}
        <div class="actions"><button class="btn pri" type="submit">Enregistrer les réglages</button></div>
      </form>
      <div class="sec">Jours chômés</div>
      ${planning.holidays.map((h) => `<div class="cbo">
        <span class="cn">${longDay(h.day)} — ${esc(h.label)}</span>
        <button type="button" data-action="delete-holiday" data-day="${h.day}" aria-label="Retirer le ${longDay(h.day)}">×</button>
      </div>`).join('')}
      <form data-form="holiday">
        <div class="f2">
          <div class="fg"><label for="h-day">Date</label><div class="dfield">
            <input id="h-day" name="day" type="date">
            <span class="dovl"></span></div></div>
          <div class="fg"><label for="h-label">Libellé</label><input id="h-label" name="label"></div>
        </div>
        ${errorSlot}
        <div class="actions"><button class="btn" type="submit">Ajouter le jour chômé</button></div>
      </form>
      <div class="sec">Affichage</div>
      <label class="ro"><span>Afficher les issues annulées</span>
        <input type="checkbox" data-pref="showCanceled" ${prefs.showCanceled ? 'checked' : ''}></label>
      <div class="sec">Clé Linear</div>
      <p class="hint">La clé est conservée dans ce navigateur uniquement.</p>
      <div class="actions"><button class="btn" type="button" data-action="forget-key">Changer de clé</button></div>`;
  }

  function submitShares(form) {
    const shares = [...form.querySelectorAll('input[type="number"]')]
      .map((input) => ({ linearUserId: input.name, share: Number(input.value) }));
    const valid = shares.every((s) => input0(s.share)) && shares.reduce((a, s) => a + s.share, 0) > 0;
    if (!valid) return showError(form, 'Les parts doivent être positives et leur somme non nulle.');
    return onMutate((api) => api.setContributions(current.id, shares));
  }

  function submitPerson(form) {
    const raw = form.querySelector('[name="hours"]').value;
    const hours = raw === '' ? null : Number(raw);
    if (hours !== null && !input0(hours)) return showError(form, 'La capacité doit être un nombre positif.');
    const role = form.querySelector('[name="role"]').value.trim() || null;
    return onMutate((api) => api.updatePerson(current.id, { role, defaultWeeklyHours: hours }));
  }

  function submitSettings(form) {
    const read = (name) => Number(form.querySelector(`[name="${name}"]`).value);
    const settings = {
      hoursPerPoint: read('hoursPerPoint'),
      loadCeilingPct: read('loadCeilingPct'),
      defaultWeeklyHours: read('defaultWeeklyHours'),
    };
    const valid = settings.hoursPerPoint > 0
      && Number.isInteger(settings.loadCeilingPct) && settings.loadCeilingPct >= 10 && settings.loadCeilingPct <= 200
      && input0(settings.defaultWeeklyHours);
    if (!valid) {
      return showError(form, 'Heures par point > 0, plafond entier entre 10 et 200 %, capacité positive.');
    }
    return onMutate((api) => api.updateSettings(settings));
  }

  function submitHoliday(form) {
    const day = form.querySelector('[name="day"]').value;
    const label = form.querySelector('[name="label"]').value.trim();
    if (!day || !label) return showError(form, 'Indiquez une date et un libellé.');
    return onMutate((api) => api.addHoliday(day, label));
  }

  const input0 = (n) => Number.isFinite(n) && n >= 0;

  body.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const handlers = { shares: submitShares, person: submitPerson, settings: submitSettings, holiday: submitHoliday };
    handlers[form.dataset.form](form);
  });

  body.addEventListener('input', (event) => {
    const target = event.target;
    if (target.type !== 'date') return;
    const overlay = target.nextElementSibling;
    if (overlay?.classList.contains('dovl')) overlay.textContent = target.value ? ddmmyyyy(target.value) : '';
  });

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'equal-shares') onMutate((api) => api.clearContributions(current.id));
    if (action === 'delete-holiday') onMutate((api) => api.deleteHoliday(button.dataset.day));
    if (action === 'forget-key') onForgetKey();
  });

  body.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.week) {
      const week = target.dataset.week;
      const errorSlotEl = body.querySelector('[data-capacity-error]');
      if (target.value === '') {
        if (errorSlotEl) errorSlotEl.hidden = true;
        onMutate((api) => api.clearCapacity(current.id, week));
        return;
      }
      const hours = Number(target.value);
      if (!input0(hours)) {
        if (errorSlotEl) {
          errorSlotEl.textContent = 'La capacité doit être un nombre positif.';
          errorSlotEl.hidden = false;
        }
        return;
      }
      if (errorSlotEl) errorSlotEl.hidden = true;
      onMutate((api) => api.setCapacity(current.id, week, hours));
      return;
    }
    if (target.dataset.pref) onPrefs({ [target.dataset.pref]: target.checked });
  });

  closeButton.addEventListener('click', close);

  return {
    openIssue: (id, seed) => open({ kind: 'issue', id, seed }),
    openProject: (id, seed) => open({ kind: 'proj', id, seed }),
    openPerson: (id) => open({ kind: 'person', id }),
    openSettings: () => open({ kind: 'settings' }),
    openTeam: () => open({ kind: 'team' }),
    close,
    update,
    selectedIssueId: () => (current?.kind === 'issue' ? current.id : null),
  };
}
