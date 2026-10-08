import { httpRequest } from '../../http/client.js';
import { ProviderError, type BillingProvider, type BillingSnapshot, type DocumentRef, type FetchedFile, type ProviderContext } from '../../types.js';
import { groupPartnerInvoices, parseAdoisIndex, parseAdoisList, type ParsedAdoisIndex, type ParsedAdoisList, type PartnerGroup } from './parser.js';

/** Configuração gravada em DataSource.config para fontes derivadas de um link de parceiro. */
export interface AdoisSourceConfig {
  partner?: boolean;
  /** "CM|ICATU|MA" — a entidade (município) desta fonte dentro do link de parceiro */
  entityKey?: string;
}

/**
 * Provider do Portal do Cliente da Adois (adoissolucoes.com/adm_faturas).
 *
 * Fluxo:
 *  1. GET <url>                   → tipoEntidade/codEntidade, nome, resumo, notas pendentes
 *  2. POST ajax/Faturas.ajax.php  → listagem completa (pendentes + quitadas, todos os anos)
 *  3. link de parceiro (t=2 / config.partner): agrupa por contrato → entidade da descrição e devolve
 *     apenas as notas da entidade desta fonte (config.entityKey). O resumo do portal é da empresa
 *     inteira, por isso não é usado na conferência.
 *
 * Certidões do portal Adois são da própria Adois (não da Siow) e não são sincronizadas.
 */
export class AdoisPortalProvider implements BillingProvider {
  readonly key = 'ADOIS_PORTAL' as const;

  /** GET da página + POST da listagem completa. Compartilhado por fetchSnapshot e pela descoberta de parceiros. */
  async fetchAll(url: string, ctx: ProviderContext): Promise<{ index: ParsedAdoisIndex; list: ParsedAdoisList; complete: boolean; pageUrl: string; warnings: string[] }> {
    const page = await httpRequest(url, { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, fetchImpl: ctx.fetchImpl });
    const html = page.text();
    if (!/adm_faturas|ModalFaturas|codEntidade/i.test(html)) {
      throw new ProviderError('Conteúdo inesperado: a página não parece ser o Portal do Cliente da Adois', false, page.status);
    }
    const index = parseAdoisIndex(html, page.url);
    const warnings = [...index.warnings];
    let list: ParsedAdoisList = index;
    let complete = false;
    if (index.entity.externalCode) {
      try {
        const res = await httpRequest(new URL('ajax/Faturas.ajax.php', page.url).toString(), {
          method: 'POST',
          body: new URLSearchParams({ callback: 'Faturas', callback_action: 'filtro_tipo', p_tipo: '0', p_tipoEntidade: index.entity.externalType ?? '1', p_codEntidade: index.entity.externalCode }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: page.url },
          timeoutMs: ctx.timeoutMs,
          userAgent: ctx.userAgent,
          fetchImpl: ctx.fetchImpl,
        });
        const full = parseAdoisList(res.text(), page.url);
        warnings.push(...full.warnings);
        if (full.invoices.length === 0 && index.invoices.length > 0) {
          warnings.push('Listagem completa (AJAX) veio vazia; usando apenas notas pendentes da página inicial');
        } else {
          const numbers = new Set(full.invoices.map((i) => i.number));
          const missing = index.invoices.filter((i) => !numbers.has(i.number));
          if (missing.length) warnings.push(`Notas pendentes ausentes na listagem completa: ${missing.map((m) => m.number).join(', ')}`);
          list = { ...full, invoices: [...full.invoices, ...missing], contracts: full.contracts.length ? full.contracts : index.contracts };
          complete = true;
        }
      } catch (err) {
        warnings.push(`Falha ao obter listagem completa: ${(err as Error).message}`);
        ctx.logger?.warn('adois: ajax list failed', err);
      }
    }
    return { index, list, complete, pageUrl: page.url, warnings };
  }

