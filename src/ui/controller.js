import { AuthError } from './api.js';

export const POLL_MS = 30_000;

export function createController({
  api, render, showKeyScreen,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
}) {
  const state = { snapshot: null, planning: null, error: null };
  let timer = null;

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
    if (!api.getKey()) {
      showKeyScreen(null);
      return;
    }
    try {
      const [snapshot, planning] = await Promise.all([api.snapshot(null), api.planning()]);
      Object.assign(state, { snapshot, planning, error: null });
      render(state);
      stop();
      timer = setIntervalImpl(poll, POLL_MS);
    } catch (err) {
      fail(err);
    }
  }

  async function poll() {
    try {
      const next = await api.snapshot(state.snapshot.version);
      state.snapshot = next.domain ? next : { ...next, domain: state.snapshot.domain };
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
    }
  }

  async function mutate(call) {
    try {
      state.planning = await call(api);
      state.error = null;
      render(state);
    } catch (err) {
      fail(err);
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
