// Relance une synchronisation complète tant que ce que Linear vient de créer
// n'apparaît pas dans l'instantané : Linear reste la source de vérité, et une
// lecture juste après une écriture peut, rarement, ne pas encore la refléter.
// Sans cela, l'élément créé n'apparaîtrait qu'au prochain cycle complet
// (jusqu'à dix minutes plus tard). Après `attempts` essais, on rend le dernier
// instantané tel quel : le sondage ordinaire rattrapera le reste.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function refreshUntil(store, key, isPresent, { attempts = 3, delayMs = 400 } = {}) {
  let snap;
  for (let i = 0; i < attempts; i += 1) {
    snap = await store.forceRefresh(key, { full: true });
    if (isPresent(snap.domain)) break;
    if (i < attempts - 1) await wait(delayMs);
  }
  return snap;
}
