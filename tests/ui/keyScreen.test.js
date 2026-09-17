// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderKeyScreen } from '../../src/ui/keyScreen.js';
import { AuthError } from '../../src/ui/api.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('keyScreen', () => {
  it('affiche le motif, valide la clé et prévient l’appelant', async () => {
    const root = document.createElement('div');
    root.hidden = true;
    const api = { saveKey: vi.fn(async () => ({ id: 'u1', name: 'Sacha' })) };
    const onValidated = vi.fn();
    renderKeyScreen(root, { api, reason: 'Clé <b>révoquée</b>', onValidated });
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.why').textContent).toBe('Clé <b>révoquée</b>');
    root.querySelector('input').value = '  lin_api_1  ';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(api.saveKey).toHaveBeenCalledWith('lin_api_1');
    expect(onValidated).toHaveBeenCalledWith({ id: 'u1', name: 'Sacha' });
    expect(root.hidden).toBe(true);
  });

  it('affiche le refus sans fermer', async () => {
    const root = document.createElement('div');
    const api = { saveKey: vi.fn(async () => { throw new AuthError('Clé Linear invalide ou révoquée'); }) };
    renderKeyScreen(root, { api, reason: null, onValidated: vi.fn() });
    root.querySelector('input').value = 'bad';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('.err').textContent).toBe('Clé Linear invalide ou révoquée');
    expect(root.hidden).toBe(false);
    expect(root.querySelector('button').disabled).toBe(false);
  });
});
