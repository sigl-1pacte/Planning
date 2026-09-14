import { describe, it, expect, vi } from 'vitest';
import { createKeyValidator, fingerprint } from '../../src/server/auth.js';
import { LinearAuthError, LinearRateLimitError, LinearUnavailableError } from '../../src/server/linear/client.js';

describe('createKeyValidator', () => {
  it('met en cache une clé valide pendant cinq minutes', async () => {
    let t = 0;
    const fetchViewer = vi.fn(async () => ({ id: 'u1' }));
    const validate = createKeyValidator({ fetchViewer, now: () => t });
    expect(await validate('k')).toEqual({ id: 'u1' });
    t = 299_000;
    await validate('k');
    expect(fetchViewer).toHaveBeenCalledOnce();
    t = 300_001;
    await validate('k');
    expect(fetchViewer).toHaveBeenCalledTimes(2);
  });

  it('refuse une clé absente sans appeler Linear', async () => {
    const fetchViewer = vi.fn();
    await expect(createKeyValidator({ fetchViewer })(undefined)).rejects.toBeInstanceOf(LinearAuthError);
    expect(fetchViewer).not.toHaveBeenCalled();
  });

  it('ne met pas en cache une clé refusée', async () => {
    const fetchViewer = vi.fn(async () => { throw new LinearAuthError(); });
    const validate = createKeyValidator({ fetchViewer });
    await expect(validate('bad')).rejects.toBeInstanceOf(LinearAuthError);
    await expect(validate('bad')).rejects.toBeInstanceOf(LinearAuthError);
    expect(fetchViewer).toHaveBeenCalledTimes(2);
  });

  describe('pendant une panne de Linear', () => {
    const expired = (error) => {
      let t = 0;
      const fetchViewer = vi.fn().mockResolvedValueOnce({ id: 'u1' });
      if (error) fetchViewer.mockRejectedValueOnce(error);
      const validate = createKeyValidator({ fetchViewer, now: () => t });
      return { fetchViewer, validate, expire: () => { t += 300_001; } };
    };

    it('garde le dernier utilisateur connu si Linear est injoignable', async () => {
      const s = expired(new LinearUnavailableError());
      await s.validate('k');
      s.expire();
      expect(await s.validate('k')).toEqual({ id: 'u1' });
      expect(s.fetchViewer).toHaveBeenCalledTimes(2);
    });

    it('garde le dernier utilisateur connu sur dépassement de quota', async () => {
      const s = expired(new LinearRateLimitError());
      await s.validate('k');
      s.expire();
      expect(await s.validate('k')).toEqual({ id: 'u1' });
    });

    it('oublie la clé révoquée puis ne la sert plus pendant une panne', async () => {
      const s = expired(new LinearAuthError());
      s.fetchViewer.mockRejectedValueOnce(new LinearUnavailableError());
      await s.validate('k');
      s.expire();
      await expect(s.validate('k')).rejects.toBeInstanceOf(LinearAuthError);
      await expect(s.validate('k')).rejects.toBeInstanceOf(LinearUnavailableError);
    });

    it('propage la panne pour une clé jamais validée', async () => {
      const fetchViewer = vi.fn(async () => { throw new LinearUnavailableError(); });
      await expect(createKeyValidator({ fetchViewer })('k')).rejects.toBeInstanceOf(LinearUnavailableError);
    });
  });

  it('indexe le cache sur une empreinte qui ne contient pas la clé', () => {
    const fp = fingerprint('lin_api_secret');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain('secret');
  });
});
