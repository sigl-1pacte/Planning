import { addDays, isValidDate, todayISO } from '../shared/calendar.js';

// Un <input type="date"> natif range ses segments selon la locale du
// navigateur (souvent mois/jour/année) et ce n'est pas configurable : ses
// flèches haut/bas agissaient sur un segment différent de celui qu'affichait
// le texte jj/mm/aaaa posé par-dessus. Le champ visible est donc un champ
// texte jj/mm/aaaa que l'on contrôle entièrement ; l'<input type="date">
// reste dans la page, invisible, comme source de vérité (valeur ISO, événements
// input/change que le reste de l'interface écoute déjà) et pour le calendrier.

export const formatFr = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// « 12/09/2026 » → « 2026-09-12 », null si incomplet ou impossible.
export function parseFr(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidDate(y, mo, d) ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Ne garde que les chiffres et remet les « / » : taper « 12092026 » donne
// « 12/09/2026 ». Pas de « / » final, pour qu'effacer reste naturel.
export function maskFr(text) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean);
  return parts.join('/');
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// unit : 'day' | 'month' | 'year'. Le jour se décale en jours réels (le
// 31 + 1 jour passe au 1er du mois suivant) ; mois et année gardent le jour,
// ramené à la fin du mois si besoin (31 janvier + 1 mois → 28 ou 29 février).
export function stepDate(iso, unit, delta) {
  if (unit === 'day') return addDays(iso, delta);
  const [y, m, d] = iso.split('-').map(Number);
  const total = unit === 'month' ? y * 12 + (m - 1) + delta : (y + delta) * 12 + (m - 1);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const p = (n) => String(n).padStart(2, '0');
  return `${String(ny).padStart(4, '0')}-${p(nm)}-${p(Math.min(d, daysIn(ny, nm)))}`;
}

// Segment sous le curseur dans « jj/mm/aaaa ».
export const unitAt = (pos) => (pos <= 2 ? 'day' : pos <= 5 ? 'month' : 'year');
const RANGE = { day: [0, 2], month: [3, 5], year: [6, 10] };

const CHANGE_DELAY_MS = 500;

function enhance(field) {
  const native = field.querySelector('input[type="date"]');
  if (!native || field.dataset.enhanced) return;
  field.dataset.enhanced = '1';
  field.querySelector('.dovl')?.remove();

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'dtxt';
  text.inputMode = 'numeric';
  text.autocomplete = 'off';
  text.placeholder = 'jj/mm/aaaa';
  text.maxLength = 10;
  text.spellcheck = false;
  // Le <label for> du champ natif désigne désormais le champ visible.
  if (native.id) { text.id = native.id; native.removeAttribute('id'); }
  text.value = native.value ? formatFr(native.value) : '';

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'dpick';
  pick.setAttribute('aria-label', 'Choisir dans le calendrier');
  pick.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>';

  native.classList.add('dnative');
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  field.prepend(text);
  field.append(pick);

  let timer = null;
  const fire = (name) => native.dispatchEvent(new Event(name, { bubbles: true }));
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fire('change');
  };
  // Les flèches maintenues enchaîneraient une écriture Linear par pas : on
  // n'émet « change » qu'une fois la main levée.
  const later = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, CHANGE_DELAY_MS);
  };

  function setIso(iso, { immediate }) {
    native.value = iso;
    text.value = iso ? formatFr(iso) : '';
    text.removeAttribute('aria-invalid');
    fire('input');
    if (immediate) { if (timer !== null) { clearTimeout(timer); timer = null; } fire('change'); } else later();
  }

  text.addEventListener('input', () => {
    const masked = maskFr(text.value);
    if (masked !== text.value) text.value = masked;
    if (masked === '') return setIso('', { immediate: true });
    const iso = parseFr(masked);
    if (iso) return setIso(iso, { immediate: true });
    text.toggleAttribute('aria-invalid', masked.length === 10);
  });

  text.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const pos = text.selectionStart ?? 0;
    const unit = unitAt(pos);
    const base = parseFr(text.value) ?? (native.value || todayISO());
    setIso(stepDate(base, unit, event.key === 'ArrowUp' ? 1 : -1), { immediate: false });
    // Le curseur reste sur le segment modifié pour enchaîner les pas.
    const [from, to] = RANGE[unit];
    text.setSelectionRange(from, to);
  });

  // Une saisie inachevée ou impossible ne reste pas affichée : on revient à
  // la dernière date valide, celle qui est réellement enregistrée.
  text.addEventListener('blur', () => {
    flush();
    if (text.value !== '' && !parseFr(text.value)) {
      text.value = native.value ? formatFr(native.value) : '';
      text.removeAttribute('aria-invalid');
    }
  });

  // Choix dans le calendrier natif.
  native.addEventListener('input', () => { text.value = native.value ? formatFr(native.value) : ''; });
  pick.addEventListener('click', () => {
    if (native.value !== (parseFr(text.value) ?? '')) native.value = parseFr(text.value) ?? native.value;
    if (typeof native.showPicker === 'function') native.showPicker();
    else native.focus();
  });
}

// À appeler après chaque rendu qui contient des `.dfield`.
export function enhanceDateFields(root) {
  root.querySelectorAll('.dfield').forEach(enhance);
}
