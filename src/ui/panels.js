import { esc, initials, personColor, fr1, shortDay, longDay, ddmmyyyy } from './render/format.js';
import { defaultWeeklyHours } from '../shared/load.js';
import { todayISO } from '../shared/calendar.js';
import { parseDescriptionText } from '../server/linear/parsing.js';
import { enhanceDateFields } from './dateField.js';
import { issuePickerHtml, wireIssuePicker, emptyPickerState } from './issuePicker.js';

// [Hypothèse] Le barème d'estimation Linear de cette équipe plafonne à 21
// points (Fibonacci tronqué) ; à ajuster si le barème change côté Linear.
const FIB = [1, 2, 3, 5, 8, 13, 21];

const ro = (label, value) => `<div class="ro"><span>${label}</span><span>${esc(value)}</span></div>`;
const errorSlot = '<p class="warn" data-error hidden></p>';

const SOURCE_HINT = {
  description: 'Contributeurs lus dans la ligne « Contributors » de la description.',
  assignee: 'Pas de ligne « Contributors » : l\'assigné porte toute la charge.',
  none: 'Ni ligne « Contributors » ni assigné : la tâche ne pèse sur personne.',
};

// Zone de texte à la hauteur de son contenu : ni poignée de redimensionnement
// ni barre de défilement (cf. styles.css).
function autoGrow(area) {
  area.style.height = 'auto';
  if (area.scrollHeight) area.style.height = `${area.scrollHeight + 2}px`;
}

function showError(form, message) {
  const slot = form.querySelector('[data-error]');
  slot.textContent = message;
  slot.hidden = false;
}

