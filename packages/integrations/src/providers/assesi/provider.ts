import { httpRequest } from '../../http/client.js';
import {
  ProviderError,
  type BillingProvider,
  type BillingSnapshot,
  type DocumentRef,
  type FetchedFile,
  type InvoiceSnapshot,
  type ProviderContext,
} from '../../types.js';
import { parseIndexPage, parseInvoiceList } from './parser.js';

/**
 * Provider do Portal do Cliente (HTML) — estratégia 2 da especificação:
 * requisição HTTP + parser estruturado. Sem navegador.
 *
 * Fluxo:
 *  1. GET <url>                    → entidade, resumo, contratos, notas pendentes, certidões
 *  2. POST ajax/Faturas.ajax.php   → listagem completa (pendentes + quitadas, todos os anos)
 *  3. mescla descrições dos modais (só existem para pendentes na página inicial)
 *
 * Se (2) falhar, o snapshot é marcado como `invoiceListComplete=false` e o
 * serviço de sincronização NÃO conclui que notas ausentes foram pagas.
 */
export class AssesiPortalProvider implements BillingProvider {
  readonly key = 'ASSESI_PORTAL' as const;

  async fetchSnapshot(
    input: { url: string; config?: Record<string, unknown> | null },
    ctx: ProviderContext,
  ): Promise<BillingSnapshot> {
    const sourceUrl = input.url;
    const page = await httpRequest(sourceUrl, {
      timeoutMs: ctx.timeoutMs,
      userAgent: ctx.userAgent,
      fetchImpl: ctx.fetchImpl,
    });
    const html = page.text();
    if (!/adm_faturas|invoice-card|entity-name/i.test(html)) {
      throw new ProviderError('Conteúdo inesperado: a página não parece ser o Portal do Cliente', false, page.status);
    }
    const index = parseIndexPage(html, page.url);
    const warnings = [...index.warnings];

    let invoices: InvoiceSnapshot[] = index.invoices;
    let contracts = index.contracts;
    let complete = false;

    if (index.entity.externalCode) {
      try {
        const ajaxUrl = new URL('ajax/Faturas.ajax.php', page.url).toString();
        const body = new URLSearchParams({
          p_tipoEntidade: index.entity.externalType ?? '1',
          p_codEntidade: index.entity.externalCode,
          p_tipo: '0', // Todas
          p_mes: '',
          p_ano: '',
          p_ordem: 'DESC',
          p_busca: '',
        });
        const res = await httpRequest(ajaxUrl, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: page.url,
          },
          timeoutMs: ctx.timeoutMs,
          userAgent: ctx.userAgent,
          fetchImpl: ctx.fetchImpl,
        });
        const list = parseInvoiceList(res.text(), page.url);
        warnings.push(...list.warnings);
        if (list.invoices.length === 0 && index.invoices.length > 0) {
          warnings.push('Listagem completa (AJAX) veio vazia; usando apenas notas pendentes da página inicial');
        } else {
          invoices = list.invoices;
          contracts = list.contracts.length > 0 ? list.contracts : contracts;
          complete = true;
          // Sanidade: todas as pendentes da página inicial devem constar na listagem completa
          const numbers = new Set(list.invoices.map((i) => i.number));
          const missing = index.invoices.filter((i) => !numbers.has(i.number));
          if (missing.length > 0) {
            warnings.push(`Notas pendentes ausentes na listagem completa: ${missing.map((m) => m.number).join(', ')}`);
            invoices = [...invoices, ...missing];
          }
        }
      } catch (err) {
        warnings.push(`Falha ao obter listagem completa: ${(err as Error).message}`);
        ctx.logger?.warn('assesi: ajax list failed', err);
      }
    }

    for (const inv of invoices) {
      const desc = index.descriptions[inv.number];
      if (desc) inv.description = desc;
    }

    return {
      provider: this.key,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      entity: index.entity,
      contracts,
      invoices,
      certificates: index.certificates,
      certificatesUpdatedAt: index.certificatesUpdatedAt,
      summary: index.summary,
      invoiceListComplete: complete,
      warnings,
    };
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
    if (res.buffer.length === 0) {
      throw new ProviderError(`Documento vazio retornado por ${ref.url}`, false, res.status);
    }
    if (mimeType.startsWith('text/html') && ref.kind !== 'SERVICE_REPORT') {
      // O portal respondeu HTML onde esperávamos PDF: provavelmente exige sessão/navegador.
      throw new ProviderError('Portal retornou HTML em vez de documento (pode exigir navegador)', false, res.status);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const fileName = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
    return { buffer: res.buffer, mimeType, fileName, size: res.buffer.length };
  }
}
