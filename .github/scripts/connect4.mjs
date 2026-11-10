#!/usr/bin/env node
// 4 em Linha comunitário: visitantes (🟣) contra uma IA minimax (🟡), jogado via issues.
//   node connect4.mjs process   -> processa issues abertas "4emlinha|jogar|N" (GitHub Actions)
//   node connect4.mjs render    -> só regenera SVG + seção do README
//   node connect4.mjs local 4   -> joga localmente na coluna 4 como @local (teste)
// Zero dependências (Node 20+).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROWS = 6, COLS = 7, HUMAN = 1, AI = 2;
const REPO = process.env.GITHUB_REPOSITORY || "Brunoo47/Brunoo47";
const OWNER = REPO.split("/")[0];
const STATE_FILE = process.env.STATE_FILE || "game/state.json";
const README = process.env.README || "README.md";
const OUT_DIR = process.env.OUT_DIR || "assets";
const DEPTH = Number(process.env.AI_DEPTH || 6);
const TITLE_RE = /^4emlinha\|jogar\|([1-7])$/;

// ---------------- estado ----------------
const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const freshGame = (id) => ({ id, board: emptyBoard(), status: "playing", winner: null, line: null, moves: [], startedAt: new Date().toISOString() });

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { game: freshGame(1), score: { humans: 0, ai: 0, draws: 0 }, players: {}, hallOfFame: [], recent: [] };
}
const saveState = (s) => { mkdirSync(STATE_FILE.split("/").slice(0, -1).join("/") || ".", { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n"); };

// ---------------- regras ----------------
const validCols = (b) => [...Array(COLS).keys()].filter((c) => b[0][c] === 0);
function drop(b, c, p) { for (let r = ROWS - 1; r >= 0; r--) if (b[r][c] === 0) { b[r][c] = p; return r; } return -1; }
function undo(b, c) { for (let r = 0; r < ROWS; r++) if (b[r][c] !== 0) { b[r][c] = 0; return; } }
function winLine(b, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of dirs) {
    const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
    if (cells.every(([y, x]) => y >= 0 && y < ROWS && x >= 0 && x < COLS && b[y][x] === p)) return cells;
  }
  return null;
}
const full = (b) => validCols(b).length === 0;

// ---------------- IA (negamax + poda alfa-beta) ----------------
function scoreWindow(w, p) {
  const o = p === AI ? HUMAN : AI;
  const mine = w.filter((v) => v === p).length, theirs = w.filter((v) => v === o).length, empty = 4 - mine - theirs;
  if (mine === 4) return 1000;
  if (mine === 3 && empty === 1) return 6;
  if (mine === 2 && empty === 2) return 2;
  if (theirs === 3 && empty === 1) return -5;
  return 0;
}
function evaluate(b, p) {
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (b[r][3] === p) s += 3;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of dirs) {
    const er = r + dr * 3, ec = c + dc * 3;
    if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
    s += scoreWindow([0, 1, 2, 3].map((k) => b[r + dr * k][c + dc * k]), p);
  }
  return s;
}
const ORDER = [3, 2, 4, 1, 5, 0, 6];
function negamax(b, depth, alpha, beta, p) {
  const o = p === AI ? HUMAN : AI;
  if (winLine(b, o)) return -100000 - depth;
  if (full(b)) return 0;
  if (depth === 0) return evaluate(b, p) - evaluate(b, o);
  let best = -Infinity;
  for (const c of ORDER) {
    if (b[0][c] !== 0) continue;
    drop(b, c, p);
    const v = -negamax(b, depth - 1, -beta, -alpha, o);
    undo(b, c);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}
function aiMove(board) {
  const b = board.map((r) => [...r]);
  let best = -Infinity, choices = [];
  for (const c of ORDER) {
    if (b[0][c] !== 0) continue;
    drop(b, c, AI);
    const v = winLine(b, AI) ? 1e9 : -negamax(b, DEPTH - 1, -Infinity, Infinity, HUMAN);
    undo(b, c);
    if (v > best) { best = v; choices = [c]; } else if (v === best) choices.push(c);
  }
  return choices[Math.floor(Math.random() * choices.length)];
}

// ---------------- jogada ----------------
function play(state, user, col, issue) {
  if (state.game.status !== "playing") state.game = freshGame(state.game.id + 1);
  const g = state.game;
  if (g.board[0][col] !== 0) return { ok: false, msg: `A coluna ${col + 1} está cheia. Escolhe outra lá no [perfil](https://github.com/${OWNER}#-4-em-linha).` };

  const now = new Date().toISOString();
  const p = (state.players[user] ||= { moves: 0, wins: 0 });
  p.moves++;
  const hr = drop(g.board, col, HUMAN);
  g.moves.push({ by: user, who: HUMAN, col, row: hr, issue, at: now });
  const move = { user, col: col + 1, ai: null, issue, at: now, result: null };

  let line = winLine(g.board, HUMAN);
  if (line) {
    Object.assign(g, { status: "over", winner: "humans", line, endedAt: now });
    state.score.humans++; p.wins++;
    state.hallOfFame.unshift({ user, game: g.id, at: now, moves: g.moves.length });
    move.result = "humans";
  } else if (full(g.board)) {
    Object.assign(g, { status: "over", winner: "draw", endedAt: now }); state.score.draws++; move.result = "draw";
  } else {
    const ac = aiMove(g.board);
    const ar = drop(g.board, ac, AI);
    g.moves.push({ by: "ia", who: AI, col: ac, row: ar, at: now });
    move.ai = ac + 1;
    line = winLine(g.board, AI);
    if (line) { Object.assign(g, { status: "over", winner: "ai", line, endedAt: now }); state.score.ai++; move.result = "ai"; }
    else if (full(g.board)) { Object.assign(g, { status: "over", winner: "draw", endedAt: now }); state.score.draws++; move.result = "draw"; }
  }
  state.recent = [move, ...state.recent].slice(0, 6);

  const back = `[Voltar pro perfil](https://github.com/${OWNER}#-4-em-linha)`;
  let msg = `✅ @${user} jogou na coluna **${col + 1}**.`;
  if (move.ai) msg += ` 🤖 A IA respondeu na coluna **${move.ai}**.`;
  if (move.result === "humans") msg = `🏆 **@${user} VENCEU A IA!** Jogada final na coluna ${col + 1} — seu nome está no Hall da Fama.`;
  if (move.result === "ai") msg += `\n\n💀 E com isso a IA venceu a partida #${g.id}. A próxima já está liberada — revanche?`;
  if (move.result === "draw") msg += `\n\n🤝 Tabuleiro cheio: empate na partida #${g.id}.`;
  return { ok: true, msg: `${msg}\n\n${back}` };
}

// ---------------- render SVG ----------------
const THEMES = {
  dark: { bg: "#0d1117", border: "#30363d", board: "#1b1f3b", hole: "#0d1117", ink: "#e6edf3", muted: "#8b949e", human: "#a78bfa", ai: "#fbbf24", ring: "#ffffff" },
  light: { bg: "#ffffff", border: "#d0d7de", board: "#312e81", hole: "#f6f8fa", ink: "#1f2328", muted: "#59636e", human: "#8b5cf6", ai: "#f59e0b", ring: "#ffffff" },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderBoard(state, t) {
  const g = state.game, S = 60, PAD = 14, W = 840, BW = COLS * S + PAD * 2, BH = ROWS * S + PAD * 2;
  const bx = (W - BW) / 2, by = 64, H = by + BH + 44;
  const last = g.moves.slice(-2);
  const lastKey = new Set(last.map((m) => `${m.row},${m.col}`));
  const winKey = new Set((g.line || []).map(([r, c]) => `${r},${c}`));
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tabuleiro do 4 em Linha, partida ${g.id}">`);
  o.push(`<style>
    text{font-family:'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif;fill:${t.ink}}
    .m{fill:${t.muted};font-size:13px} .t{font-size:18px;font-weight:700}
    .drop{animation:drop .7s cubic-bezier(.3,1.4,.5,1) both}
    .pulse{animation:pulse 1.4s ease-in-out infinite}
    @keyframes drop{from{transform:translateY(-${by + BH}px)}to{transform:none}}
    @keyframes pulse{50%{opacity:.35}}
    @media (prefers-reduced-motion: reduce){.drop,.pulse{animation:none}}
  </style>`);
  o.push(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>`);

  const status = g.status === "playing"
    ? `Partida #${g.id} · sua vez 🟣`
    : g.winner === "humans" ? `Partida #${g.id} · 🏆 os visitantes venceram!`
    : g.winner === "ai" ? `Partida #${g.id} · 🤖 a IA venceu` : `Partida #${g.id} · 🤝 empate`;
  o.push(`<text x="${W / 2}" y="34" text-anchor="middle" class="t">${esc(status)}</text>`);
  o.push(`<text x="${W / 2}" y="54" text-anchor="middle" class="m">Visitantes ${state.score.humans} × ${state.score.ai} IA · ${state.score.draws} empates · ${g.moves.length} jogadas nesta partida</text>`);

  // peças (atrás do tabuleiro, para o efeito de cair "dentro" dele)
  const clipId = "holes";
  o.push(`<defs><mask id="${clipId}"><rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="16" fill="#fff"/>`);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) o.push(`<circle cx="${bx + PAD + c * S + S / 2}" cy="${by + PAD + r * S + S / 2}" r="${S / 2 - 6}" fill="#000"/>`);
  o.push(`</mask></defs>`);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cx = bx + PAD + c * S + S / 2, cy = by + PAD + r * S + S / 2;
    o.push(`<circle cx="${cx}" cy="${cy}" r="${S / 2 - 6}" fill="${t.hole}"/>`);
  }
  // ordem de animação: penúltima (humano) cai, depois a última (IA)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = g.board[r][c]; if (!v) continue;
    const cx = bx + PAD + c * S + S / 2, cy = by + PAD + r * S + S / 2;
    const key = `${r},${c}`, idx = last.findIndex((m) => m.row === r && m.col === c);
    const anim = lastKey.has(key) ? ` class="drop" style="animation-delay:${idx * 700}ms"` : "";
    o.push(`<circle${anim} cx="${cx}" cy="${cy}" r="${S / 2 - 7}" fill="${v === HUMAN ? t.human : t.ai}"/>`);
  }
  o.push(`<rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="16" fill="${t.board}" mask="url(#${clipId})"/>`);
  // destaque: última jogada da IA e linha vencedora
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cx = bx + PAD + c * S + S / 2, cy = by + PAD + r * S + S / 2, key = `${r},${c}`;
    if (winKey.has(key)) o.push(`<circle class="pulse" cx="${cx}" cy="${cy}" r="${S / 2 - 9}" fill="none" stroke="${t.ring}" stroke-width="4"/>`);
    else if (g.status === "playing" && last.length && last[last.length - 1].row === r && last[last.length - 1].col === c)
      o.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${t.board}" opacity=".55"/>`);
  }
  for (let c = 0; c < COLS; c++) o.push(`<text x="${bx + PAD + c * S + S / 2}" y="${by + BH + 26}" text-anchor="middle" class="m" style="font-weight:600">${c + 1}</text>`);
  o.push(`<circle cx="${bx - 70}" cy="${by + 30}" r="9" fill="${t.human}"/><text x="${bx - 56}" y="${by + 35}" class="m">você</text>`);
  o.push(`<circle cx="${bx - 70}" cy="${by + 58}" r="9" fill="${t.ai}"/><text x="${bx - 56}" y="${by + 63}" class="m">IA</text>`);
  o.push(`</svg>`);
  return o.join("\n");
}

