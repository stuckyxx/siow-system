import { describe, expect, it } from 'vitest';
import { effectivePermissions } from './permissions.js';

describe('effectivePermissions', () => {
  it('papel + extras − removidas', () => {
    const r = effectivePermissions([['entities.read', 'invoices.read'], ['invoices.read', 'reports.read']], [{ code: 'sync.run', granted: true }, { code: 'reports.read', granted: false }]);
    expect(r).toEqual(['entities.read', 'invoices.read', 'sync.run']);
  });
  it('remoção individual vence o papel; concessão vence a ausência', () => {
    expect(effectivePermissions([['users.manage']], [{ code: 'users.manage', granted: false }])).toEqual([]);
    expect(effectivePermissions([], [{ code: 'audit.read', granted: true }])).toEqual(['audit.read']);
  });
});
