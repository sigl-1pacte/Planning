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

  // Résout à true si l'écriture a abouti, false si elle a échoué (l'erreur est
  // alors déjà affichée) : permet à l'appelant de ne fermer un formulaire de
  // création qu'en cas de succès.
  async function mutate(call) {
    const revision = ++planningRevision;
    pendingWrites += 1;
    writeSeq += 1;
    try {
      const planning = await call(api);
      if (revision !== planningRevision) return true;
      state.planning = planning;
      state.error = null;
      render(state);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      pendingWrites -= 1;
      writeSeq += 1;
    }
  }

  async function refresh() {
    try {
      state.snapshot = await api.refresh();
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  return { state, start, stop, poll, mutate, refresh };
}
