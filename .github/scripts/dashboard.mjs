#!/usr/bin/env node
// Gera assets/dashboard-dark.svg e assets/dashboard-light.svg a partir da API GraphQL do GitHub.
// Zero dependências (Node 20+).
//   GITHUB_TOKEN=... GH_USER=Brunoo47 node .github/scripts/dashboard.mjs
//   FIXTURE=dados.json node .github/scripts/dashboard.mjs   (teste local sem token)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const USERNAME = process.env.GH_USER || "Brunoo47";
const OUT_DIR = process.env.OUT_DIR || "assets";

const QUERY = `query($login: String!) {
  user(login: $login) {
    name
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchData() {
  if (process.env.FIXTURE) return JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não definido");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-dashboard" },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

// ---------- métricas ----------
function compute(user) {
  const cc = user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

  // streaks (o dia de hoje sem contribuição ainda não quebra a streak atual)
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else if (i === days.length - 1) continue;
    else break;
  }

  // contribuições por semana (últimas 52)
  const weeks = cc.contributionCalendar.weeks.slice(-52).map((w) => ({
    start: w.contributionDays[0].date,
    total: w.contributionDays.reduce((s, d) => s + d.contributionCount, 0),
  }));

  // dia da semana
  const weekday = Array(7).fill(0);
  for (const d of days) weekday[new Date(d.date + "T12:00:00Z").getUTCDay()] += d.contributionCount;

  // linguagens (por bytes, todos os repositórios públicos)
  const langMap = new Map();
  for (const r of user.repositories.nodes)
    for (const e of r.languages.edges) {
      const cur = langMap.get(e.node.name) || { name: e.node.name, color: e.node.color || "#8b949e", size: 0 };
      cur.size += e.size;
      langMap.set(e.node.name, cur);
    }
  let langs = [...langMap.values()].sort((a, b) => b.size - a.size);
  const totalBytes = langs.reduce((s, l) => s + l.size, 0) || 1;
  if (langs.length > 5) {
    const rest = langs.slice(5).reduce((s, l) => s + l.size, 0);
    langs = [...langs.slice(0, 5), { name: "Outras", color: "#8b949e", size: rest }];
  }
  langs = langs.map((l) => ({ ...l, pct: (l.size / totalBytes) * 100 }));

  return {
    total: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    prs: cc.totalPullRequestContributions,
    issues: cc.totalIssueContributions,
    reviews: cc.totalPullRequestReviewContributions,
    stars: user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    repos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    current, longest, weeks, weekday, langs,
  };
}

// ---------- render ----------
const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", ink: "#e6edf3", ink2: "#9da7b3", muted: "#6e7681", grid: "#21262d", accent: "#a78bfa", accentSoft: "#4c3a8f", tile: "#161b22" },
  light: { bg: "#ffffff", border: "#d0d7de", ink: "#1f2328", ink2: "#59636e", muted: "#818b98", grid: "#eaeef2", accent: "#6d28d9", accentSoft: "#c4b5fd", tile: "#f6f8fa" },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("pt-BR");
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function render(m, t) {
  const W = 840, H = 470, P = 24;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Dashboard GitHub de ${esc(USERNAME)}</title>`);
  out.push(`<desc id="d">${fmt(m.total)} contribuições no último ano, ${fmt(m.commits)} commits, ${m.prs} pull requests, streak atual de ${m.current} dias, maior streak de ${m.longest} dias.</desc>`);
  out.push(`<style>
    text{font-family:'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:${t.ink}}
    .lbl{font-size:12px;fill:${t.ink2}} .sm{font-size:11px;fill:${t.muted}} .h{font-size:14px;font-weight:600}
    .big{font-size:26px;font-weight:700} .mono{font-family:'Fira Code',Consolas,monospace}
    .bar{transform-box:fill-box;transform-origin:bottom;animation:grow .8s cubic-bezier(.2,.8,.2,1) both}
    .fade{animation:fade .6s ease both}
    .blink{animation:blink 1.1s steps(1) infinite}
    @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
    @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes blink{50%{opacity:0}}
    @media (prefers-reduced-motion: reduce){.bar,.fade,.blink{animation:none}}${process.env.STATIC ? "\n    .bar,.fade,.blink{animation:none!important}" : ""}
  </style>`);
  out.push(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>`);

  // cabeçalho estilo terminal
  out.push(`<circle cx="${P + 6}" cy="22" r="5" fill="#ff5f57"/><circle cx="${P + 22}" cy="22" r="5" fill="#febc2e"/><circle cx="${P + 38}" cy="22" r="5" fill="#28c840"/>`);
  out.push(`<text x="${P + 56}" y="26" class="sm mono">~/${esc(USERNAME)} $ gh dashboard --last-year<tspan class="blink" fill="${t.accent}"> ▋</tspan></text>`);
  const updated = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  out.push(`<text x="${W - P}" y="26" class="sm" text-anchor="end">atualizado em ${updated}</text>`);
  out.push(`<line x1="0" y1="40" x2="${W}" y2="40" stroke="${t.border}"/>`);

  // tiles
  const tiles = [
    ["Contribuições", fmt(m.total), "último ano"],
    ["Commits", fmt(m.commits), "último ano"],
    ["Pull requests", fmt(m.prs), `${m.reviews} reviews`],
    ["Streak atual", `${m.current}d`, `recorde: ${m.longest}d`],
    ["Repositórios", fmt(m.repos), `★ ${m.stars} · ${m.followers} seguidores`],
  ];
  const tw = (W - P * 2 - 12 * 4) / 5, ty = 56, th = 76;
  tiles.forEach(([label, value, sub], i) => {
    const x = P + i * (tw + 12);
    out.push(`<g class="fade" style="animation-delay:${i * 80}ms">`);
    out.push(`<rect x="${x}" y="${ty}" width="${tw}" height="${th}" rx="8" fill="${t.tile}" stroke="${t.border}"/>`);
    out.push(`<text x="${x + 14}" y="${ty + 22}" class="lbl">${label}</text>`);
    out.push(`<text x="${x + 14}" y="${ty + 52}" class="big">${value}</text>`);
    out.push(`<text x="${x + 14}" y="${ty + 68}" class="sm">${esc(sub)}</text>`);
    out.push(`</g>`);
  });

  // contribuições por semana (barras)
  const cx = P, cy = 160, cw = W - P * 2, ch = 130;
  out.push(`<text x="${cx}" y="${cy}" class="h">Contribuições por semana</text>`);
  const plotTop = cy + 18, plotH = ch - 30, base = plotTop + plotH;
  const maxW = Math.max(1, ...m.weeks.map((w) => w.total));
  const niceMax = Math.max(4, Math.ceil(maxW / 4) * 4);
  for (let g = 0; g <= 4; g++) {
    const y = base - (plotH * g) / 4;
    out.push(`<line x1="${cx + 28}" y1="${y}" x2="${cx + cw}" y2="${y}" stroke="${t.grid}"/>`);
    out.push(`<text x="${cx + 20}" y="${y + 4}" class="sm" text-anchor="end">${(niceMax * g) / 4}</text>`);
  }
  const slot = (cw - 32) / m.weeks.length, bw = Math.max(2, slot - 2);
  let lastMonth = -1;
  m.weeks.forEach((w, i) => {
    const x = cx + 32 + i * slot;
    const h = (w.total / niceMax) * plotH;
    const peak = w.total === maxW && maxW > 0;
    if (h > 0) {
      const r = Math.min(3, h / 2, bw / 2);
      const y = base - h;
      out.push(`<path class="bar" style="animation-delay:${i * 12}ms" fill="${peak ? t.accent : t.accentSoft}" d="M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z"><title>Semana de ${w.start}: ${w.total}</title></path>`);
    }
    if (peak) out.push(`<text x="${x + bw / 2}" y="${base - h - 6}" class="sm" text-anchor="middle" style="fill:${t.ink}">${w.total}</text>`);
    const mo = new Date(w.start + "T12:00:00Z").getUTCMonth();
    if (mo !== lastMonth) { if (lastMonth !== -1) out.push(`<text x="${x}" y="${base + 16}" class="sm">${MONTHS[mo]}</text>`); lastMonth = mo; }
  });

  // linguagens
  const ly = 318;
  out.push(`<text x="${P}" y="${ly}" class="h">Linguagens</text>`);
  const lw = 470, lbarY = ly + 14;
  let lx = P;
  m.langs.forEach((l, i) => {
    const w = (l.pct / 100) * lw;
    const segW = Math.max(0, w - (i < m.langs.length - 1 ? 2 : 0));
    out.push(`<rect x="${lx}" y="${lbarY}" width="${segW}" height="10" rx="${i === 0 || i === m.langs.length - 1 ? 3 : 0}" fill="${l.color}"><title>${esc(l.name)} ${l.pct.toFixed(1)}%</title></rect>`);
    lx += w;
  });
  m.langs.forEach((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = P + col * 240, y = lbarY + 40 + row * 24;
    out.push(`<g class="fade" style="animation-delay:${300 + i * 60}ms"><circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>`);
    out.push(`<text x="${x + 16}" y="${y}" class="lbl" style="fill:${t.ink}">${esc(l.name)}</text>`);
    out.push(`<text x="${x + 200}" y="${y}" class="lbl" text-anchor="end">${l.pct.toFixed(1)}%</text></g>`);
  });

  // dia da semana
  const dx = 540, dw = W - P - dx;
  out.push(`<text x="${dx}" y="${ly}" class="h">Dia mais produtivo</text>`);
  const maxD = Math.max(1, ...m.weekday);
  const best = m.weekday.indexOf(maxD);
  const dTop = ly + 16, dH = 92, dBase = dTop + dH, dSlot = dw / 7, dBw = dSlot - 10;
  m.weekday.forEach((v, i) => {
    const x = dx + i * dSlot + 5, h = (v / maxD) * (dH - 16);
    if (h > 0) {
      const r = Math.min(3, h / 2), y = dBase - h;
      out.push(`<path class="bar" style="animation-delay:${400 + i * 50}ms" fill="${i === best ? t.accent : t.accentSoft}" d="M${x},${dBase} V${y + r} Q${x},${y} ${x + r},${y} H${x + dBw - r} Q${x + dBw},${y} ${x + dBw},${y + r} V${dBase} Z"><title>${WEEKDAYS[i]}: ${v}</title></path>`);
    }
    out.push(`<text x="${x + dBw / 2}" y="${dBase + 16}" class="sm" text-anchor="middle"${i === best ? ` style="fill:${t.ink};font-weight:600"` : ""}>${WEEKDAYS[i]}</text>`);
  });
  out.push(`<line x1="${dx}" y1="${dBase}" x2="${dx + dw}" y2="${dBase}" stroke="${t.border}"/>`);

  out.push(`</svg>`);
  return out.join("\n");
}

const user = await fetchData();
const metrics = compute(user);
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) writeFileSync(`${OUT_DIR}/dashboard-${name}.svg`, render(metrics, theme));
console.log("dashboard gerado:", JSON.stringify({ ...metrics, weeks: metrics.weeks.length }));