// ---------------- render README ----------------
function issueUrl(col) {
  const body = [
    `Só clicar em **Create** (ou **Submit new issue**) — não precisa escrever nada.`,
    ``,
    `🤖 Em ~30 segundos a IA responde e o tabuleiro atualiza no perfil.`,
    ``,
    `> ⚠️ Não altere o título.`,
  ].join("\n");
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`4emlinha|jogar|${col}`)}&body=${encodeURIComponent(body)}`;
}

function renderReadme(state) {
  const g = state.game, open = g.status === "playing" ? validCols(g.board) : [...Array(COLS).keys()];
  const buttons = [...Array(COLS).keys()].map((c) => open.includes(c)
    ? `<a href="${issueUrl(c + 1)}"><img src="https://img.shields.io/badge/%E2%96%BC-${c + 1}-7c3aed?style=for-the-badge" alt="jogar na coluna ${c + 1}" /></a>`
    : `<img src="https://img.shields.io/badge/%E2%80%94-${c + 1}-30363d?style=for-the-badge" alt="coluna ${c + 1} cheia" />`).join("\n  ");

  const hint = g.status === "playing"
    ? (g.moves.length ? `É a sua vez. Escolha uma coluna — a IA responde em ~30s.` : `Tabuleiro novinho. Faça a primeira jogada!`)
    : `Partida encerrada. Clique em qualquer coluna para começar a partida #${g.id + 1}.`;

  const recent = state.recent.length
    ? `| Jogador | Jogou | IA respondeu | Quando |\n|:--|:-:|:-:|:--|\n` + state.recent.map((m) =>
        `| <img src="https://github.com/${m.user}.png?size=20" width="20" align="center" /> [@${m.user}](https://github.com/${m.user}) | ${m.col} | ${m.result === "humans" ? "🏆 venceu!" : m.ai ?? "—"}${m.result === "ai" ? " 💀" : ""} | ${new Date(m.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} |`).join("\n")
    : `_Ninguém jogou ainda. Seja o primeiro!_`;

  const top = Object.entries(state.players).sort((a, b) => b[1].wins - a[1].wins || b[1].moves - a[1].moves).slice(0, 5);
  const ranking = top.length ? top.map(([u, p], i) => `${["🥇", "🥈", "🥉", "4.", "5."][i]} [@${u}](https://github.com/${u}) — ${p.moves} jogada${p.moves > 1 ? "s" : ""}${p.wins ? ` · **${p.wins} vitória${p.wins > 1 ? "s" : ""}**` : ""}`).join("<br/>\n") : "_vazio_";
  const hall = state.hallOfFame.length ? state.hallOfFame.slice(0, 10).map((h) => `[@${h.user}](https://github.com/${h.user}) (partida #${h.game})`).join(" · ") : "_Ninguém venceu a IA ainda. 👀_";

  return `<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/4emlinha-dark.svg?v=${g.id}-${g.moves.length}" />
    <img src="./assets/4emlinha-light.svg?v=${g.id}-${g.moves.length}" alt="Tabuleiro do 4 em Linha" width="100%" />
  </picture>
</p>

<p align="center">
  ${buttons}
</p>
<p align="center"><b>${hint}</b></p>

<table>
<tr>
<td valign="top" width="58%">

**🕹️ Últimas jogadas**

${recent}

</td>
<td valign="top" width="42%">

**📈 Mais ativos**

${ranking}

**🏆 Hall da Fama** — venceram a IA

${hall}

</td>
</tr>
</table>

<details>
<summary><b>Como funciona?</b></summary>
<br/>

1. Você clica numa coluna → abre uma issue com o título \`4emlinha|jogar|N\`.
2. Um [GitHub Action](./.github/workflows/4emlinha.yml) lê a jogada, valida e aplica no tabuleiro.
3. A IA ([negamax com poda alfa-beta](./.github/scripts/connect4.mjs), ${DEPTH} jogadas de profundidade) escolhe a resposta.
4. O Action redesenha o SVG, atualiza este README, comenta na sua issue e a fecha.

Todo mundo joga junto contra a mesma IA. Quem fizer a jogada da vitória entra pro Hall da Fama.
</details>`;
}