  async fetchSnapshot(input: { url: string; config?: Record<string, unknown> | null }, ctx: ProviderContext): Promise<BillingSnapshot> {
    const cfg = (input.config ?? {}) as AdoisSourceConfig;
    const { index, list, complete, warnings } = await this.fetchAll(input.url, ctx);
    const isPartner = Boolean(cfg.partner) || index.entity.externalType === '2';
    const base: Pick<BillingSnapshot, 'provider' | 'sourceUrl' | 'fetchedAt' | 'certificates' | 'certificatesUpdatedAt' | 'invoiceListComplete'> = {
      provider: this.key, sourceUrl: input.url, fetchedAt: new Date().toISOString(), certificates: [], certificatesUpdatedAt: null, invoiceListComplete: complete,
    };

    if (!isPartner) {
      return { ...base, entity: index.entity, contracts: list.contracts, invoices: list.invoices, summary: index.summary, warnings };
    }
    if (!cfg.entityKey) {
      throw new ProviderError('Link de parceiro: a fonte precisa indicar a entidade (config.entityKey). Use "Importar link de parceiro".', false);
    }
    const grouped = groupPartnerInvoices(list);
    const group = grouped.groups.find((g) => g.key === cfg.entityKey);
    if (!group) {
      // A entidade pode ter deixado de constar no link (contrato encerrado/removido). Snapshot vazio é tratado
      // pela proteção contra "sumiço em massa" do sync-core; aqui só avisamos.
      return {
        ...base,
        entity: { name: null, shortName: null, uf: null, externalCode: index.entity.externalCode, externalType: index.entity.externalType, logoUrl: null },
        contracts: [],
        invoices: [],
        summary: { totalDebt: null, pendingCount: null, paidCount: null, totalPaid: null, lastPaymentAt: null, statusText: null },
        warnings: [...warnings, `Nenhuma nota do link de parceiro identifica a entidade ${cfg.entityKey} (entidades encontradas: ${grouped.groups.map((g) => g.key).join(', ') || 'nenhuma'})`],
      };
    }
    return {
      ...base,
      entity: { name: group.name, shortName: group.shortName, uf: group.uf, externalCode: index.entity.externalCode, externalType: index.entity.externalType, logoUrl: null },
      contracts: group.contracts,
      invoices: group.invoices,
      summary: { totalDebt: group.pendingAmount, pendingCount: group.pendingCount, paidCount: null, totalPaid: null, lastPaymentAt: null, statusText: null },
      // Divergências de grafia entre descrições são reportadas na descoberta (importação), não a cada sincronização —
      // senão a fonte ficaria marcada como PARCIAL para sempre mesmo com a listagem completa.
      warnings,
    };
  }

  /** Lista as entidades (municípios) presentes em um link de parceiro, para cadastro em lote. */
  async discoverPartnerEntities(url: string, ctx: ProviderContext): Promise<{ company: string | null; groups: PartnerGroup[]; unassigned: number; warnings: string[] }> {
    const { index, list, warnings } = await this.fetchAll(url, ctx);
    if (index.entity.externalType !== '2') warnings.push('O link informado não é de parceiro (t=2); as notas pertencem a uma única entidade');
    const grouped = groupPartnerInvoices(list);
    return { company: index.cardName, groups: grouped.groups, unassigned: grouped.unassigned.length, warnings: [...warnings, ...grouped.warnings] };
  }

  async fetchDocument(ref: DocumentRef, ctx: ProviderContext): Promise<FetchedFile> {
    const isPost = ref.method === 'POST';
    const res = await httpRequest(ref.url, {
      method: ref.method,
      body: isPost ? new URLSearchParams(ref.form ?? {}) : undefined,
      headers: isPost ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : undefined,
      timeoutMs: ctx.timeoutMs,
      userAgent: ctx.userAgent,
      fetchImpl: ctx.fetchImpl,
      idempotent: !ref.sideEffects,
    });
    const mimeType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim();
    if (res.buffer.length === 0) throw new ProviderError(`Documento vazio retornado por ${ref.url}`, false, res.status);
    if (mimeType.startsWith('text/html') && ref.kind !== 'SERVICE_REPORT') throw new ProviderError('Portal retornou HTML em vez de documento (pode exigir navegador)', false, res.status);
    const fileName = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? null;
    return { buffer: res.buffer, mimeType, fileName, size: res.buffer.length };
  }
}
