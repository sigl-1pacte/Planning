import { AuthError } from './api.js';

export const POLL_MS = 30_000;

export function createController({
  api, render, showKeyScreen,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
}) {
  const state = { snapshot: null, planning: null, error: null };
  let timer = null;
  let starting = false;
  // Incrémenté au début de chaque modification : une réponse obtenue avant la
  // dernière modification commencée ne doit pas écraser la planification.
  let planningRevision = 0;
  // Une interrogation lancée avant (ou pendant) une écriture peut rendre
  // l'instantané d'avant l'écriture, et sa réponse arriver après celle de
  // l'écriture : l'appliquer ferait disparaître ce qui vient d'être créé
  // jusqu'au sondage suivant. writeSeq change au début et à la fin de chaque
  // écriture, pendingWrites compte celles en cours.
  let writeSeq = 0;
  let pendingWrites = 0;

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
      Object.assign(state, { snapshot, planning, error: null });
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
    const seq = writeSeq;
    try {
      const [next, planning] = await Promise.all([api.snapshot(state.snapshot.version), api.planning()]);
      if (pendingWrites > 0 || seq !== writeSeq) return;
      state.snapshot = next.domain ? next : { ...next, domain: state.snapshot.domain };
      if (revision === planningRevision) state.planning = planning;
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  // Les écritures passent une par une, dans l'ordre où l'utilisateur les a
  // faites : chacune calcule ce qu'elle envoie (ex. la description Linear, qui
  // porte aussi date de début, points réels et contributeurs) à partir du
  // domaine relu après la précédente. En parallèle, la seconde repartait de
  // l'ancien texte et effaçait la première dans Linear.
  let queue = Promise.resolve();
  let queuedFailed = false;

  // Résout à true si l'écriture a abouti, false si elle a échoué (l'erreur est
  // alors déjà affichée) : permet à l'appelant de ne fermer un formulaire de
  // création qu'en cas de succès.
  function mutate(call) {
    planningRevision += 1;
    pendingWrites += 1;
    writeSeq += 1;
    const run = queue.then(async () => {
      try {
        state.planning = await call(api);
        // L'erreur d'une écriture précédente de la même file reste affichée.
        if (!queuedFailed) state.error = null;
        // Une écriture attend encore : redessiner maintenant, avec un domaine
        // qui ne la contient pas, ramènerait à l'ancienne valeur ce que
        // l'utilisateur vient de changer. La dernière de la file redessine.
        if (pendingWrites === 1) render(state);
        return true;
      } catch (err) {
        queuedFailed = true;
        fail(err);
        return false;
      } finally {
        pendingWrites -= 1;
        writeSeq += 1;
        if (pendingWrites === 0) queuedFailed = false;
      }
    });
    queue = run;
    return run;
  }

  // Nombre d'écritures en cours ou en attente (celle qui s'exécute comprise).
  const queuedWrites = () => pendingWrites;

  async function refresh() {
    try {
      state.snapshot = await api.refresh();
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  return { state, start, stop, poll, mutate, refresh, queuedWrites };
}
