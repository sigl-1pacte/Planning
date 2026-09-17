export function createUndo({
  windowMs = 15_000,
  now = () => Date.now(),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (id) => clearTimeout(id),
} = {}) {
  let entry = null;
  let timer = null;

  function disarm() {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    entry = null;
  }

  return {
    arm(label, restore) {
      disarm();
      entry = { label, restore, armedAt: now() };
      timer = setTimeoutImpl(disarm, windowMs);
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
