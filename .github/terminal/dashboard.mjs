// Dashboard de atividade (públicos + privados).
// Dos repositórios privados só saem AGREGADOS: contagens, dias e horários de commit.
// Nomes de repositórios privados, mensagens de commit e código nunca são gravados nem renderizados.
//
// Para enxergar os privados, o workflow precisa do secret METRICS_TOKEN (PAT com escopos repo + read:org).
// Sem ele, o dashboard mostra o que é público + o total de contribuições privadas (se o perfil permitir).

const TZ_OFFSET = -3; // America/Sao_Paulo (sem horário de verão desde 2019)

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-dashboard" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

export async function fetchActivity(token, login) {
  const to = new Date(), from = new Date(to); from.setUTCFullYear(from.getUTCFullYear() - 1);
  const { user } = await gql(token, `query($l:String!,$from:DateTime!,$to:DateTime!){ user(login:$l){ id
    contributionsCollection(from:$from,to:$to){
      totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions
      restrictedContributionsCount totalRepositoriesWithContributedCommits
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
      commitContributionsByRepository(maxRepositories:25){
        repository{ name isPrivate owner{ login } primaryLanguage{ name color } }
        contributions{ totalCount } } } } }`, { l: login, from: from.toISOString(), to: to.toISOString() });

  const cc = user.contributionsCollection;
  const byRepo = cc.commitContributionsByRepository;
  const privateSeen = byRepo.some((r) => r.repository.isPrivate);

  // horário dos commits (punch card): histórico do branch padrão dos 12 repos mais ativos
  const punch = Array.from({ length: 7 }, () => Array(24).fill(0));
  const top = byRepo.slice(0, 12);
  if (top.length) {
    const parts = top.map((r, i) => `r${i}: repository(owner:"${r.repository.owner.login}", name:"${r.repository.name}"){ defaultBranchRef{ target{ ... on Commit{
      history(first:100, author:{id:"${user.id}"}, since:"${from.toISOString()}"){ nodes{ committedDate } } } } } }`);
    try {
      const repos = await gql(token, `query{ ${parts.join("\n")} }`, {});
      for (const r of Object.values(repos)) for (const n of r?.defaultBranchRef?.target?.history?.nodes || []) {
        const d = new Date(new Date(n.committedDate).getTime() + TZ_OFFSET * 3600e3);
        punch[d.getUTCDay()][d.getUTCHours()]++;
      }
    } catch (e) { console.warn("punch card indisponível:", e.message.slice(0, 200)); }
  }

  // ranking: privados são anonimizados aqui, antes de qualquer coisa ser gravada
  let privN = 0;
  const repos = byRepo.slice(0, 7).map((r) => {
    const R = r.repository;
    const owner = R.owner.login === login ? null : R.owner.login;
    return {
      label: R.isPrivate ? `🔒 ${owner ? owner + "/" : ""}privado #${++privN}` : `${owner ? owner + "/" : ""}${R.name}`,
      private: R.isPrivate, commits: r.contributions.totalCount,
      lang: R.primaryLanguage?.name || null, color: R.primaryLanguage?.color || "#8b949e",
    };
  });

  // contribuições privadas que o token não detalha (perfil com "Private contributions" ligado): entram como um bloco só
  if (cc.restrictedContributionsCount > 0)
    repos.push({ label: "🔒 ultralims · privados", private: true, commits: cc.restrictedContributionsCount, lang: null, color: "#8b949e" });
  repos.sort((x, y) => y.commits - x.commits);
  const privCommits = byRepo.filter((r) => r.repository.isPrivate).reduce((s, r) => s + r.contributions.totalCount, 0);
  console.log(`atividade: total=${cc.contributionCalendar.totalContributions} commits=${cc.totalCommitContributions} restritas=${cc.restrictedContributionsCount} repos_privados_visiveis=${byRepo.filter((r) => r.repository.isPrivate).length}`);
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  return {
    full: privateSeen || cc.restrictedContributionsCount > 0,
    tokenSeesPrivate: privateSeen,
    total: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    privateCommits: privCommits + cc.restrictedContributionsCount,
    prs: cc.totalPullRequestContributions, reviews: cc.totalPullRequestReviewContributions, issues: cc.totalIssueContributions,
    reposTouched: cc.totalRepositoriesWithContributedCommits,
    activeDays: days.filter((d) => d.contributionCount > 0).length,
    calendar: cc.contributionCalendar.weeks.map((w) => w.contributionDays.map((d) => [d.date, d.contributionCount])),
    punch, repos,
  };
}

