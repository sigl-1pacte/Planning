const PREFS_KEY = 'planning.prefs';
const DEFAULTS = { zoom: 'all', dayWidth: null, collapsed: [], showCanceled: false, lastRoute: '#/' };

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