function writeOutputs(state) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [n, t] of Object.entries(THEMES)) writeFileSync(`${OUT_DIR}/4emlinha-${n}.svg`, renderBoard(state, t));
  const md = readFileSync(README, "utf8");
  const re = /(<!-- 4EMLINHA:START -->)[\s\S]*?(<!-- 4EMLINHA:END -->)/;
  if (!re.test(md)) throw new Error("marcadores 4EMLINHA não encontrados no README");
  writeFileSync(README, md.replace(re, `$1\n${renderReadme(state)}\n$2`));
}

// ---------------- GitHub API ----------------
async function api(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "4emlinha", "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function processIssues() {
  const state = loadState();
  const issues = (await api(`/repos/${REPO}/issues?state=open&per_page=100&sort=created&direction=asc`))
    .filter((i) => !i.pull_request && i.title.startsWith("4emlinha|"));
  if (!issues.length) { console.log("nenhuma jogada pendente"); return false; }
  const replies = [];
  for (const i of issues) {
    const m = i.title.trim().match(TITLE_RE);
    const r = m ? play(state, i.user.login, Number(m[1]) - 1, i.number)
                : { ok: false, msg: "Título inválido. Use os botões do [perfil](https://github.com/" + OWNER + "#-4-em-linha) para jogar." };
    console.log(`#${i.number} @${i.user.login}: ${r.ok ? "ok" : "rejeitada"}`);
    replies.push([i.number, r]);
  }
  saveState(state);
  writeOutputs(state);
  // Comentários e fechamento vêm depois de salvar; o workflow só faz commit depois disso.
  writeFileSync(process.env.REPLIES_FILE || "/tmp/4emlinha-replies.json", JSON.stringify(replies));
  return true;
}

async function sendReplies() {
  const replies = JSON.parse(readFileSync(process.env.REPLIES_FILE || "/tmp/4emlinha-replies.json", "utf8"));
  for (const [n, r] of replies) {
    await api(`/repos/${REPO}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: r.msg }) });
    await api(`/repos/${REPO}/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: r.ok ? "completed" : "not_planned"}) });
  }
}

// ---------------- main ----------------
const [cmd, arg] = process.argv.slice(2);
if (cmd === "process") await processIssues();
else if (cmd === "reply") await sendReplies();
else if (cmd === "render") { const s = loadState(); saveState(s); writeOutputs(s); }
else if (cmd === "local") { const s = loadState(); const r = play(s, process.env.PLAYER || "local", Number(arg) - 1, 0); console.log(r.msg); saveState(s); writeOutputs(s); }
else { console.error("uso: connect4.mjs process|reply|render|local <col>"); process.exit(1); }
