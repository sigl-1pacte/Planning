export const LINEAR_URL = 'https://api.linear.app/graphql';

export class LinearAuthError extends Error {
  constructor(message = 'Clé Linear invalide ou révoquée') {
    super(message);
    this.name = 'LinearAuthError';
  }
}

export class LinearRateLimitError extends Error {
  constructor(message = 'Quota Linear dépassé') {
    super(message);
    this.name = 'LinearRateLimitError';
  }
}

export class LinearUnavailableError extends Error {
  constructor(message = 'Linear injoignable') {
    super(message);
    this.name = 'LinearUnavailableError';
  }
}

export async function gql(key, query, variables = {}, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(LINEAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new LinearUnavailableError(`Linear injoignable : ${err.message}`);
  }
  if (res.status === 401) throw new LinearAuthError();
  if (res.status === 429) throw new LinearRateLimitError();
  if (res.status >= 500) throw new LinearUnavailableError(`Linear a répondu ${res.status}`);

  let body;
  try {
    body = await res.json();
  } catch {
    throw new LinearUnavailableError(`Réponse illisible de Linear (statut ${res.status})`);
  }
  if (body.errors?.length) {
    const codes = body.errors.map((e) => e.extensions?.code);
    if (codes.includes('AUTHENTICATION_ERROR')) throw new LinearAuthError();
    if (codes.includes('RATELIMITED')) throw new LinearRateLimitError();
    throw new Error(`Erreur GraphQL Linear : ${body.errors.map((e) => e.message).join(' ; ')}`);
  }
  return body.data;
}
