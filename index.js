// PirateFly Fare Watch: legge /v1/analisi per ogni rotta della watch-list e segnala quelle nella
// fascia bassa del loro storico. Zero dipendenze (fetch di node20), cosi' il repo non porta node_modules.
'use strict';
const fs = require('fs');

const API = process.env.PIRATEFLY_API || 'https://piratefly.com';
const SITO = 'https://piratefly.com';
const RANGO = { ottimo: 0, buono: 1, normale: 2, caro: 3, great: 0, good: 1 };
const NOME = { ottimo: 'great price', buono: 'good price', normale: 'typical price', caro: 'expensive', 'dati-insufficienti': 'not enough data' };

const input = (n, d = '') => (process.env[`INPUT_${n.replace(/ /g, '_').toUpperCase()}`] ?? d).trim();
const scrivi = (file, testo) => { if (file) fs.appendFileSync(file, testo); };
const euro = (cent) => `€${Math.round(cent / 100)}`;

// Stessa regola di sluggifica() del sito, per i nomi di citta' comuni.
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const link = (o, d) => `${SITO}/flights/${slug(o)}-to-${slug(d)}/?src=gh-action`;

function rotte(testo) {
  return testo.split('\n').map((r) => r.trim()).filter((r) => r && !r.startsWith('#')).map((r) => {
    const [o, d] = r.split(/\s*(?:->|→|,|\bto\b)\s*/i).map((x) => x && x.trim());
    if (!o || !d) throw new Error(`route not understood: "${r}" (use "Origin -> Destination")`);
    return { origine: o, destinazione: d };
  });
}

async function analizza({ origine, destinazione }, chiave) {
  const q = new URLSearchParams({ origine, destinazione });
  const r = await fetch(`${API}/v1/analisi?${q}`, {
    headers: { 'User-Agent': 'piratefly-fare-watch-action', ...(chiave ? { 'X-Api-Key': chiave } : {}) },
  });
  const corpo = await r.json().catch(() => ({}));
  return { status: r.status, corpo };
}

async function issue(token, deal) {
  const repo = process.env.GITHUB_REPOSITORY;
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'piratefly-fare-watch-action' };
  const titolo = `Fare deal: ${deal.origine} → ${deal.destinazione}`;
  const aperte = await (await fetch(`${api}/repos/${repo}/issues?state=open&labels=fare-watch&per_page=100`, { headers: h })).json();
  const esiste = Array.isArray(aperte) && aperte.find((i) => i.title === titolo);
  const body = `${deal.riga}\n\n[See the full price history](${deal.url}) · checked ${new Date().toISOString().slice(0, 10)}`;
  const url = esiste ? `${api}/repos/${repo}/issues/${esiste.number}/comments` : `${api}/repos/${repo}/issues`;
  const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(esiste ? { body } : { title: titolo, body, labels: ['fare-watch'] }) });
  if (!r.ok) console.log(`::warning::could not open issue (${r.status}); add "permissions: issues: write" to the job`);
}

async function main() {
  const lista = rotte(input('routes'));
  const soglia = RANGO[input('level', 'buono')] ?? RANGO.buono;
  const chiave = input('api-key');
  if (chiave) console.log(`::add-mask::${chiave}`);
  const righe = [];
  const deals = [];
  let limitato = false;

  for (const rotta of lista) {
    const { status, corpo } = await analizza(rotta, chiave);
    const url = link(rotta.origine, rotta.destinazione);
    if (status === 429) { limitato = true; righe.push(`| ${rotta.origine} → ${rotta.destinazione} | daily free limit reached | | |`); continue; }
    if (status !== 200 || !corpo.verdetto) { righe.push(`| ${rotta.origine} → ${rotta.destinazione} | ${corpo.errore || `HTTP ${status}`} | | |`); continue; }
    const v = corpo.verdetto;
    const prezzo = v.minimoCent != null ? euro(v.minimoCent) : '–';
    const mediana = v.medianaCent != null ? euro(v.medianaCent) : '–';
    const affare = (RANGO[v.livello] ?? 9) <= soglia;
    const nome = NOME[v.livello] || v.livello;
    righe.push(`| [${rotta.origine} → ${rotta.destinazione}](${url}) | ${affare ? '**' + nome + '**' : nome} | ${prezzo} / ${mediana} | ${v.percentile ?? '–'} |`);
    if (affare) {
      const a = corpo.anticipoConsigliato;
      const riga = `**${rotta.origine} → ${rotta.destinazione}** is a *${nome}*: today ${prezzo} vs typical ${mediana} (percentile ${v.percentile} of ${corpo.osservazioni} observed fares).` +
        (a ? ` Best booking window: ${a.daGiorni}–${a.aGiorni} days ahead.` : '');
      deals.push({ ...rotta, livello: v.livello, percentile: v.percentile, minimoCent: v.minimoCent, medianaCent: v.medianaCent, url, riga });
    }
  }

  const md = [
    `## ✈️ PirateFly Fare Watch — ${deals.length} deal${deals.length === 1 ? '' : 's'}`,
    '', '| Route | Verdict | Today / typical | Percentile |', '|---|---|---|---|', ...righe, '',
    ...deals.map((d) => `- ${d.riga} [History](${d.url})`),
    '', limitato
      ? `> Free tier: 30 checks/day. Watching more routes? [Get a Pro key](${SITO}/api?src=gh-action) (POST /v1/pro/checkout) and pass it as \`api-key\`.`
      : `> Data: [PirateFly](${SITO}/?src=gh-action) price history. Higher limits with [Pro](${SITO}/api?src=gh-action).`,
    '',
  ].join('\n');
  scrivi(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);

  if (input('open-issue', 'false') === 'true') {
    for (const d of deals) await issue(input('github-token'), d);
  }
  const out = deals.map(({ riga, ...d }) => d);
  scrivi(process.env.GITHUB_OUTPUT, `deals=${JSON.stringify(out)}\ncount=${deals.length}\n`);
}

main().catch((e) => { console.log(`::error::${e.message}`); process.exitCode = 1; });
