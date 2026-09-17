import { describe, it, expect, vi } from 'vitest';
import { createUndo } from '../../src/ui/undo.js';

describe('createUndo', () => {
  it('n\'a rien à annuler au départ', () => {
    expect(createUndo({}).current()).toBeNull();
  });

  it('arme puis expire après la fenêtre', () => {
    let now = 0;
    let fn = null;
    const undo = createUndo({
      windowMs: 15_000, now: () => now,
      setTimeoutImpl: (f) => { fn = f; return 1; }, clearTimeoutImpl: () => {},
    });
    undo.arm('Titre modifié', async () => {});
    expect(undo.current()).toEqual({ label: 'Titre modifié' });
    fn();
    expect(undo.current()).toBeNull();
  });

  it('une nouvelle écriture éclipse l\'annulation précédente', () => {
    const cleared = vi.fn();
    const undo = createUndo({ setTimeoutImpl: () => 7, clearTimeoutImpl: cleared });
    undo.arm('A', async () => {});
    undo.arm('B', async () => {});
    expect(cleared).toHaveBeenCalledWith(7);
    expect(undo.current()).toEqual({ label: 'B' });
  });

  it('exécute la restauration puis désarme', async () => {
    const restore = vi.fn(async () => {});
    const undo = createUndo({ setTimeoutImpl: () => 1, clearTimeoutImpl: () => {} });
    undo.arm('A', restore);
    await undo.trigger();
    expect(restore).toHaveBeenCalledOnce();
    expect(undo.current()).toBeNull();
  });

  it('ne fait rien si aucune annulation n\'est armée', async () => {
    await expect(createUndo({}).trigger()).resolves.toBeUndefined();
  });
});
