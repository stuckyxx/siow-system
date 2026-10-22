#!/usr/bin/env node
/**
 * Gera o arquivo estático do Mapa de cobertura (Comercial): municípios de MA, PI e TO já projetados em
 * caminhos SVG, contornos dos estados e capitais. Roda só em desenvolvimento (não é dependência do app):
 *
 *   node scripts/geo/build-mapa.mjs
 *
 * Fontes: tbrugz/geodata-br (geojs-21/22/17-mun.json) + malha oficial do IBGE para Nazária (PI, 2206720),
 * ausente na fonte (o polígono de Nazária é desenhado sobre o de Teresina, de onde foi desmembrada).
 * Lista oficial de municípios: API de localidades do IBGE (nomes e contagem conferidos).
 * Simplificação com mapshaper (via npx), preservando as divisas compartilhadas.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const out = join(here, '../../apps/web/public/geo/mapa-ma-pi-to.json');
const outServer = join(here, '../../apps/web/src/server/geo/municipios-ma-pi-to.ts');
mkdirSync(cache, { recursive: true });

const STATES = [
  { uf: 'MA', code: '21', name: 'Maranhão', expected: 217 },
  { uf: 'PI', code: '22', name: 'Piauí', expected: 224 },
  { uf: 'TO', code: '17', name: 'Tocantins', expected: 139 },
];
const CAPITALS = { '2111300': 'São Luís', '2211001': 'Teresina', '1721000': 'Palmas' };
const EXTRA_IBGE = ['2206720']; // municípios ausentes na fonte tbrugz, obtidos da malha do IBGE
const SIMPLIFY = process.env.SIMPLIFY ?? '40%'; // ~370 KB para os 3 estados

async function fetchCached(url, file) {
  const p = join(cache, file);
  if (!existsSync(p)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const features = [];
const officialNames = {};
for (const s of STATES) {
  const list = await fetchCached(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${s.uf}/municipios`, `ibge-${s.uf}.json`);
  for (const m of list) officialNames[String(m.id)] = m.nome;
  if (list.length !== s.expected) console.warn(`⚠ ${s.uf}: IBGE lista ${list.length} municípios (esperado ${s.expected})`);
  const geo = await fetchCached(`https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${s.code}-mun.json`, `geojs-${s.code}-mun.json`);
  for (const f of geo.features) features.push({ type: 'Feature', properties: { id: String(f.properties.id), uf: s.uf }, geometry: f.geometry });
}
for (const id of EXTRA_IBGE) {
  const g = await fetchCached(`https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${id}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria`, `ibge-malha-${id}.json`);
  const uf = STATES.find((s) => id.startsWith(s.code)).uf;
  features.push({ type: 'Feature', properties: { id, uf }, geometry: g.features[0].geometry });
}
// conferência: todos os municípios oficiais presentes
const have = new Set(features.map((f) => f.properties.id));
const missing = Object.keys(officialNames).filter((id) => !have.has(id));
const extra = [...have].filter((id) => !officialNames[id]);
if (missing.length || extra.length) throw new Error(`Divergência com o IBGE — faltando: ${missing.join(',')} · sobrando: ${extra.join(',')}`);

// Base (tbrugz) e extras (IBGE) processados à parte: o `clean` absorveria Nazária, sobreposta a Teresina.
const isExtra = (f) => EXTRA_IBGE.includes(f.properties.id);
writeFileSync(join(cache, 'base.json'), JSON.stringify({ type: 'FeatureCollection', features: features.filter((f) => !isExtra(f)) }));
writeFileSync(join(cache, 'extra.json'), JSON.stringify({ type: 'FeatureCollection', features: features.filter(isExtra) }));
const ms = (args) => execFileSync('npx', ['-y', 'mapshaper@0.6.102', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
ms(['-i', join(cache, 'base.json'), 'snap', '-clean', '-simplify', SIMPLIFY, 'keep-shapes', '-o', join(cache, 'mun.json'), 'precision=0.00001', 'force']);
ms(['-i', join(cache, 'extra.json'), '-simplify', SIMPLIFY, 'keep-shapes', '-o', join(cache, 'extra-s.json'), 'precision=0.00001', 'force']);
ms(['-i', join(cache, 'mun.json'), '-dissolve', 'uf', '-o', join(cache, 'states.json'), 'precision=0.00001', 'force']);
const mun = JSON.parse(readFileSync(join(cache, 'mun.json'), 'utf8'));
mun.features.push(...JSON.parse(readFileSync(join(cache, 'extra-s.json'), 'utf8')).features);
const empty = mun.features.filter((f) => !f.geometry || !f.geometry.coordinates.length).map((f) => f.properties.id);
if (empty.length || mun.features.length !== features.length) throw new Error(`Simplificação perdeu municípios: vazios ${empty.join(',')} · ${mun.features.length}/${features.length}`);
const states = JSON.parse(readFileSync(join(cache, 'states.json'), 'utf8'));

// Projeção equiretangular com correção do cosseno da latitude média (adequada para a região).
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
const eachCoord = (geom, fn) => { const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates; for (const poly of polys) for (const ring of poly) for (const c of ring) fn(c); };
for (const f of mun.features) eachCoord(f.geometry, ([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
const W = 1000; const scale = W / ((maxX - minX) * k); const H = Math.round((maxY - minY) * scale);
const P = ([x, y]) => [Math.round((x - minX) * k * scale * 10) / 10, Math.round((maxY - y) * scale * 10) / 10];
function pathOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let d = '';
  for (const poly of polys) for (const ring of poly) {
    let prev = null; let seg = '';
    for (const c of ring) { const [x, y] = P(c); if (prev && prev[0] === x && prev[1] === y) continue; seg += (seg ? 'L' : 'M') + x + ' ' + y; prev = [x, y]; }
    d += seg.replace(/L(?=[^L]*$)/, 'L') + 'Z';
  }
  return d;
}
// ponto de rótulo: centroide do maior anel externo (média ponderada por área — fórmula do polígono)
function labelPoint(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const poly of polys) {
    const r = poly[0].map(P); let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [Math.round(cx / (3 * a) * 10) / 10, Math.round(cy / (3 * a) * 10) / 10]; }
  }
  return best ?? P(polys[0][0][0]);
}
function bbox(geom) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; eachCoord(geom, (pt) => { const [x, y] = P(pt); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }); return [a, b, c, d].map((v) => Math.round(v)); }

const order = (f) => (EXTRA_IBGE.includes(f.properties.id) ? 1 : 0); // Nazária por cima de Teresina
const municipalities = mun.features.sort((a, b) => order(a) - order(b)).map((f) => ({ id: f.properties.id, n: officialNames[f.properties.id], uf: f.properties.uf, d: pathOf(f.geometry), c: labelPoint(f.geometry), ...(CAPITALS[f.properties.id] ? { cap: 1 } : {}) }));
const stateOut = states.features.map((f) => ({ uf: f.properties.uf, name: STATES.find((s) => s.uf === f.properties.uf).name, d: pathOf(f.geometry), box: bbox(f.geometry), count: municipalities.filter((m) => m.uf === f.properties.uf).length }));
const data = { source: 'IBGE (malha municipal e localidades) · tbrugz/geodata-br', generatedAt: new Date().toISOString().slice(0, 10), viewBox: [0, 0, W, H], states: stateOut, municipalities };
writeFileSync(out, JSON.stringify(data));
// Lista leve para o servidor (validação de código IBGE e preenchimento automático no cadastro de entidades).
mkdirSync(dirname(outServer), { recursive: true });
const rows = municipalities.slice().sort((a, b) => a.id.localeCompare(b.id)).map((m) => `  ['${m.id}', '${m.uf}', ${JSON.stringify(m.n)}],`).join('\n');
writeFileSync(outServer, `/** Gerado por scripts/geo/build-mapa.mjs — não edite à mão. Municípios de MA, PI e TO (IBGE). */\nexport const COVERAGE_UFS = ['MA', 'PI', 'TO'] as const;\nexport const CAPITALS: Record<string, string> = ${JSON.stringify(CAPITALS)};\nexport const MUNICIPALITIES: ReadonlyArray<readonly [ibge: string, uf: string, name: string]> = [\n${rows}\n];\n`);
console.log(`OK ${out}: ${municipalities.length} municípios (${STATES.map((s) => `${s.uf} ${municipalities.filter((m) => m.uf === s.uf).length}`).join(', ')}), ${(statSync(out).size / 1024).toFixed(0)} KB, viewBox ${W}x${H}`);
