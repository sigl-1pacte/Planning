import { STATUS, esc, initials, personColor, fr1, shortDay, longDay, issueStatus } from './render/format.js';
import { defaultWeeklyHours } from '../shared/load.js';

const ro = (label, value) => `<div class="ro"><span>${label}</span><span>${esc(value)}</span></div>`;
const errorSlot = '<p class="warn" data-error hidden></p>';

const SOURCE_HINT = {
  comment: 'Contributeurs lus dans le commentaire « Contributors ».',
  assignee: 'Pas de ligne « Contributors » : l\'assigné porte toute la charge.',
  none: 'Ni ligne « Contributors » ni assigné : la tâche ne pèse sur personne.',
};

function showError(form, message) {
  const slot = form.querySelector('[data-error]');
  slot.textContent = message;
  slot.hidden = false;
}

export function createPanels({ drawer, title, body, closeButton, onMutate, onPrefs, onForgetKey }) {
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
    const editing = body.contains(active) && active.matches('input, select, textarea');
    if (current && !editing) draw();
  }

  function draw() {
    if (!ctx || !current) return;
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    if (current.kind === 'issue') drawIssue(current.id);
    else if (current.kind === 'person') drawPerson(current.id);
    else drawSettings();
  }

  function drawIssue(issueId) {
    const { domain, planning, load, view } = ctx;
    const issue = domain.issues.find((i) => i.id === issueId);
    if (!issue) {
      title.textContent = 'Tâche introuvable';
      body.innerHTML = '<p class="warn">Cette issue ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    const userOf = (id) => domain.users.find((u) => u.id === id);
    const identifierOf = (id) => domain.issues.find((i) => i.id === id)?.identifier ?? id;
    const info = load.issues[issue.id];
    const status = issueStatus(issue, new Set(view.conflicts.map((c) => c.issueId)));
    const blockers = view.conflicts.filter((c) => c.issueId === issue.id).map((c) => identifierOf(c.blockerId));
    const ids = issue.contributorIds;
    const rows = planning.contributions.filter((c) => c.issueId === issue.id && ids.includes(c.linearUserId));
    const equal = ids.length ? Math.round(1000 / ids.length) / 10 : 0;
    const shareOf = (uid) => rows.find((r) => r.linearUserId === uid)?.share ?? equal;

    title.textContent = issue.identifier;
    const schedule = issue.start
      ? ro('Début', longDay(issue.start)) + ro('Échéance', longDay(issue.end))
        + ro('Jours ouvrés', String(info?.days.length ?? 0)) + ro('Heures', `${Math.round(info?.hours ?? 0)} h`)
      : ro('Planification', issue.unplannedReason);

    const sharesForm = ids.length ? `<form data-form="shares">
        ${ids.map((uid) => {
          const user = userOf(uid);
          const person = info?.perPerson[uid];
          return `<div class="cbo">
            <span class="ci" style="background:${personColor(uid, domain.users)}">${esc(initials(user))}</span>
            <span class="cn">${esc(user?.name ?? uid)}</span>
            <input type="number" min="0" step="any" name="${esc(uid)}" value="${shareOf(uid)}" aria-label="Part de ${esc(user?.name ?? uid)}">
            <span class="cx">${person ? `${fr1(person.hours)} h · ${person.ratePct ?? '—'} %` : '—'}</span>
          </div>`;
        }).join('')}
        <p class="hint">Les parts sont ramenées à 100 %. ${rows.length ? 'Répartition ajustée à la main.' : 'Répartition égale par défaut.'}</p>
        ${errorSlot}
        <div class="actions">
          <button class="btn pri" type="submit">Enregistrer les parts</button>
          ${rows.length ? '<button class="btn" type="button" data-action="equal-shares">Répartition égale</button>' : ''}
        </div>
      </form>` : '';

    body.innerHTML = `
      ${blockers.length ? `<div class="warn">Démarre le ${longDay(issue.start)}, avant la fin de ${esc(blockers.join(', '))}.</div>` : ''}
      ${issue.unresolvedMentions.length ? `<div class="warn">Mentions non reconnues : ${issue.unresolvedMentions.map((m) => `@${esc(m)}`).join(', ')}.</div>` : ''}
      ${issue.estimate === null ? '<div class="warn">Sans estimation : la tâche ne compte pour aucune heure.</div>' : ''}
      <div class="fg"><b>${esc(issue.title)}</b></div>
      ${ro('Team', domain.teams.find((t) => t.id === issue.teamId)?.name ?? '—')}
      ${ro('Projet', domain.projects.find((p) => p.id === issue.projectId)?.name ?? 'Sans projet')}
      ${ro('Statut', STATUS[status].label)}
      ${ro('Responsable', userOf(issue.assigneeId)?.name ?? '—')}
      ${ro('Estimation', issue.estimate === null ? 'aucune' : `${issue.estimate} pts`)}
      ${schedule}
      ${ro('Bloquée par', issue.blockedBy.map(identifierOf).join(', ') || 'aucune')}
      <div class="soon">Titre, statut, estimation, dates, assigné et dépendances se modifient dans Linear pour l'instant. L'édition depuis ce site arrivera avec l'écriture vers Linear.</div>
      <div class="sec">Parts des contributeurs</div>
      <p class="hint">${SOURCE_HINT[issue.contributorsSource]}</p>
      ${sharesForm}`;
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
          <div class="fg"><label for="h-day">Date</label><input id="h-day" name="day" type="date"></div>
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
    openIssue: (id) => open({ kind: 'issue', id }),
    openPerson: (id) => open({ kind: 'person', id }),
    openSettings: () => open({ kind: 'settings' }),
    close,
    update,
    selectedIssueId: () => (current?.kind === 'issue' ? current.id : null),
  };
}
