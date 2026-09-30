import { AuthError } from './api.js';

export const POLL_MS = 30_000;

// Au-delà, une écriture confirmée par Linear mais toujours absente des
// relectures cesse d'être superposée à l'instantané : c'est Linear qui a
// raison (elle a pu être annulée ailleurs entre-temps).
export const OVERLAY_MS = 120_000;

export function createController({
  api, render, showKeyScreen,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
  now = () => Date.now(),
  resyncDelayMs = 400,
}) {
  const state = { snapshot: null, planning: null, error: null };
  let timer = null;
  let starting = false;
  // Incrémenté au début de chaque modification : une réponse obtenue avant la
  // dernière modification commencée ne doit pas écraser la planification.
  let planningRevision = 0;

  // L'écran montre `base` (le dernier domaine relu depuis Linear) sur lequel
  // sont rejoués les aperçus des écritures `ops`, dans l'ordre :
  //  - en attente dans la file (pas encore envoyées) ;
  //  - faites (`done`) mais pas encore relues depuis Linear.
  // Chacune a un aperçu (optimistic.js) qui la montre dès qu'elle est faite.
  let base = null;
  const ops = [];
  // Change à chaque nouveau `base` : une interrogation lancée avant ne doit pas
  // remettre un domaine plus ancien par-dessus.
  let baseSeq = 0;

  const fold = (list) => list.reduce((d, op) => (op.preview ? op.preview(d) : d), base);
  const show = () => {
    if (state.snapshot) state.snapshot = { ...state.snapshot, domain: fold(ops) };
  };
  // Domaine sur lequel une écriture calcule ce qu'elle envoie (ex. la
  // description, qui porte aussi date de début, points réels et
  // contributeurs) : Linear après les écritures déjà faites, sans celles qui
  // attendent encore leur tour.
  const writeDomain = () => (base ? fold(ops.filter((op) => op.done)) : null);

  const isReflected = (op, domain) => {
    try {
      return op.reflected ? op.reflected(domain) : true;
    } catch {
      return true;
    }
  };

  // Les écritures faites figurent-elles toutes dans `domain` ? Celles qui ont
  // un aperçu, si le rejouer dessus n'y change plus rien : prises ensemble et
  // dans l'ordre, pour qu'une écriture remplacée depuis par une autre (même
  // champ modifié deux fois) compte comme relue. Les créations, sans aperçu,
  // d'après leur propre test.
  function settledIn(domain, done) {
    if (!done.every((op) => op.preview || isReflected(op, domain))) return false;
    const replayed = done.reduce((d, op) => (op.preview ? op.preview(d) : d), domain);
    return replayed === domain || JSON.stringify(replayed) === JSON.stringify(domain);
  }

  // Nouveau domaine relu depuis Linear. Les écritures faites cessent d'y être
  // rejouées quand il les contient toutes — ou quand la dernière date de plus
  // de OVERLAY_MS : Linear a alors raison.
  function rebase(snapshot) {
    baseSeq += 1;
    base = snapshot.domain;
    const done = ops.filter((op) => op.done);
    if (done.length && (settledIn(base, done) || now() - done.at(-1).doneAt > OVERLAY_MS)) {
      for (const op of done) ops.splice(ops.indexOf(op), 1);
    }
    state.snapshot = { ...snapshot, domain: fold(ops) };
  }

  const stop = () => {
    if (timer !== null) clearIntervalImpl(timer);
    timer = null;
  };

  const fail = (err) => {
    if (err instanceof AuthError) {
      stop();
      showKeyScreen(err.message);
      return;
    }
    state.error = err.message;
    render(state);
  };

  async function start() {
    if (starting) return;
    if (!api.getKey()) {
      showKeyScreen(null);
      return;
    }
    starting = true;
    try {
      const [snapshot, planning] = await Promise.all([api.snapshot(null), api.planning()]);
      rebase(snapshot);
      Object.assign(state, { planning, error: null });
      render(state);
      stop();
      timer = setIntervalImpl(poll, POLL_MS);
    } catch (err) {
      if (err instanceof AuthError) {
        fail(err);
      } else {
        state.error = err.message;
        render(state);
        stop();
        timer = setIntervalImpl(() => start(), POLL_MS);
      }
    } finally {
      starting = false;
    }
  }

  async function poll() {
    const revision = planningRevision;
    const seq = baseSeq;
    try {
      const [next, planning] = await Promise.all([api.snapshot(state.snapshot.version), api.planning()]);
      if (seq !== baseSeq) return;
      rebase(next.domain ? next : { ...next, domain: base });
      if (revision === planningRevision) state.planning = planning;
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  // Relit Linear une fois pour toutes les écritures faites depuis la dernière
  // relecture — incrémentale, sauf si l'une d'elles demande une
  // synchronisation complète — en réessayant un peu si elles n'y figurent pas
  // encore. Puis la planification, que certaines écritures Linear modifient
  // côté base (ex. retirer un contributeur purge ses parts).
  // `ownWrites` : écritures de la file qui attendent cette relecture elles-mêmes
  // (une création), à ne pas compter parmi celles qui attendent leur tour.
  async function resync(ownWrites = 0) {
    const waiting = () => pendingWrites > ownWrites;
    const written = ops.filter((op) => op.done);
    if (!written.length) return;
    const full = written.some((op) => op.full);
    try {
      let snapshot;
      for (let i = 0; i < 3; i += 1) {
        snapshot = await api.resync({ full });
        // Une nouvelle écriture attend : elle passe avant les nouveaux essais
        // (ce qui n'est pas encore relu reste affiché, et la relecture qui
        // suivra cette écriture le reprendra).
        if (settledIn(snapshot.domain, written) || waiting() || i === 2) break;
        await new Promise((resolve) => {
          wakeResync = resolve;
          setTimeout(resolve, resyncDelayMs);
        });
        wakeResync = null;
        if (waiting()) break;
      }
      const revision = planningRevision;
      const planning = await api.planning();
      rebase(snapshot);
      if (revision === planningRevision) state.planning = planning;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  // Les écritures passent une par une, dans l'ordre où l'utilisateur les a
  // faites : chacune calcule ce qu'elle envoie à partir du domaine qui
  // contient les précédentes (writeDomain). En parallèle, la seconde repartait
  // de l'ancien texte et effaçait la première dans Linear.
  let queue = Promise.resolve();
  let pendingWrites = 0;
  let queuedFailed = false;
  // Interrompt l'attente entre deux essais de relecture (voir resync).
  let wakeResync = null;

  // `call(api)` fait l'écriture et rend :
  //  - pour une écriture Linear (linearWrites.js), { sync: { full, reflected? }, … } ;
  //  - pour une écriture de planification (backend), la planification à jour.
  // `preview(domain)` (optionnel) la montre tout de suite à l'écran. Sans
  // aperçu (une création), l'écriture attend d'être relue depuis Linear avant
  // de se terminer : ce qu'elle crée est visible quand le formulaire se ferme.
  //
  // Résout au résultat de `call` si l'écriture a abouti, à false si elle a
  // échoué (l'erreur est alors déjà affichée, et son aperçu retiré).
  function mutate(call, { preview = null } = {}) {
    planningRevision += 1;
    pendingWrites += 1;
    wakeResync?.();
    const op = { preview, done: false };
    ops.push(op);
    if (preview) {
      show();
      render(state);
    }
    const run = queue.then(async () => {
      try {
        const result = await call(api);
        if (result?.sync) {
          Object.assign(op, { done: true, doneAt: now(), reflected: result.sync.reflected, full: Boolean(result.sync.full) });
          if (!preview) await resync(1);
        } else {
          ops.splice(ops.indexOf(op), 1);
          if (result) state.planning = result;
        }
        // L'erreur d'une écriture précédente de la même file reste affichée.
        if (!queuedFailed) state.error = null;
        return result ?? true;
      } catch (err) {
        ops.splice(ops.indexOf(op), 1);
        show();
        queuedFailed = true;
        fail(err);
        return false;
      } finally {
        pendingWrites -= 1;
        if (pendingWrites === 0) queuedFailed = false;
      }
    });
    // File vide : une seule relecture pour toutes les écritures qui viennent
    // de passer. Une écriture ajoutée entre-temps attend la fin de celle-ci.
    queue = run.then(async (result) => {
      if (pendingWrites > 0) return;
      if (ops.some((o) => o.done)) await resync();
      else if (result !== false) render(state);
    });
    return run;
  }

  // Nombre d'écritures en cours ou en attente (celle qui s'exécute comprise).
  const queuedWrites = () => pendingWrites;

  async function refresh() {
    try {
      rebase(await api.refresh());
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  return { state, start, stop, poll, mutate, refresh, queuedWrites, writeDomain };
}
