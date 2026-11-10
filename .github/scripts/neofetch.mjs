// Card estilo `neofetch`: ASCII colorido do avatar + infos e stats ao vivo.
import { readFileSync } from "node:fs";

const AVATAR = JSON.parse(readFileSync(new URL("../data/avatar.json", import.meta.url), "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("pt-BR");

// --- cor: garante contraste do ASCII contra o fundo do tema ---
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function legible(color, bg, ink) {
  let c = hex2rgb(color); const B = hex2rgb(bg), I = hex2rgb(ink);
  for (let t = 0; contrast(c, B) < 3 && t < 1; t += 0.05) c = c.map((v, i) => v + (I[i] - v) * 0.08);
  return rgb2hex(c);
}

function since(dateIso) {
  const a = new Date(dateIso), b = new Date();
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  const p = (n, s, pl) => `${n} ${n === 1 ? s : pl}`;
  return `${p(y, "ano", "anos")}, ${p(m, "mês", "meses")}, ${p(d, "dia", "dias")}`;
}

export function renderNeofetch(profile, m, t, { animate = true } = {}) {
  const W = 840, P = 28, FS = 10, LH = 12.6, CW = 6.02;
  const artH = AVATAR.rows.length * LH;
  const lines = [
    ["title", `${profile.login.toLowerCase()}@github`],
    ["rule"],
    ["kv", "OS", "Linux"],
    ["kv", "Uptime", `${since(profile.createdAt)} (no GitHub)`],
    ["kv", "Host", "Ultra Lims · Joinville - SC"],
    ["kv", "Kernel", "PHP · Slim"],
    ["kv", "IDE", "IntelliJ IDEA · VS Code"],
    ["gap"],
    ["kv", "Languages.Code", "PHP · Java · TS · JS · Python"],
    ["kv", "Languages.Web", "Slim · Spring Boot · Next.js · Django"],
    ["kv", "Languages.Data", "MySQL · PostgreSQL"],
    ["kv", "DevOps", "Docker · AWS · Git · Linux"],
    ["gap"],
    ["head", "Contato"],
    ["kv", "Email", "brunoostroskiprogramador@gmail.com"],
    ["kv", "Orgs", "@ultralims · @NexusGen-Projetos"],
    ["gap"],
    ["head", "GitHub Stats"],
    ["pair", ["Repos", fmt(m.repos)], ["Stars", fmt(m.stars)]],
    ["pair", ["Commits", fmt(m.commitsAllTime)], ["Seguidores", fmt(m.followers)]],
    ["pair", ["Contribuições", fmt(m.total)], ["Streak", `${m.current}d`]],
    ["gap"],
    ["blocks"],
  ];
  const IX = P + AVATAR.cols * CW + 36, ILH = 19.5;
  const H = Math.max(artH + P * 2 + 34, lines.length * ILH + P * 2 + 34);
  const valueX = IX + 150, maxX = W - P;

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(H)}" viewBox="0 0 ${W} ${Math.round(H)}" role="img" aria-labelledby="nt nd">`);
  o.push(`<title id="nt">neofetch de ${esc(profile.login)}</title><desc id="nd">Card estilo neofetch com ASCII do avatar, stack e estatísticas do GitHub.</desc>`);
  o.push(`<style>
    text{font-family:'JetBrains Mono','Fira Code',Consolas,'Liberation Mono',monospace;font-size:14px;fill:${t.ink};white-space:pre}
    .a{font-size:${FS}px;font-weight:700} .k{fill:${t.accent}} .d{fill:${t.muted}} .v{fill:${t.ink}} .tt{font-weight:700;fill:${t.accent}}
    .ln{opacity:${animate ? 0 : 1};animation:in .25s ease forwards} .ar{opacity:${animate ? 0 : 1};animation:in .5s ease forwards}
    .cur{animation:bl 1s steps(1) infinite}
    @keyframes in{to{opacity:1}} @keyframes bl{50%{opacity:0}}
    @media (prefers-reduced-motion: reduce){.ln,.ar{opacity:1;animation:none}.cur{animation:none}}
  </style>`);
  o.push(`<rect x=".5" y=".5" width="${W - 1}" height="${Math.round(H) - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>`);
  o.push(`<circle cx="${P}" cy="20" r="5" fill="#ff5f57"/><circle cx="${P + 16}" cy="20" r="5" fill="#febc2e"/><circle cx="${P + 32}" cy="20" r="5" fill="#28c840"/>`);
  o.push(`<text x="${W / 2}" y="24" text-anchor="middle" class="d" style="font-size:12px">${esc(profile.login.toLowerCase())}@github: ~ — neofetch</text>`);

  // ASCII
  const top = 34 + P + Math.max(0, (lines.length * ILH - artH) / 2);
  AVATAR.rows.forEach((row, y) => {
    let spans = "", run = "", runColor = null;
    const flush = () => { if (run) spans += runColor ? `<tspan fill="${legible(runColor, t.bg, t.ink)}">${esc(run)}</tspan>` : run; run = ""; };
    for (const [ch, c] of row) { if (c !== runColor) { flush(); runColor = c; } run += ch; }
    flush();
    o.push(`<text class="a ar" x="${P}" y="${(top + y * LH).toFixed(1)}" style="animation-delay:${y * 25}ms">${spans}</text>`);
  });

  // infos
  const y0 = 34 + P + 10;
  const dots = (key, x0) => { const n = Math.max(2, Math.floor((valueX - 10 - x0 - key.length * 8.4) / 8.4)); return " " + ".".repeat(n) + " "; };
  lines.forEach((l, i) => {
    const y = y0 + i * ILH, delay = `animation-delay:${600 + i * 70}ms`;
    let body = "";
    if (l[0] === "title") body = `<tspan class="tt">${esc(l[1])}</tspan>`;
    else if (l[0] === "rule") body = `<tspan class="d">${"─".repeat(Math.floor((maxX - IX) / 8.4))}</tspan>`;
    else if (l[0] === "head") body = `<tspan class="d">- </tspan><tspan class="tt">${esc(l[1])}</tspan><tspan class="d"> ${"─".repeat(Math.floor((maxX - IX) / 8.4) - l[1].length - 3)}</tspan>`;
    else if (l[0] === "kv") body = `<tspan class="k">${esc(l[1])}:</tspan><tspan class="d">${dots(l[1] + ":", IX)}</tspan><tspan class="v">${esc(l[2])}</tspan>`;
    else if (l[0] === "pair") {
      const [[k1, v1], [k2, v2]] = [l[1], l[2]];
      const pad = Math.max(1, 20 - (k1.length + v1.length + 2));
      body = `<tspan class="k">${k1}:</tspan> <tspan class="v">${esc(v1)}</tspan><tspan class="d"> ${"·".repeat(pad)} </tspan><tspan class="k">${k2}:</tspan> <tspan class="v">${esc(v2)}</tspan>`;
    } else if (l[0] === "blocks") {
      const cols = ["#484f58", "#f85149", "#3fb950", "#d29922", "#58a6ff", "#a78bfa", "#39c5cf", "#e6edf3"];
      cols.forEach((c, j) => o.push(`<rect class="ln" style="${delay}" x="${IX + j * 26}" y="${y - 13}" width="24" height="16" rx="2" fill="${c}"/>`));
      o.push(`<text class="ln cur" style="${delay}" x="${IX + cols.length * 26 + 10}" y="${y}" fill="${t.accent}">▋</text>`);
      return;
    } else return;
    o.push(`<text class="ln" style="${delay}" x="${IX}" y="${y}">${body}</text>`);
  });
  o.push(`</svg>`);
  return o.join("\n");
}
