/**
 * Renderizador mínimo de templates de mensagem.
 * Suporta {{variavel}} e seções condicionais {{#variavel}}...{{/variavel}}
 * (renderizadas apenas se a variável tiver valor não vazio).
 * Não avalia código — seguro para templates editáveis por usuários.
 */
export type TemplateVars = Record<string, string | number | null | undefined>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  const sectionRe = /\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  let out = template.replace(sectionRe, (_m, key: string, inner: string) => {
    const v = vars[key];
    return v === null || v === undefined || v === '' ? '' : inner;
  });
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
  return out;
}

/** Extrai as variáveis referenciadas em um template (para validação/UI). */
export function extractTemplateVars(template: string): string[] {
  const set = new Set<string>();
  for (const m of template.matchAll(/\{\{[#/]?([\w.]+)\}\}/g)) set.add(m[1]!);
  return [...set];
}
