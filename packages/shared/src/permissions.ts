/** Permissões efetivas = união das permissões dos papéis + concedidas individualmente − removidas individualmente. */
export function effectivePermissions(rolePermissions: string[][], adjustments: Array<{ code: string; granted: boolean }>): string[] {
  const set = new Set<string>();
  for (const perms of rolePermissions) for (const p of perms) set.add(p);
  for (const a of adjustments) { if (a.granted) set.add(a.code); else set.delete(a.code); }
  return [...set].sort();
}