export function createPanels({ drawer, title, body, closeButton, onMutate, onPrefs, onForgetKey, onWrite, lastError = () => null }) {
  let current = null;
  let ctx = null;
  let submitting = false;
  // Recherche/filtres de la liste « Bloquée par » : conservés d'un redessin à
  // l'autre du même panneau, remis à zéro quand on en ouvre un autre.
  let pickerState = emptyPickerState();
  // Dernier panneau dessiné : quand c'est le même qui se redessine (chaque
  // coche relit Linear puis redessine tout), la position de défilement et la
  // case qui avait le focus doivent survivre ; à l'ouverture d'un autre, on
  // repart du haut.
  let lastDrawn = null;

  // Brouillon : dans un panneau d'édition ou de création, rien ne part tant
  // qu'on n'a pas cliqué « Enregistrer » (ou « Créer… ») dans le pied de
  // panneau, ancré en bas. `save` renvoie true (fait), false (écriture
  // refusée) ou 'invalid' (saisie refusée, message déjà affiché). `baseline`
  // est l'état des champs au dessin : quitter avec des champs différents
  // demande confirmation.
  let draft = null;
  const foot = document.createElement('footer');
  foot.className = 'drw-foot';
  foot.hidden = true;
  drawer.appendChild(foot);

  // Champs qui portent la saisie : pas la recherche ni les filtres du
  // sélecteur de tâches, pas le texte jj/mm/aaaa (doublé par le champ date
  // natif), ni ce qui est marqué data-nodirty (actions immédiates).
  const trackedFields = () => [...body.querySelectorAll('input, select, textarea')]
    .filter((el) => !el.closest('[data-nodirty]') && !el.matches('[data-pk], .dtxt, [data-field="confirm"]'));
  const fieldsState = () => JSON.stringify(trackedFields().map((el) => (el.type === 'checkbox' ? el.checked : el.value)));
  const isDirty = () => Boolean(draft && fieldsState() !== draft.baseline);

  function armDraft({ save, saveLabel = 'Enregistrer', action = null, create = false }) {
    draft = { save, saveLabel, action, create, baseline: fieldsState() };
    foot.hidden = false;
    foot.innerHTML = `<p class="df-err" data-foot-error hidden></p>
      <span class="df-state"></span>
      ${create ? '' : '<button class="btn ghost" type="button" data-foot="revert">Annuler</button>'}
      <button class="btn pri" type="button" data-foot="save"${action ? ` data-action="${action}"` : ''}>${esc(saveLabel)}</button>`;
    refreshFoot();
  }

  function refreshFoot() {
    if (!draft) return;
    const dirty = isDirty();
    foot.classList.toggle('dirty', dirty);
    foot.querySelector('.df-state').textContent = submitting ? '' : dirty ? 'Modifications non enregistrées' : (draft.create ? '' : 'Aucune modification');
    const save = foot.querySelector('[data-foot="save"]');
    save.disabled = submitting || (!draft.create && !dirty);
    save.textContent = submitting ? (draft.create ? 'Création…' : 'Enregistrement…') : draft.saveLabel;
    const revert = foot.querySelector('[data-foot="revert"]');
    if (revert) revert.hidden = !dirty || submitting;
  }

  function footError(message) {
    const slot = foot.querySelector('[data-foot-error]');
    if (!slot) return;
    slot.textContent = message;
    slot.hidden = !message;
  }

  // Un seul envoi à la fois : tant que l'écriture n'est pas terminée, le
  // bouton est inactif et tout autre clic (ou Ctrl/Cmd+S) est ignoré — sinon
  // chaque clic créerait une tâche de plus dans Linear. Réussie, une création
  // ferme le panneau et une modification le redessine avec les nouvelles
  // valeurs ; en cas d'échec, la saisie reste en place avec la raison.
  // Une saisie refusée (validation) répond tout de suite, sans attendre :
  // seul un envoi réel bloque le bouton le temps de l'écriture.
  function runSave() {
    if (!draft || submitting || (!draft.create && !isDirty())) return;
    footError('');
    const opened = current;
    const { create } = draft;
    const finish = (ok) => {
      submitting = false;
      if (current !== opened) return;
      if (ok === 'invalid') return refreshFoot();
      if (ok === false) {
        footError(lastError() ?? (create ? 'La création a échoué.' : 'L\'enregistrement a échoué.'));
        return refreshFoot();
      }
      if (create) return close();
      draft = null;
      draw();
      foot.classList.add('saved');
      foot.querySelector('.df-state').textContent = 'Enregistré';
    };
    const result = draft.save();
    if (!(result instanceof Promise)) return finish(result);
    submitting = true;
    refreshFoot();
    result.then(finish, () => finish(false));
  }

  // Demande avant de perdre une saisie non enregistrée ; `then` s'exécute
  // si l'on abandonne (ou s'il n'y avait rien à perdre).
  function confirmDiscard(then) {
    if (!isDirty()) return then();
    if (document.querySelector('.confirm-overlay')) return undefined;
    const name = title.textContent;
    const overlay = document.createElement('div');
    overlay.className = 'overlay confirm-overlay';
    overlay.innerHTML = `<div class="confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-d">
      <h2 id="cf-t">Abandonner les modifications ?</h2>
      <p id="cf-d">Les changements apportés à « ${esc(name)} » ne sont pas enregistrés.</p>
      <div class="actions"><button class="btn" type="button" data-cf="keep">Continuer l'édition</button>
        <button class="btn danger" type="button" data-cf="discard">Abandonner</button></div></div>`;
    const done = (discard) => {
      overlay.remove();
      if (discard) {
        draft = null;
        then();
      } else {
        drawer.querySelector('[data-foot="save"]')?.focus();
      }
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-cf="keep"]')) done(false);
      else if (e.target.closest('[data-cf="discard"]')) done(true);
    });
    // Échap garde la saisie, et ne remonte pas jusqu'au raccourci qui ferme
    // le panneau.
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      done(false);
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-cf="keep"]').focus();
    return undefined;
  }

  const sameTarget = (next) => current && next.kind === current.kind && next.id === current.id && next.id !== null;

  function open(next) {
    if (sameTarget(next)) return;
    confirmDiscard(() => {
      current = next;
      draft = null;
      pickerState = emptyPickerState();
      draw();
    });
  }

  function close() {
    current = null;
    lastDrawn = null;
    draft = null;
    drawer.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
    body.innerHTML = '';
    foot.hidden = true;
    foot.innerHTML = '';
  }

  function requestClose(then = () => {}) {
    if (!current) return then();
    return confirmDiscard(() => {
      close();
      then();
    });
  }

  foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-foot="save"]')) runSave();
    else if (e.target.closest('[data-foot="revert"]')) {
      draft = null;
      draw();
    }
  });
  drawer.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      runSave();
    }
  });
  body.addEventListener('input', (e) => {
    if (e.target.matches('textarea')) autoGrow(e.target);
    refreshFoot();
  });
  body.addEventListener('change', refreshFoot);
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function update(nextContext) {
    ctx = nextContext;
    const active = document.activeElement;
    // Une case à cocher n'est jamais "en cours de saisie" (contrairement à un
    // champ texte) : son changement est une action ponctuelle déjà terminée,
    // donc ne doit pas bloquer le redessin qui affiche son effet (ici, les
    // parts recalculées sous la liste des contributeurs).
    const editing = body.contains(active) && active.matches('input:not([type="checkbox"]), select, textarea');
    // Un formulaire de création n'affiche rien qui vienne de l'instantané : le
    // redessiner (à chaque sondage, ou après une écriture) ne ferait que
    // vider ce qui vient d'être saisi.
    const creating = current?.id === null || current?.kind === 'team' || current?.confirmDelete;
    // Une saisie en cours (non enregistrée, ou en train de partir) ne doit pas
    // être effacée par un sondage ou une écriture venue d'ailleurs.
    if (current && !editing && !creating && !submitting && !isDirty()) draw();
  }

  function draw() {
    if (!ctx || !current) return;
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    const keep = current === lastDrawn ? captureView() : null;
    draft = null;
    foot.hidden = true;
    foot.classList.remove('dirty', 'saved');
    if (current.kind === 'issue') drawIssue(current.id, current.seed);
    else if (current.kind === 'person') drawPerson(current.id);
    else if (current.kind === 'proj') drawProj(current.id, current.seed);
    else if (current.kind === 'team') drawNewTeam();
    else if (current.kind === 'milestone') drawMilestone(current.id, current.seed);
    else if (current.kind === 'roles') drawRoles(current.id);
    else drawSettings();
    enhanceDateFields(body);
    wireIssuePicker(body.querySelector('[data-picker]'), pickerState);
    for (const area of body.querySelectorAll('textarea')) autoGrow(area);
    if (draft) {
      draft.baseline = fieldsState();
      refreshFoot();
    }
    if (keep) restoreView(keep);
    lastDrawn = current;
  }

  // Remplacer le contenu du panneau le vide un instant : le navigateur ramène
  // alors le défilement en haut (le panneau, et chaque liste à cocher), et la
  // case qu'on venait de cocher perd le focus.
  function captureView() {
    const active = document.activeElement;
    const box = body.contains(active) && active.type === 'checkbox' ? active : null;
    return {
      top: body.scrollTop,
      lists: Object.fromEntries([...body.querySelectorAll('.chklist[data-field]')].map((l) => [l.dataset.field, l.scrollTop])),
      focus: box ? { field: box.closest('[data-field]')?.dataset.field, value: box.value } : null,
    };
  }

  function restoreView({ top, lists, focus }) {
    for (const [field, scrollTop] of Object.entries(lists)) {
      const list = body.querySelector(`.chklist[data-field="${field}"]`);
      if (list) list.scrollTop = scrollTop;
    }
    if (focus?.field) {
      const list = body.querySelector(`.chklist[data-field="${focus.field}"]`);
      const box = [...(list?.querySelectorAll('input[type="checkbox"]') ?? [])].find((b) => b.value === focus.value);
      box?.focus({ preventScroll: true });
    }
    body.scrollTop = top;
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
    if (current.confirmDelete) {
      const children = domain.issues.filter((i) => i.parentId === issue.id).length;
      return drawDeleteConfirm({
        heading: `Supprimer ${issue.identifier} ?`,
        subject: `« ${issue.title} »`,
        expected: issue.identifier,
        details: [
          'La tâche est placée dans la corbeille de Linear (récupérable pendant 30 jours depuis Linear, pas depuis cette application).',
          'Ses dépendances avec les autres tâches sont retirées.',
          ...(children ? [`Ses ${children} sous-tâche${children > 1 ? 's ne sont' : ' n\'est'} pas supprimée${children > 1 ? 's' : ''}.`] : []),
        ],
        run: (api) => api.deleteIssue(issue.id, issue.identifier),
        label: `${issue.identifier} supprimée`,
      });
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
            <span class="ci" style="background-color:${personColor(uid, domain.users)}">${esc(initials(user))}</span>
            <span class="cn">${esc(user?.name ?? uid)}</span>
            <input type="number" min="0" step="any" name="${esc(uid)}" value="${value}"
              ${isLast ? 'readonly title="Calculée pour que le total fasse 100 %"' : ''}
              aria-label="Part de ${esc(user?.name ?? uid)}">
            <span class="cx">${person ? `${fr1(person.hours)} h · ${person.ratePct ?? '?'} %` : '0 h'}</span>
          </div>`;
        }).join('')}
        <p class="hint">${lastUid !== null ? `La part de ${esc(userOf(lastUid)?.name ?? lastUid)} complète les autres jusqu'à 100 %.` : 'Les parts sont ramenées à 100 %.'} ${rows.length ? 'Répartition ajustée à la main.' : 'Répartition égale par défaut.'}</p>
        <div class="actions" data-nodirty>
          ${rows.length ? '<button class="btn" type="button" data-action="equal-shares">Répartition égale</button>' : ''}
        </div>
      </form>` : '';

    body.innerHTML = `
      ${blockers.length ? `<div class="warn">Démarre avant la fin de ${esc(blockers.join(', '))}.</div>` : ''}
      ${issue.unresolvedMentions.length ? `<div class="warn">Mentions non reconnues : ${issue.unresolvedMentions.map((m) => `@${esc(m)}`).join(', ')}.</div>` : ''}
      <div class="fg" data-nodirty><label for="f-team">Team</label>
        <div class="f-move">
          <select id="f-team" data-field="team">
            ${domain.teams.map((t) => `<option value="${esc(t.id)}"${t.id === issue.teamId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <button class="btn" type="button" data-action="move-team" disabled>Déplacer</button>
        </div>
        <p class="hint" data-move-hint hidden>Changer de team change l'identifiant de la tâche, la place sur le statut équivalent de la nouvelle team et la retire de son projet s'il n'existe pas dans cette team. Annulable pendant 15 secondes.</p></div>
      <div class="fg"><label for="f-project">Projet</label>
        <select id="f-project" data-field="project">
          <option value="">Sans projet</option>
          ${domain.projects.filter((p) => p.teamIds.includes(issue.teamId))
            .map((p) => `<option value="${esc(p.id)}"${p.id === issue.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-title">Titre</label>
        <input id="f-title" data-field="title" value="${esc(issue.title)}"></div>
      <div class="fg"><label for="f-desc">Description</label>
        <textarea id="f-desc" data-field="description" rows="3" placeholder="Texte libre. La date de début et les contributeurs restent gérés par leurs champs.">${esc(parseDescriptionText(issue.rawDescription))}</textarea></div>
      <div class="fg"><label for="f-state">Statut</label>
        <select id="f-state" data-field="state">
          ${(domain.workflowStates ?? []).filter((s) => s.teamId === issue.teamId)
            .map((s) => `<option value="${esc(s.id)}"${s.id === issue.stateId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-assignee">Responsable</label>
        <select id="f-assignee" data-field="assignee">
          <option value="">Aucun</option>
          ${domain.users.map((u) => `<option value="${esc(u.id)}"${u.id === issue.assigneeId ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-estimate">Estimation (points)</label>
        <select id="f-estimate" data-field="estimate">
          <option value="">Aucune</option>
          ${FIB.map((f) => `<option value="${f}"${f === issue.estimate ? ' selected' : ''}>${f}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-real">Charge réelle (points consommés)</label>
        <input id="f-real" data-field="real" type="number" min="0" step="0.5" value="${issue.realPoints ?? ''}" placeholder="Non renseignée : compte pour 0 dans la charge réelle"></div>
      <div class="f2">
        <div class="fg"><label for="f-start">Début</label><div class="dfield">
          <input id="f-start" type="date" data-field="start" value="${issue.start ?? issue.startDate ?? ''}"></div></div>
        <div class="fg"><label for="f-end">Échéance</label><div class="dfield">
          <input id="f-end" type="date" data-field="end" value="${issue.end ?? issue.dueDate ?? ''}"></div></div>
      </div>
      ${issue.unplannedReason ? `<p class="hint">${esc(issue.unplannedReason)}</p>` : ''}
      <p class="hint">À l'enregistrement, les tâches qui dépendent de celle-ci sont décalées avec elle.</p>
      ${issuePickerHtml({ label: 'Bloquée par', issues: otherIssues, checkedIds: issue.blockedBy, teams: domain.teams, projects: domain.projects, states: domain.workflowStates ?? [] })}
      <div class="fg"><label>Contributeurs</label>
        <div class="chklist" data-field="contributors">
          ${domain.users.map((u) => `<label class="chkrow">
            <input type="checkbox" value="${esc(u.id)}"${issue.contributorIds.includes(u.id) ? ' checked' : ''}>
            <span class="ini" style="background-color:${personColor(u.id, domain.users)}">${esc(initials(u))}</span>
            <span>${esc(u.name)}</span>
          </label>`).join('')}
        </div></div>
      <p class="hint">${SOURCE_HINT[issue.contributorsSource]} Un commentaire signale les nouveaux venus dans Linear ; leurs parts se règlent une fois la tâche enregistrée.</p>
      <div class="sec">Parts des contributeurs</div>
      ${sharesForm}
      ${dangerZone('Supprimer la tâche…')}`;
    body.querySelector('[data-action="ask-delete"]').addEventListener('click', askDelete);

    // Le déplacement de team est une action à part (choisir, puis
    // « Déplacer »), immédiate et annulable : une flèche du clavier sur la
    // liste ne doit jamais déplacer une tâche à chaque option traversée.
    const teamSelect = body.querySelector('[data-field="team"]');
    const moveButton = body.querySelector('[data-action="move-team"]');
    const moveHint = body.querySelector('[data-move-hint]');
    teamSelect.addEventListener('change', () => {
      const differs = teamSelect.value !== issue.teamId;
      moveButton.disabled = !differs;
      moveHint.hidden = !differs;
    });
    moveButton.addEventListener('click', () => {
      const teamId = teamSelect.value;
      if (teamId === issue.teamId) return;
      const teamName = domain.teams.find((t) => t.id === teamId)?.name ?? teamId;
      onWrite(
        (api) => api.updateIssue(issue.id, { teamId }),
        `${issue.identifier} déplacée vers ${teamName}`,
        (api) => api.updateIssue(issue.id, { teamId: issue.teamId, stateId: issue.stateId, projectId: issue.projectId }),
      );
    });
    const sharesEl = body.querySelector('form[data-form="shares"]');
    if (lastUid !== null) {
      const numberInputs = [...sharesEl.querySelectorAll('input[type="number"]')];
      const lastInput = numberInputs.at(-1);
      const others = numberInputs.slice(0, -1);
      const recomputeLast = () => {
        const sum = others.reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        lastInput.value = Math.round((100 - sum) * 10) / 10;
      };
      for (const inp of others) inp.addEventListener('input', recomputeLast);
    }

    const value = (name) => body.querySelector(`[data-field="${name}"]`).value;
    const checkedIn = (name) => [...body.querySelectorAll(`[data-field="${name}"] input:checked`)].map((i) => i.value);
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const initialShares = sharesEl ? [...sharesEl.querySelectorAll('input[type="number"]')].map((i) => i.value) : [];

    armDraft({
      save: () => {
        const titleValue = value('title').trim();
        if (!titleValue) return invalid('Le titre est obligatoire.');
        const realRaw = value('real').trim();
        const real = realRaw === '' ? null : Number(realRaw);
        if (real !== null && !(Number.isFinite(real) && real >= 0)) return invalid('La charge réelle doit être un nombre positif.');
        const start = value('start');
        const end = value('end');
        const datesChanged = start !== (issue.start ?? issue.startDate ?? '') || end !== (issue.end ?? issue.dueDate ?? '');
        if (datesChanged && Boolean(start) !== Boolean(end)) return invalid('Renseignez le début et l\'échéance, ou aucun des deux.');
        if (datesChanged && end < start) return invalid('L\'échéance précède le début.');
        const shares = sharesEl ? [...sharesEl.querySelectorAll('input[type="number"]')].map((i) => ({ linearUserId: i.name, share: Number(i.value) })) : [];
        const sharesChanged = sharesEl && sharesEl.querySelectorAll('input[type="number"]').length === initialShares.length
          && [...sharesEl.querySelectorAll('input[type="number"]')].some((i, k) => i.value !== initialShares[k]);
        if (sharesChanged && !(shares.every((x) => Number.isFinite(x.share) && x.share >= 0) && shares.reduce((a, x) => a + x.share, 0) > 0)) {
          return invalid('Les parts doivent être positives et leur somme non nulle.');
        }

        // Champs de la tâche elle-même : une seule écriture, et son retour.
        const patch = {};
        const back = {};
        const field = (key, next, before) => {
          if (next === before) return;
          patch[key] = next;
          back[key] = before;
        };
        field('title', titleValue, issue.title);
        field('description', value('description').trim(), parseDescriptionText(issue.rawDescription));
        field('stateId', value('state'), issue.stateId);
        field('assigneeId', value('assignee') || null, issue.assigneeId);
        field('estimate', value('estimate') ? Number(value('estimate')) : null, issue.estimate);
        field('realPoints', real, issue.realPoints ?? null);
        field('projectId', value('project') || null, issue.projectId);

        const calls = [];
        const restores = [];
        if (Object.keys(patch).length) {
          calls.push((api) => api.updateIssue(issue.id, patch));
          restores.push((api) => api.updateIssue(issue.id, back));
        }
        if (datesChanged && start && end) {
          calls.push((api) => api.reschedule(issue.id, { start, end }));
          restores.push((api) => api.reschedule(issue.id, { start: issue.start ?? undefined, end: issue.end ?? undefined }));
        }
        const blockedBy = checkedIn('deps');
        if (!sameSet(blockedBy, issue.blockedBy)) {
          calls.push((api) => api.setDependencies(issue.id, blockedBy));
          restores.push((api) => api.setDependencies(issue.id, issue.blockedBy));
        }
        const contributorIds = checkedIn('contributors');
        if (!sameSet(contributorIds, issue.contributorIds)) {
          calls.push((api) => api.setContributors(issue.id, contributorIds));
          restores.push((api) => api.setContributors(issue.id, issue.contributorIds));
        }

        return (async () => {
          if (calls.length && (await onWrite(calls, `${issue.identifier} modifiée`, restores)) === false) return false;
          if (sharesChanged) return mutateAll([(api) => api.setContributions(issue.id, shares)]);
          return true;
        })();
      },
    });
  }

  // Saisie refusée avant tout envoi : la raison s'affiche dans le pied de
  // panneau, à côté du bouton.
  function invalid(message) {
    footError(message);
    return 'invalid';
  }

  // La suppression passe toujours par un écran de confirmation dédié : le
  // bouton de la « zone dangereuse » ne supprime rien, il ouvre seulement cet
  // écran. Le bouton de suppression y reste inactif tant que l'identifiant
  // (ou le nom) exact n'est pas saisi ; Entrée ne valide jamais, Échap annule.
  const dangerZone = (label) => `<div class="sec">Zone dangereuse</div>
      <div class="danger-zone"><button class="btn danger-ghost" type="button" data-action="ask-delete">${esc(label)}</button></div>`;

  function askDelete() {
    current = { ...current, confirmDelete: true };
    draw();
  }

  function drawDeleteConfirm({ heading, subject, expected, details, run, label }) {
    title.textContent = heading;
    body.innerHTML = `
      <div class="danger-box" role="alertdialog" aria-labelledby="dwT">
        ${subject ? `<p class="danger-subject">${esc(subject)}</p>` : ''}
        <ul class="danger-list">${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
        <div class="fg"><label for="f-confirm">Pour confirmer, saisissez <code class="danger-token">${esc(expected)}</code></label>
          <input id="f-confirm" data-field="confirm" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        ${errorSlot}
        <div class="actions danger-actions">
          <button class="btn pri" type="button" data-action="cancel-delete">Annuler</button>
          <button class="btn danger" type="button" data-action="confirm-delete" disabled>Supprimer</button>
        </div>
      </div>`;
    const input = body.querySelector('[data-field="confirm"]');
    const confirm = body.querySelector('[data-action="confirm-delete"]');
    const matches = () => input.value.trim() === expected;
    input.addEventListener('input', () => { confirm.disabled = submitting || !matches(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    body.querySelector('[data-action="cancel-delete"]').addEventListener('click', () => {
      current = { ...current, confirmDelete: false };
      draw();
    });
    confirm.addEventListener('click', async () => {
      // Le test est refait ici : retirer l'attribut disabled dans les outils
      // de développement ne contourne pas la saisie.
      if (submitting || !matches()) return;
      submitting = true;
      confirm.disabled = true;
      const opened = current;
      try {
        const ok = await onWrite(run, label, null);
        // En cas d'échec (droits, réseau…), la raison s'affiche ici, sur
        // l'écran où l'on vient de cliquer, pas seulement dans le bandeau du haut.
        if (ok === false) showError(body, lastError() ?? 'La suppression a échoué.');
        else if (current === opened) close();
      } finally {
        submitting = false;
        confirm.disabled = !matches();
      }
    });
    input.focus();
  }

  const create = (call, label) => onWrite(call, label, null);

  function drawNewIssue({ teamId, projectId }) {
    const { domain } = ctx;
    title.textContent = 'Nouvelle tâche';
    const today = todayISO();
    const team = domain.teams.find((t) => t.id === teamId);
    const projects = domain.projects.filter((p) => p.teamIds.includes(teamId));
    const states = (domain.workflowStates ?? []).filter((s) => s.teamId === teamId);
    body.innerHTML = `
      ${ro('Team', team?.name ?? 'inconnue')}
      <div class="fg"><label for="f-title">Titre</label><input id="f-title" data-field="title"></div>
      <div class="fg"><label for="f-desc">Description</label><textarea id="f-desc" data-field="description" rows="4"></textarea></div>
      <div class="fg"><label for="f-project">Projet</label>
        <select id="f-project" data-field="project">
          <option value="">Sans projet</option>
          ${projects.map((p) => `<option value="${esc(p.id)}"${p.id === projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-state">Statut</label>
        <select id="f-state" data-field="state">
          <option value="">Statut par défaut de la team</option>
          ${states.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-assignee">Responsable</label>
        <select id="f-assignee" data-field="assignee">
          <option value="">Aucun</option>
          ${domain.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select></div>
      <div class="fg"><label for="f-estimate">Estimation (points)</label>
        <select id="f-estimate" data-field="estimate">
          <option value="">Aucune</option>
          ${FIB.map((f) => `<option value="${f}">${f}</option>`).join('')}
        </select></div>
      <div class="f2">
        <div class="fg"><label for="f-start">Début</label><div class="dfield">
          <input id="f-start" type="date" data-field="start" value="${today}"></div></div>
        <div class="fg"><label for="f-end">Échéance</label><div class="dfield">
          <input id="f-end" type="date" data-field="end" value="${today}"></div></div>
      </div>
      <p class="hint">Sans dates, la tâche n'apparaît pas sur la frise, seulement dans l'onglet « Non planifiées ».</p>
      ${issuePickerHtml({ label: 'Bloquée par', issues: domain.issues, checkedIds: [], teams: domain.teams, projects: domain.projects, states: domain.workflowStates ?? [] })}
      <div class="fg"><label>Contributeurs</label>
        <div class="chklist" data-field="contributors">
          ${domain.users.map((u) => `<label class="chkrow">
            <input type="checkbox" value="${esc(u.id)}">
            <span class="ini" style="background-color:${personColor(u.id, domain.users)}">${esc(initials(u))}</span>
            <span>${esc(u.name)}</span>
          </label>`).join('')}
        </div></div>
      <p class="hint">Sans contributeur coché, le responsable porte toute la charge. Les parts se règlent ensuite dans la tâche créée.</p>`;
    const field = (name) => body.querySelector(`[data-field="${name}"]`);
    const checked = (name) => [...field(name).querySelectorAll('input:checked')].map((c) => c.value);
    const submit = () => {
      const value = field('title').value.trim();
      if (!value) return invalid('Le titre est obligatoire.');
      const start = field('start').value;
      const end = field('end').value;
      if (Boolean(start) !== Boolean(end)) return invalid('Renseignez le début et l\'échéance, ou aucun des deux.');
      if (start && end < start) return invalid('L\'échéance précède le début.');
      const input = { teamId, title: value };
      if (field('description').value.trim()) input.description = field('description').value.trim();
      if (field('project').value) input.projectId = field('project').value;
      if (field('state').value) input.stateId = field('state').value;
      if (field('assignee').value) input.assigneeId = field('assignee').value;
      if (field('estimate').value) input.estimate = Number(field('estimate').value);
      if (start) Object.assign(input, { start, end });
      const blockedBy = checked('deps');
      if (blockedBy.length) input.blockedBy = blockedBy;
      const contributorIds = checked('contributors');
      if (contributorIds.length) input.contributorIds = contributorIds;
      return create((api) => api.createIssue(input), `Tâche « ${value} » créée`);
    };
    armDraft({ save: submit, saveLabel: 'Créer la tâche', action: 'create-issue', create: true });
    field('title').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSave();
    });
  }

  function drawNewProject({ teamId } = {}) {
    const { domain } = ctx;
    title.textContent = 'Nouveau projet';
    body.innerHTML = `
      <div class="fg"><label for="f-pname">Nom du projet</label><input id="f-pname" data-field="pname"></div>
      <div class="fg"><label>Teams</label>
        <div class="chklist" data-field="pteams">
          ${domain.teams.map((t) => `<label class="chkrow">
            <input type="checkbox" value="${esc(t.id)}"${t.id === teamId ? ' checked' : ''}>
            <span>${esc(t.name)}</span>
          </label>`).join('')}
        </div></div>
      <div class="f2">
        <div class="fg"><label for="f-pstart">Début</label><div class="dfield">
          <input id="f-pstart" type="date" data-field="pstart"></div></div>
        <div class="fg"><label for="f-ptarget">Échéance</label><div class="dfield">
          <input id="f-ptarget" type="date" data-field="ptarget"></div></div>
      </div>
      <div class="fg"><label for="f-pcolor">Couleur</label>
        <input id="f-pcolor" type="color" data-field="pcolor" value="#2E5F8A"></div>
      <p class="hint">Sans début et échéance, le projet n'a pas de bande sur la frise. Sans couleur choisie, Linear en attribue une.</p>`;
    const field = (name) => body.querySelector(`[data-field="${name}"]`);
    let colorChosen = false;
    field('pcolor').addEventListener('input', () => { colorChosen = true; });
    armDraft({ saveLabel: 'Créer le projet', action: 'create-project', create: true, save: () => {
      const value = field('pname').value.trim();
      if (!value) return invalid('Le nom est obligatoire.');
      const teamIds = [...field('pteams').querySelectorAll('input:checked')].map((c) => c.value);
      if (!teamIds.length) return invalid('Choisissez au moins une team.');
      const startDate = field('pstart').value;
      const targetDate = field('ptarget').value;
      if (startDate && targetDate && targetDate < startDate) return invalid('L\'échéance précède le début.');
      const input = { teamIds, name: value };
      if (startDate) input.startDate = startDate;
      if (targetDate) input.targetDate = targetDate;
      if (colorChosen) input.color = field('pcolor').value;
      return create((api) => api.createProject(input), `Projet « ${value} » créé`);
    } });
  }

  function drawNewTeam() {
    title.textContent = 'Nouvelle team';
    body.innerHTML = `
      <div class="fg"><label for="f-tkey">Clé (ex. IOT)</label><input id="f-tkey" data-field="tkey" maxlength="5" style="text-transform:uppercase"></div>
      <div class="fg"><label for="f-tname">Nom</label><input id="f-tname" data-field="tname"></div>`;
    armDraft({ saveLabel: 'Créer la team', action: 'create-team', create: true, save: () => {
      const key = body.querySelector('[data-field="tkey"]').value.trim().toUpperCase();
      const name = body.querySelector('[data-field="tname"]').value.trim();
      if (!key || !name) return invalid('La clé et le nom sont obligatoires.');
      return create((api) => api.createTeam({ key, name }), `Team « ${name} » créée`);
    } });
  }

  function drawNewMilestone({ projectId } = {}) {
    const { domain } = ctx;
    const project = domain.projects.find((p) => p.id === projectId);
    if (!project) {
      title.textContent = 'Projet introuvable';
      body.innerHTML = '<p class="warn">Ce projet ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    title.textContent = 'Nouveau jalon';
    const suggested = project.targetDate ?? todayISO();
    body.innerHTML = `
      ${ro('Projet', project.name)}
      <div class="fg"><label for="f-mname">Nom du jalon</label><input id="f-mname" data-field="mname"></div>
      <div class="fg"><label for="f-mdate">Date</label><div class="dfield">
        <input id="f-mdate" type="date" data-field="mdate" value="${suggested}"></div></div>
      <p class="hint">Sans date, le jalon existe dans Linear mais n'apparaît pas sur la frise. Une fois créé, on le déplace en le faisant glisser sur la frise.</p>`;
    armDraft({ saveLabel: 'Créer le jalon', action: 'create-milestone', create: true, save: () => {
      const name = body.querySelector('[data-field="mname"]').value.trim();
      if (!name) return invalid('Le nom est obligatoire.');
      const targetDate = body.querySelector('[data-field="mdate"]').value;
      const input = { projectId: project.id, name };
      if (targetDate) input.targetDate = targetDate;
      return create((api) => api.createMilestone(input), `Jalon « ${name} » créé`);
    } });
    body.querySelector('[data-field="mname"]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSave();
    });
  }

  function drawMilestone(milestoneId, seed) {
    if (milestoneId === null) return drawNewMilestone(seed ?? {});
    const { domain } = ctx;
    let project = null;
    let milestone = null;
    for (const p of domain.projects) {
      const m = p.milestones.find((mm) => mm.id === milestoneId);
      if (m) { project = p; milestone = m; break; }
    }
    if (!milestone) {
      title.textContent = 'Jalon introuvable';
      body.innerHTML = '<p class="warn">Ce jalon ne figure plus dans l\'instantané Linear.</p>';
      return;
    }
    title.textContent = milestone.name;
    body.innerHTML = `
      ${ro('Projet', project.name)}
      <div class="fg"><label for="f-mname">Nom du jalon</label>
        <input id="f-mname" data-field="mname" value="${esc(milestone.name)}"></div>
      <div class="fg"><label for="f-mdate">Date</label><div class="dfield">
        <input id="f-mdate" type="date" data-field="mdate" value="${milestone.date ?? ''}"></div></div>`;
    armDraft({ save: () => {
      const name = body.querySelector('[data-field="mname"]').value.trim();
      const date = body.querySelector('[data-field="mdate"]').value;
      if (!name) return invalid('Le nom est obligatoire.');
      const change = {};
      const back = {};
      if (name !== milestone.name) {
        change.name = name;
        back.name = milestone.name;
      }
      // Une date vidée n'est pas envoyée : un jalon se retire de la frise
      // depuis Linear.
      if (date && date !== milestone.date) {
        change.targetDate = date;
        if (milestone.date) back.targetDate = milestone.date;
      }
      if (!Object.keys(change).length) return true;
      return onWrite(
        (api) => api.updateMilestone(milestoneId, change),
        `Jalon « ${milestone.name} » modifié`,
        Object.keys(back).length ? (api) => api.updateMilestone(milestoneId, back) : null,
      );
    } });
    body.querySelector('[data-field="mname"]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSave();
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
    if (current.confirmDelete) {
      const count = domain.issues.filter((i) => i.projectId === project.id).length;
      return drawDeleteConfirm({
        heading: `Supprimer le projet ${project.name} ?`,
        subject: null,
        expected: project.name,
        details: [
          'Le projet est placé dans la corbeille de Linear (restaurable depuis Linear, pas depuis cette application).',
          count
            ? `Ses ${count} tâche${count > 1 ? 's ne sont' : ' n\'est'} pas supprimée${count > 1 ? 's' : ''} : elle${count > 1 ? 's restent' : ' reste'} dans Linear, sans projet.`
            : 'Il ne contient aucune tâche.',
          'Ses jalons disparaissent avec lui.',
        ],
        run: (api) => api.deleteProject(project.id, project.name),
        label: `Projet « ${project.name} » supprimé`,
      });
    }
    title.textContent = project.name;
    const teamNames = project.teamIds.map((id) => domain.teams.find((t) => t.id === id)?.name ?? id);
    body.innerHTML = `
      <div class="fg"><label for="f-pname">Nom du projet</label>
        <input id="f-pname" data-field="pname" value="${esc(project.name)}"></div>
      ${ro('Teams', teamNames.join(', ') || 'aucune')}
      <div class="f2">
        <div class="fg"><label for="f-pstart">Début</label><div class="dfield">
          <input id="f-pstart" type="date" data-field="pstart" value="${project.startDate ?? ''}"></div></div>
        <div class="fg"><label for="f-ptarget">Échéance</label><div class="dfield">
          <input id="f-ptarget" type="date" data-field="ptarget" value="${project.targetDate ?? ''}"></div></div>
      </div>
      <div class="fg"><label for="f-pcolor">Couleur</label>
        <input id="f-pcolor" type="color" data-field="pcolor" value="${esc(project.color)}"></div>
      <div class="sec">Jalons</div>
      ${project.milestones.map((m) => ro(m.name, m.date ? longDay(m.date) : 'sans date')).join('') || '<p class="hint">Aucun jalon.</p>'}
      <div class="actions"><button class="btn" type="button" data-action="add-milestone">Ajouter un jalon</button></div>
      ${dangerZone('Supprimer le projet…')}`;
    body.querySelector('[data-action="ask-delete"]').addEventListener('click', askDelete);
    body.querySelector('[data-action="add-milestone"]').addEventListener('click', () => {
      open({ kind: 'milestone', id: null, seed: { projectId: project.id } });
    });
    armDraft({ save: () => {
      const field = (name) => body.querySelector(`[data-field="${name}"]`).value;
      const name = field('pname').trim();
      if (!name) return invalid('Le nom est obligatoire.');
      const startDate = field('pstart');
      const targetDate = field('ptarget');
      if (startDate && targetDate && targetDate < startDate) return invalid('L\'échéance précède le début.');
      const patch = {};
      const back = {};
      if (name !== project.name) { patch.name = name; back.name = project.name; }
      // Une date vidée n'est pas envoyée (comme avant) : seules les dates
      // renseignées remplacent celles de Linear.
      if (startDate && startDate !== project.startDate) { patch.startDate = startDate; back.startDate = project.startDate ?? ''; }
      if (targetDate && targetDate !== project.targetDate) { patch.targetDate = targetDate; back.targetDate = project.targetDate ?? ''; }
      const color = field('pcolor');
      if (color && color.toLowerCase() !== project.color.toLowerCase()) { patch.color = color; back.color = project.color; }
      if (!Object.keys(patch).length) return true;
      return onWrite(
        (api) => api.updateProject(project.id, patch),
        `Projet ${project.name} modifié`,
        (api) => api.updateProject(project.id, back),
      );
    } });
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
      </form>
      <div class="sec">Capacité semaine par semaine</div>
      <p class="hint">Laissez vide pour reprendre la capacité par défaut (${fr1(fallback)} h). Saisissez 0 pour une absence.</p>
      ${weeks.map((w) => {
        const override = planning.weeklyCapacities.find((c) => c.linearUserId === userId && c.weekStart === w.weekStart);
        return `<div class="cbo">
          <span class="cn">sem. du ${shortDay(w.weekStart)}</span>
          <input type="number" min="0" step="0.5" data-week="${w.weekStart}" value="${override ? override.hours : ''}"
            placeholder="${fr1(fallback)}" aria-label="Capacité de la semaine du ${shortDay(w.weekStart)}">
          <span class="cx">${fr1(w.hours)} h prévues${w.realHours > 0.01 ? ` · ${fr1(w.realHours)} h réelles` : ''}</span>
        </div>`;
      }).join('')}`;
    const initialWeeks = new Map([...body.querySelectorAll('[data-week]')].map((i) => [i.dataset.week, i.value]));
    armDraft({ save: () => {
      const raw = body.querySelector('[name="hours"]').value;
      const hours = raw === '' ? null : Number(raw);
      if (hours !== null && !input0(hours)) return invalid('La capacité par défaut doit être un nombre positif.');
      const role = body.querySelector('[name="role"]').value.trim() || null;
      const calls = [];
      if (role !== (person?.role ?? null) || hours !== (person?.defaultWeeklyHours ?? null)) {
        calls.push((api) => api.updatePerson(userId, { role, defaultWeeklyHours: hours }));
      }
      for (const input of body.querySelectorAll('[data-week]')) {
        const week = input.dataset.week;
        if (input.value === initialWeeks.get(week)) continue;
        if (input.value === '') {
          calls.push((api) => api.clearCapacity(userId, week));
          continue;
        }
        const weekHours = Number(input.value);
        if (!input0(weekHours)) return invalid(`La capacité de la semaine du ${shortDay(week)} doit être un nombre positif.`);
        calls.push((api) => api.setCapacity(userId, week, weekHours));
      }
      return mutateAll(calls);
    } });
  }

  // Manager global et, par team, Product Owner et Scrum Master. `teamId` null :
  // toute l'organisation ; sinon cette team seulement. Chaque liste enregistre
  // dès qu'elle change.
  function drawRoles(teamId) {
    const { domain, planning } = ctx;
    const org = planning.org ?? { managerUserId: null, teamRoles: [] };
    const people = domain.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const option = (u, selected) => `<option value="${esc(u.id)}"${u.id === selected ? ' selected' : ''}>${esc(u.name)}</option>`;
    const select = (attrs, selected, team) => {
      const members = team ? people.filter((u) => (team.memberIds ?? []).includes(u.id)) : [];
      const others = people.filter((u) => !members.includes(u));
      // Titulaire inactif ou disparu de Linear : gardé pour ne pas le perdre
      // en silence à l'enregistrement d'un autre champ.
      const gone = selected && !people.some((u) => u.id === selected)
        ? `<option value="${esc(selected)}" selected>${esc(domain.users.find((u) => u.id === selected)?.name ?? 'personne inconnue')} (inactive)</option>` : '';
      return `<select ${attrs}><option value="">À définir</option>${gone}
        ${members.length ? `<optgroup label="Membres de la team">${members.map((u) => option(u, selected)).join('')}</optgroup>
          <optgroup label="Autres personnes">${others.map((u) => option(u, selected)).join('')}</optgroup>`
          : others.map((u) => option(u, selected)).join('')}
      </select>`;
    };
    const holder = (team, role) => org.teamRoles.find((r) => r.teamId === team.id && r.role === role)?.linearUserId ?? null;
    const teams = teamId ? domain.teams.filter((t) => t.id === teamId) : domain.teams;
    title.textContent = teamId ? `Rôles de la team ${teams[0]?.name ?? ''}`.trim() : 'Organisation';
    body.innerHTML = `
      ${teamId ? '' : `<div class="fg"><label for="o-mgr">Manager</label>${select('id="o-mgr" data-org-manager', org.managerUserId, null)}</div>`}
      ${teams.map((team) => `<div class="sec">${esc(team.name)} · ${esc(team.key)}</div>
        <div class="f2">
          <div class="fg"><label for="o-po-${esc(team.id)}">Product Owner</label>
            ${select(`id="o-po-${esc(team.id)}" data-team-role="${esc(team.id)}" data-role="product_owner"`, holder(team, 'product_owner'), team)}</div>
          <div class="fg"><label for="o-sm-${esc(team.id)}">Scrum Master</label>
            ${select(`id="o-sm-${esc(team.id)}" data-team-role="${esc(team.id)}" data-role="scrum_master"`, holder(team, 'scrum_master'), team)}</div>
        </div>`).join('')}
      <p class="hint">Une même personne peut tenir plusieurs rôles, dans une ou plusieurs teams.</p>
      ${teamId ? '<div class="actions"><button class="btn" type="button" data-action="org-all">Toute l\'organisation et le manager</button></div>' : ''}`;
    const selects = [...body.querySelectorAll('[data-team-role], [data-org-manager]')];
    const initial = selects.map((sel) => sel.value);
    armDraft({ save: () => mutateAll(selects.flatMap((sel, k) => {
      if (sel.value === initial[k]) return [];
      const userId = sel.value || null;
      return sel.dataset.teamRole
        ? [(api) => api.setTeamRole(sel.dataset.teamRole, sel.dataset.role, userId)]
        : [(api) => api.setManager(userId)];
    })) });
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
      </form>
      <div class="sec">Jours chômés</div>
      ${planning.holidays.map((h) => `<div class="cbo">
        <span class="cn">${esc(h.label)} · ${longDay(h.day)}</span>
        <button type="button" data-action="delete-holiday" data-day="${h.day}" aria-label="Retirer le ${longDay(h.day)}">×</button>
      </div>`).join('')}
      <form data-form="holiday" data-nodirty>
        <div class="f2">
          <div class="fg"><label for="h-day">Date</label><div class="dfield">
            <input id="h-day" name="day" type="date"></div></div>
          <div class="fg"><label for="h-label">Libellé</label><input id="h-label" name="label"></div>
        </div>
        ${errorSlot}
        <div class="actions"><button class="btn" type="submit">Ajouter le jour chômé</button></div>
      </form>
      <div class="sec">Apparence</div>
      <div class="seg" role="radiogroup" aria-label="Thème" data-nodirty>
        ${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([value, label]) => `<label>
          <input type="radio" name="theme" value="${value}" data-pref-theme${(prefs.theme ?? 'auto') === value ? ' checked' : ''}>${label}</label>`).join('')}
      </div>
      <p class="hint">Automatique suit le réglage clair ou sombre de votre ordinateur.</p>
      ${prefs.pinkFound ? `<label class="ro" data-nodirty><span>Mode rose</span>
        <input type="checkbox" data-pref="pink" ${prefs.pink ? 'checked' : ''}></label>` : ''}
      <div class="sec">Affichage</div>
      <label class="ro" data-nodirty><span>Afficher les issues annulées</span>
        <input type="checkbox" data-pref="showCanceled" ${prefs.showCanceled ? 'checked' : ''}></label>
      <div class="sec">Clé Linear</div>
      <p class="hint">La clé est conservée dans ce navigateur uniquement.</p>
      <div class="actions"><button class="btn" type="button" data-action="forget-key">Changer de clé</button></div>`;
    armDraft({ save: () => {
      const read = (name) => Number(body.querySelector(`form[data-form="settings"] [name="${name}"]`).value);
      const settings = {
        hoursPerPoint: read('hoursPerPoint'),
        loadCeilingPct: read('loadCeilingPct'),
        defaultWeeklyHours: read('defaultWeeklyHours'),
      };
      const valid = settings.hoursPerPoint > 0
        && Number.isInteger(settings.loadCeilingPct) && settings.loadCeilingPct >= 10 && settings.loadCeilingPct <= 200
        && input0(settings.defaultWeeklyHours);
      if (!valid) return invalid('Heures par point > 0, plafond entier entre 10 et 200 %, capacité positive.');
      return mutateAll([(api) => api.updateSettings(settings)]);
    } });
  }

  function submitHoliday(form) {
    const day = form.querySelector('[name="day"]').value;
    const label = form.querySelector('[name="label"]').value.trim();
    if (!day || !label) return showError(form, 'Indiquez une date et un libellé.');
    return onMutate((api) => api.addHoliday(day, label));
  }

  const input0 = (n) => Number.isFinite(n) && n >= 0;
  // Écritures de planification (base locale), enchaînées : vrai si toutes
  // ont abouti.
  async function mutateAll(calls) {
    for (const call of calls) {
      if ((await onMutate(call)) === false) return false;
    }
    return true;
  }

  body.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'holiday') submitHoliday(form);
    else runSave();
  });

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'equal-shares') onMutate((api) => api.clearContributions(current.id));
    if (action === 'delete-holiday') onMutate((api) => api.deleteHoliday(button.dataset.day));
    if (action === 'forget-key') onForgetKey();
    if (action === 'org-all') open({ kind: 'roles', id: null });
  });

  // Seule la préférence d'affichage s'applique tout de suite : c'est un
  // réglage de ce navigateur, pas une donnée partagée.
  body.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.pref) onPrefs({ [target.dataset.pref]: target.checked });
    if ('prefTheme' in target.dataset) onPrefs({ theme: target.value });
  });

  closeButton.addEventListener('click', () => requestClose());

  return {
    openIssue: (id, seed) => open({ kind: 'issue', id, seed }),
    openProject: (id, seed) => open({ kind: 'proj', id, seed }),
    openPerson: (id) => open({ kind: 'person', id }),
    openSettings: () => open({ kind: 'settings' }),
    openTeam: () => open({ kind: 'team' }),
    openMilestone: (id, seed) => open({ kind: 'milestone', id, seed }),
    openRoles: (teamId) => open({ kind: 'roles', id: teamId }),
    close,
    requestClose,
    isDirty,
    update,
    selectedIssueId: () => (current?.kind === 'issue' ? current.id : null),
  };
}
