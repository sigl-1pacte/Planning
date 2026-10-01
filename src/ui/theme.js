// src/ui/theme.js
// Thème clair / sombre (choix « auto » : celui du système) et mode rose,
// posés sur <html> (data-theme, data-pink) : styles.css fait le reste. Le
// même calcul tourne aussi, plus tôt, dans un petit script en tête
// d'index.html, pour qu'un rechargement ne flashe jamais l'autre thème.

export function resolveTheme(choice, systemDark) {
  if (choice === 'dark' || choice === 'light') return choice;
  return systemDark ? 'dark' : 'light';
}

export function applyTheme(prefs, { root = document.documentElement, systemDark = false } = {}) {
  const theme = resolveTheme(prefs.theme, systemDark);
  root.dataset.theme = theme;
  root.toggleAttribute('data-pink', Boolean(prefs.pink));
  // Barre d'adresse et fond de la zone d'étirement au diapason du thème.
  const meta = root.ownerDocument?.querySelector('meta[name="theme-color"]');
  if (meta && typeof getComputedStyle === 'function') {
    meta.content = getComputedStyle(root).getPropertyValue('--bg-base').trim() || meta.content;
  }
  return theme;
}

// Œuf de Pâques : cinq clics rapprochés sur le logo, ou les lettres
// « rose » tapées à la suite hors d'un champ de saisie.
export function createEasterEgg({ onTrigger, clicks = 5, windowMs = 1600, word = 'rose', now = () => Date.now() }) {
  let times = [];
  let typed = '';
  return {
    logoClick() {
      const t = now();
      times = [...times.filter((x) => t - x < windowMs), t];
      if (times.length >= clicks) {
        times = [];
        onTrigger();
      }
    },
    key(event) {
      const target = event.target;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (event.key?.length !== 1) return;
      typed = (typed + event.key.toLowerCase()).slice(-word.length);
      if (typed === word) {
        typed = '';
        onTrigger();
      }
    },
  };
}
