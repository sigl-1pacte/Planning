const PREFS_KEY = 'planning.prefs';
const DEFAULTS = {
  zoom: 'all', dayWidth: null, collapsed: [], showCanceled: false, lastRoute: '#/', loadMode: 'planned',
  // Thème : 'auto' (celui du système), 'light' ou 'dark' ; mode rose, et s'il
  // a déjà été découvert (son interrupteur apparaît alors dans les réglages).
  theme: 'auto', pink: false, pinkFound: false,
};

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    return { ...DEFAULTS, ...JSON.parse(storage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try { storage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* préférences non conservées */ }
}
