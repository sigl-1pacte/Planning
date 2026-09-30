export function createUndo({
  windowMs = 15_000,
  now = () => Date.now(),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (id) => clearTimeout(id),
} = {}) {
  let entry = null;
  let timer = null;

  // Sans argument, retire l'annulation proposée ; avec l'entrée rendue par
  // arm(), seulement si c'est encore elle (une autre a pu la remplacer).
  // Rend true si une annulation a été retirée.
  function disarm(which) {
    if (!entry || (which && which !== entry)) return false;
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    entry = null;
    return true;
  }

  return {
    arm(label, restore) {
      disarm();
      entry = { label, restore, armedAt: now() };
      timer = setTimeoutImpl(() => disarm(), windowMs);
      return entry;
    },
    disarm,
    current: () => (entry ? { label: entry.label } : null),
    async trigger() {
      if (!entry) return;
      const { restore } = entry;
      disarm();
      await restore();
    },
  };
}
