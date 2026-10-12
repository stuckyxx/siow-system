/**
 * Funil comercial (módulo 2): um funil padrão por organização, etapas configuráveis
 * (nome, ordem, probabilidade, tipo OPEN/WON/LOST, SLA em dias). Etapas com oportunidades não são apagadas.
 */
import { DEFAULT_PIPELINE_STAGES } from '@siow/db';
import type { PipelineRow, PipelineStageRow } from '@siow/shared';
import type { z } from 'zod';
import type { updatePipelineSchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { currentOrgId } from '../../tenant.js';
import { audit } from '../../audit.js';
import { badRequest, notFound, type Ctx } from '../../http.js';

const toStage = (s: { id: string; pipelineId: string; name: string; position: number; probability: number; kind: string; slaDays: number | null; color: string | null }): PipelineStageRow => ({ id: s.id, pipelineId: s.pipelineId, name: s.name, position: s.position, probability: s.probability, kind: s.kind as PipelineStageRow['kind'], slaDays: s.slaDays, color: s.color });

export async function list(): Promise<PipelineRow[]> {
  const rows = await prisma.pipeline.findMany({ where: { deletedAt: null }, include: { stages: { orderBy: { position: 'asc' } } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  return rows.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, isActive: p.isActive, stages: p.stages.map(toStage) }));
}

/** Funil padrão da organização; cria o padrão do PROMPT MESTRE se ainda não existir (organizações antigas ao bootstrap). */
export async function ensureDefault(): Promise<PipelineRow> {
  const existing = await prisma.pipeline.findFirst({ where: { deletedAt: null }, include: { stages: { orderBy: { position: 'asc' } } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  if (existing) return { id: existing.id, name: existing.name, isDefault: existing.isDefault, isActive: existing.isActive, stages: existing.stages.map(toStage) };
  const org = currentOrgId();
  const created = await prisma.pipeline.create({
    data: { organizationId: org, name: 'Funil comercial', isDefault: true, stages: { create: DEFAULT_PIPELINE_STAGES.map((st, i) => ({ organizationId: org, name: st.name, position: i + 1, probability: st.probability, kind: st.kind, slaDays: st.slaDays })) } },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  return { id: created.id, name: created.name, isDefault: created.isDefault, isActive: created.isActive, stages: created.stages.map(toStage) };
}

export async function get(id: string): Promise<PipelineRow> {
  const p = await prisma.pipeline.findFirst({ where: { id, deletedAt: null }, include: { stages: { orderBy: { position: 'asc' } } } });
  if (!p) throw notFound('Funil não encontrado');
  return { id: p.id, name: p.name, isDefault: p.isDefault, isActive: p.isActive, stages: p.stages.map(toStage) };
}

/**
 * Atualiza nome e etapas. Etapas existentes (com id) são atualizadas/reordenadas; novas são criadas;
 * as ausentes só são removidas se não tiverem oportunidades (senão: erro explicando).
 */
export async function update(ctx: Ctx, id: string, input: z.infer<typeof updatePipelineSchema>): Promise<PipelineRow> {
  const before = await get(id);
  if (input.stages) {
    const kinds = input.stages.map((s) => s.kind);
    if (kinds.filter((k) => k === 'WON').length !== 1 || kinds.filter((k) => k === 'LOST').length !== 1) throw badRequest('O funil precisa de exatamente uma etapa "Ganho" e uma "Perdido"');
    if (kinds.filter((k) => k === 'OPEN').length < 1) throw badRequest('O funil precisa de pelo menos uma etapa em andamento');
    const keep = new Set(input.stages.map((s) => s.id).filter(Boolean) as string[]);
    const removed = before.stages.filter((s) => !keep.has(s.id));
    for (const r of removed) {
      const n = await prisma.opportunity.count({ where: { stageId: r.id, deletedAt: null } });
      if (n > 0) throw badRequest(`A etapa "${r.name}" tem ${n} oportunidade(s); mova-as antes de removê-la`);
    }
    const org = currentOrgId();
    await prisma.$transaction(async (tx) => {
      if (removed.length) await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      // posições temporárias para evitar colisão durante a reordenação
      for (const s of before.stages.filter((s) => keep.has(s.id))) await tx.pipelineStage.update({ where: { id: s.id }, data: { position: s.position + 1000 } });
      for (const [i, s] of input.stages!.entries()) {
        const data = { name: s.name, position: i + 1, probability: s.kind === 'WON' ? 100 : s.kind === 'LOST' ? 0 : s.probability, kind: s.kind, slaDays: s.kind === 'OPEN' ? s.slaDays ?? null : null, color: s.color ?? null };
        if (s.id && keep.has(s.id)) await tx.pipelineStage.update({ where: { id: s.id }, data });
        else await tx.pipelineStage.create({ data: { ...data, organizationId: org, pipelineId: id } });
      }
      if (input.name) await tx.pipeline.update({ where: { id }, data: { name: input.name } });
    });
  } else if (input.name) await prisma.pipeline.update({ where: { id }, data: { name: input.name } });
  const after = await get(id);
  await audit(ctx, { action: 'UPDATE', resource: 'pipeline', resourceId: id, before, after });
  return after;
}
