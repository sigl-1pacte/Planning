export const jsonResponse = (body, status = 200) => ({ status, json: async () => body });

export function fakeFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch : plus de réponse prévue');
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}