// ════════════════════════════ render ════════════════════════════
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => Number(n).toLocaleString("pt-BR");
const T = { bg1: "#0f1320", bg2: "#0a0d14", bar: "#161b22", border: "#30363d", tile: "#121725", ink: "#e6edf3", ink2: "#9da7b3", muted: "#6e7681", grid: "#1c2230",
  pub: "#56d4dd", priv: "#a78bfa", ramp: ["#161b22", "#2e1f5e", "#4c3a8f", "#7c5cd6", "#a78bfa", "#ddd6fe"] };
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function renderDashboard(a, updatedAt) {
  const W = 824, P = 22, o = [];
  const H = 590;
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="dt dd">`);
  o.push(`<title id="dt">Dashboard de atividade</title><desc id="dd">${fmt(a.total)} contribuições em 12 meses, ${fmt(a.commits)} commits (${fmt(a.privateCommits)} em repositórios privados), ${a.prs} pull requests, ${a.activeDays} dias ativos.</desc>`);
  o.push(`<defs><linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg1}"/><stop offset="1" stop-color="${T.bg2}"/></linearGradient></defs>`);
  o.push(`<style>
    text{font-family:'JetBrains Mono','Fira Code','DejaVu Sans Mono',Menlo,Consolas,monospace;fill:${T.ink}}
    .s{font-size:11px;fill:${T.muted}} .l{font-size:12px;fill:${T.ink2}} .h{font-size:13px;font-weight:700;fill:${T.ink}}
    .big{font-size:24px;font-weight:700} .k{fill:${T.priv}}
    .in{opacity:0;animation:in .5s ease forwards} @keyframes in{to{opacity:1}}
    @media (prefers-reduced-motion: reduce){.in{opacity:1;animation:none}}
  </style>`);
  o.push(`<rect width="${W}" height="${H}" rx="12" fill="url(#dbg)"/><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${T.border}"/>`);
  o.push(`<rect x="1" y="1" width="${W - 2}" height="34" rx="11" fill="${T.bar}"/><rect x="1" y="24" width="${W - 2}" height="11" fill="${T.bar}"/><line x1="0" y1="35" x2="${W}" y2="35" stroke="${T.border}"/>`);
  o.push(`<circle cx="22" cy="18" r="6" fill="#ff5f57"/><circle cx="42" cy="18" r="6" fill="#febc2e"/><circle cx="62" cy="18" r="6" fill="#28c840"/>`);
  o.push(`<text x="84" y="22" class="s" style="font-size:12px">dashboard — últimos 12 meses${a.full ? " · públicos + privados" : " · públicos"}</text>`);

  // ── tiles
  const pctPriv = a.commits ? Math.round((a.privateCommits / a.commits) * 100) : 0;
  const flat = a.calendar.flat(), year = new Date(updatedAt).getUTCFullYear();
  const yearSum = flat.filter(([d]) => d.startsWith(String(year))).reduce((s, [, c]) => s + c, 0);
  let longest = 0, run = 0, current = 0;
  for (const [, c] of flat) { run = c ? run + 1 : 0; longest = Math.max(longest, run); }
  for (let i = flat.length - 1; i >= 0; i--) { if (flat[i][1]) current++; else if (i === flat.length - 1) continue; else break; }
  const tiles = [
    ["contribuições", fmt(a.total), `${fmt(yearSum)} em ${year} · ${a.activeDays} dias`],
    ["commits", fmt(a.commits), a.full ? `${pctPriv}% em privados` : "só públicos"],
    a.tokenSeesPrivate ? ["repositórios", fmt(a.reposTouched), "com commits"] : ["maior streak", `${longest}d`, `atual: ${current}d seguidos`],
    ["pull requests", fmt(a.prs), `${fmt(a.reviews)} reviews`],
  ];
  const tw = (W - P * 2 - 12 * 3) / 4;
  tiles.forEach(([k, v, sub], i) => {
    const x = P + i * (tw + 12), y = 50;
    o.push(`<g class="in" style="animation-delay:${i * 90}ms"><rect x="${x}" y="${y}" width="${tw}" height="72" rx="8" fill="${T.tile}" stroke="${T.border}"/>`);
    o.push(`<text x="${x + 14}" y="${y + 20}" class="l">${k}</text><text x="${x + 14}" y="${y + 48}" class="big">${v}</text><text x="${x + 14}" y="${y + 64}" class="s">${esc(sub)}</text></g>`);
  });
  // barra público × privado
  if (a.full && a.commits) {
    const bx = P, by = 134, bw = W - P * 2, pw = Math.round((a.privateCommits / a.commits) * bw);
    o.push(`<rect x="${bx}" y="${by}" width="${Math.max(0, bw - pw - 2)}" height="6" rx="3" fill="${T.pub}"/>`);
    o.push(`<rect x="${bx + bw - pw}" y="${by}" width="${pw}" height="6" rx="3" fill="${T.priv}"/>`);
    o.push(`<text x="${bx}" y="${by + 20}" class="s"><tspan fill="${T.pub}">■</tspan> públicos ${fmt(a.commits - a.privateCommits)}   <tspan fill="${T.priv}">■</tspan> privados ${fmt(a.privateCommits)}</text>`);
  }

  // ── heatmap anual
  const hy = 178, cs = 11, gap = 3, hx = P + 30;
  o.push(`<text x="${P}" y="${hy}" class="h">Contribuições por dia</text>`);
  const all = a.calendar.flat().map(([, c]) => c).filter((c) => c > 0).sort((x, y) => x - y);
  const q = (p) => all.length ? all[Math.min(all.length - 1, Math.floor(p * all.length))] : 1;
  const th = [q(0.25), q(0.5), q(0.75), q(0.93)];
  const level = (c) => (c <= 0 ? 0 : c <= th[0] ? 1 : c <= th[1] ? 2 : c <= th[2] ? 3 : c <= th[3] ? 4 : 5);
  let lastM = -1;
  a.calendar.forEach((week, wi) => {
    week.forEach(([date, c]) => {
      const wd = new Date(date + "T12:00:00Z").getUTCDay();
      o.push(`<rect x="${hx + wi * (cs + gap)}" y="${hy + 20 + wd * (cs + gap)}" width="${cs}" height="${cs}" rx="2" fill="${T.ramp[level(c)]}"><title>${date}: ${c}</title></rect>`);
    });
    const m = new Date(week[0][0] + "T12:00:00Z").getUTCMonth();
    if (m !== lastM) { if (lastM !== -1 && wi < a.calendar.length - 2) o.push(`<text x="${hx + wi * (cs + gap)}" y="${hy + 14}" class="s">${MONTHS[m]}</text>`); lastM = m; }
  });
  [1, 3, 5].forEach((d) => o.push(`<text x="${P}" y="${hy + 20 + d * (cs + gap) + 9}" class="s">${WD[d]}</text>`));
  const ly = hy + 20 + 7 * (cs + gap) + 12;
  const sx = W - P - 36 - 6 * (cs + 3);
  o.push(`<text x="${sx - 6}" y="${ly + 9}" class="s" text-anchor="end">menos</text>`);
  T.ramp.forEach((c, i) => o.push(`<rect x="${sx + i * (cs + 3)}" y="${ly}" width="${cs}" height="${cs}" rx="2" fill="${c}"/>`));
  o.push(`<text x="${sx + 6 * (cs + 3) + 4}" y="${ly + 9}" class="s">mais</text>`);

  // ── sem token, não há horários dos commits privados: mostra contribuições por mês (inclui privados)
  if (!a.tokenSeesPrivate) {
    const my = 330;
    o.push(`<text x="${P}" y="${my}" class="h">Ritmo</text><text x="${P + 52}" y="${my}" class="s">contribuições por mês</text>`);
    const months = new Map();
    for (const [d, c] of flat) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) || 0) + c);
    const keys = [...months.keys()].slice(-12), vals = keys.map((k) => months.get(k));
    const mmax = Math.max(1, ...vals), ph = 140, base = my + 24 + ph, slot = 396 / keys.length, bw = slot - 8;
    const peak = vals.indexOf(Math.max(...vals));
    for (let g = 0; g <= 2; g++) o.push(`<line x1="${P}" y1="${base - (ph * g) / 2}" x2="${P + 396}" y2="${base - (ph * g) / 2}" stroke="${T.grid}"/>`);
    keys.forEach((k, i) => {
      const h = (vals[i] / mmax) * ph, x = P + i * slot + 4, y = base - h, r = Math.min(3, h / 2);
      if (h > 0) o.push(`<path class="in" style="animation-delay:${200 + i * 40}ms" fill="${i === peak ? T.ramp[5] : T.priv}" opacity="${i === peak ? 1 : 0.75}" d="M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z"/>`);
      o.push(`<text x="${x + bw / 2}" y="${base + 14}" class="s" text-anchor="middle">${MONTHS[Number(k.slice(5)) - 1]}</text>`);
      if (i === peak) o.push(`<text x="${x + bw / 2}" y="${y - 5}" class="s" text-anchor="middle" style="fill:${T.ink}">${vals[i]}</text>`);
    });
    const best = flat.reduce((b, x) => (x[1] > b[1] ? x : b), ["", 0]);
    o.push(`<text x="${P}" y="${base + 38}" class="l">recorde: <tspan fill="${T.ink}" font-weight="700">${best[1]} em ${new Date(best[0] + "T12:00:00Z").toLocaleDateString("pt-BR")}</tspan></text>`);
  } else {
  // ── punch card (dia × hora)
  const py = 330, pcx = P + 30, pw2 = 15;
  o.push(`<text x="${P}" y="${py}" class="h">Quando eu codo</text><text x="${P + 128}" y="${py}" class="s">commits por dia da semana × hora (BRT)</text>`);
  const pmax = Math.max(1, ...a.punch.flat());
  let best = [0, 0];
  a.punch.forEach((row, d) => row.forEach((v, h) => { if (v > a.punch[best[0]][best[1]]) best = [d, h]; }));
  a.punch.forEach((row, d) => {
    o.push(`<text x="${P}" y="${py + 26 + d * 22}" class="s">${WD[d]}</text>`);
    row.forEach((v, h) => {
      const cx = pcx + h * pw2 + 7, cy = py + 22 + d * 22;
      o.push(`<circle cx="${cx}" cy="${cy}" r="${v ? 2 + (v / pmax) * 5.5 : 1.2}" fill="${v ? (d === best[0] && h === best[1] ? T.ramp[5] : T.priv) : T.grid}" opacity="${v ? 0.35 + (v / pmax) * 0.65 : 1}"/>`);
    });
  });
  [0, 6, 12, 18, 23].forEach((h) => o.push(`<text x="${pcx + h * pw2 + 7}" y="${py + 22 + 7 * 22}" class="s" text-anchor="middle">${h}h</text>`));
  if (a.punch.flat().some(Boolean)) o.push(`<text x="${P}" y="${py + 22 + 7 * 22 + 22}" class="l">pico: <tspan fill="${T.ink}" font-weight="700">${WD[best[0]]} às ${best[1]}h</tspan></text>`);

  }

  // ── onde (ranking de repos)
  const rx = 440, ry = 330, rw = W - P - rx;
  o.push(`<text x="${rx}" y="${ry}" class="h">Onde</text><text x="${rx + 44}" y="${ry}" class="s">commits por repositório</text>`);
  const rmax = Math.max(1, ...a.repos.map((r) => r.commits));
  a.repos.forEach((r, i) => {
    const y = ry + 22 + i * 25, bw = Math.max(3, (r.commits / rmax) * (rw - 46));
    o.push(`<g class="in" style="animation-delay:${300 + i * 60}ms">`);
    o.push(`<text x="${rx}" y="${y + 4}" class="l" style="fill:${T.ink}">${esc(r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label)}</text>`);
    o.push(`<rect x="${rx}" y="${y + 9}" width="${bw}" height="6" rx="3" fill="${r.private ? T.priv : T.pub}"/>`);
    o.push(`<text x="${rx + bw + 6}" y="${y + 16}" class="s">${fmt(r.commits)}</text></g>`);
  });
  if (!a.repos.length) o.push(`<text x="${rx}" y="${ry + 26}" class="s">sem commits no período</text>`);

  // rodapé
  const note = a.tokenSeesPrivate ? "🔒 privados aparecem anonimizados: só contagens e horários, nunca nomes, mensagens ou código."
    : a.full ? "🔒 privados entram só como números — nenhum nome, mensagem ou código sai dos repositórios."
    : "só atividade pública. Para incluir os privados, configure o secret METRICS_TOKEN.";
  o.push(`<line x1="${P}" y1="${H - 38}" x2="${W - P}" y2="${H - 38}" stroke="${T.border}"/>`);
  o.push(`<text x="${P}" y="${H - 16}" class="s">${esc(note)}</text>`);
  o.push(`<text x="${W - P}" y="22" class="s" text-anchor="end">atualizado ${new Date(updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</text>`);
  o.push(`</svg>`);
  return o.join("\n");
}
