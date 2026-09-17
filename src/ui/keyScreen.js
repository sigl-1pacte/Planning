export function renderKeyScreen(root, { api, reason, onValidated }) {
  root.hidden = false;
  root.innerHTML = `
    <form class="keybox">
      <h2>Clé API Linear</h2>
      <p class="hint">La clé reste dans ce navigateur. Elle est envoyée à chaque requête vers ce site, qui l'utilise pour interroger Linear sans jamais la conserver.</p>
      <p class="why" hidden></p>
      <label for="linear-key">Clé personnelle (Linear → Settings → API)</label>
      <input id="linear-key" type="password" autocomplete="off" spellcheck="false" required>
      <p class="err" hidden></p>
      <button class="btn pri" type="submit">Valider la clé</button>
    </form>`;
  const why = root.querySelector('.why');
  const err = root.querySelector('.err');
  const input = root.querySelector('input');
  const button = root.querySelector('button');
  if (reason) {
    why.textContent = reason;
    why.hidden = false;
  }
  input.focus();

  root.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    button.disabled = true;
    err.hidden = true;
    try {
      const user = await api.saveKey(key);
      root.hidden = true;
      root.innerHTML = '';
      onValidated(user);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      button.disabled = false;
    }
  });
}
