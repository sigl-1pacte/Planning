// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { resolveTheme, applyTheme, createEasterEgg } from '../../src/ui/theme.js';

describe('thème', () => {
  it('« auto » suit le système, sinon le choix explicite', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('pose le thème et le mode rose sur <html>', () => {
    const root = document.createElement('html');
    expect(applyTheme({ theme: 'auto', pink: true }, { root, systemDark: true })).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.hasAttribute('data-pink')).toBe(true);
    applyTheme({ theme: 'light', pink: false }, { root });
    expect(root.dataset.theme).toBe('light');
    expect(root.hasAttribute('data-pink')).toBe(false);
  });
});

describe('œuf de Pâques', () => {
  it('cinq clics rapprochés sur le logo, pas cinq clics étalés', () => {
    let t = 0;
    const onTrigger = vi.fn();
    const egg = createEasterEgg({ onTrigger, now: () => t });
    for (let i = 0; i < 4; i++) { egg.logoClick(); t += 300; }
    t += 2000;
    egg.logoClick();
    expect(onTrigger).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) { t += 200; egg.logoClick(); }
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('« rose » tapé hors d’un champ, jamais pendant une saisie', () => {
    const onTrigger = vi.fn();
    const egg = createEasterEgg({ onTrigger });
    const input = document.createElement('input');
    const type = (text, target = document.body) => [...text].forEach((key) => egg.key({ key, target }));
    type('rose', input);
    expect(onTrigger).not.toHaveBeenCalled();
    type('la rose');
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});
