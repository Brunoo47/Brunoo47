// Filesystem virtual do terminal. Para adicionar um arquivo/projeto, edite aqui.
export const HOME = "/home/bruno";

// Botões que aparecem embaixo do terminal no README.
export const COMMAND_KEYS = ["help", "ls -la", "cat sobre.md", "neofetch", "htop", "tree", "git log", "./contato.sh"];

// markdown simples -> segmentos coloridos
function md(text) {
  const lines = text.trim().split("\n");
  return {
    type: "file",
    lines,
    render: lines.map((l) => {
      if (/^#{1,3} /.test(l)) return [[l, "p"]];
      if (/^- /.test(l)) return [["  • ", "g"], [l.slice(2), "w"]];
      const m = l.match(/^(\w[\w ]*?):\s(.*)$/);
      if (m) return [[m[1] + ": ", "c"], [m[2], "w"]];
      return [[l, "w"]];
    }),
  };
}

function json(obj) {
  const lines = JSON.stringify(obj, null, 2).split("\n");
  return {
    type: "file",
    lines,
    render: lines.map((l) => {
      const m = l.match(/^(\s*)"([^"]+)": (.*)$/);
      if (m) return [[m[1], "w"], [`"${m[2]}"`, "b"], [": ", "w"], ...strs(m[3])];
      return strs(l);
    }),
  };
  function strs(s) { return s.split(/("[^"]*")/).filter(Boolean).map((p) => [p, p.startsWith('"') ? "g" : "w"]); }
}

function project({ nome, desc, stack, repo, emoji }) {
  const f = md(`# ${emoji} ${nome}\n\n${desc}\n\nStack: ${stack}\nRepo: github.com/Brunoo47/${repo}`);
  f.url = `https://github.com/Brunoo47/${repo}`;
  return f;
}

const contato = `#!/usr/bin/env bash
# como falar comigo
echo "email:  brunoostroskiprogramador@gmail.com"
echo "github: github.com/Brunoo47"
echo "local:  Joinville - SC"`;

export const FS = {
  type: "dir",
  children: {
    home: { type: "dir", children: { bruno: { type: "dir", children: {
      "sobre.md": md(`
# Bruno Ostroski

Desenvolvedor full-stack em Joinville - SC.

- Trabalho na @ultralims com sistemas LIMS (APIs em PHP + Slim)
- Construo projetos com IA na @NexusGen-Projetos
- Back-end: PHP, Java + Spring Boot, Python + Django
- Front-end: TypeScript, Next.js
- No GitHub desde fevereiro de 2023

Contato: rode ./contato.sh`),
      "stack.json": json({
        backend: ["PHP", "Slim", "Java", "Spring Boot", "Python", "Django"],
        frontend: ["JavaScript", "TypeScript", "Next.js"],
        dados: ["MySQL", "PostgreSQL"],
        devops: ["Docker", "AWS", "Git", "Linux"],
        ferramentas: ["IntelliJ IDEA", "VS Code", "Postman", "Cypress"],
      }),
      "contato.sh": { type: "file", exec: true, lines: contato.split("\n"), render: contato.split("\n").map((l) => (l.startsWith("#") ? [[l, "m"]] : [["echo ", "g"], [l.slice(5), "y"]])) },
      projetos: { type: "dir", children: {
        "sistema-bombeiros.md": project({ emoji: "🚒", nome: "Sistema Bombeiros", repo: "Sistema-Bombeiros", stack: "JavaScript · CSS · HTML", desc: "Sistema web para o Corpo de Bombeiros de Guaramirim — front-end do sistema de gestão." }),
        "bombeiros-api.md": project({ emoji: "🗄️", nome: "Bombeiros · API", repo: "Django", stack: "Python · Django", desc: "Banco de dados e back-end em Django do sistema dos bombeiros de Guaramirim." }),
        "demolay-ai.md": project({ emoji: "🤖", nome: "DeMolay AI Assistant", repo: "demolay-ai-assistant", stack: "JavaScript · IA", desc: "Agente de IA que responde dúvidas sobre a Ordem DeMolay." }),
        "app-aws.md": project({ emoji: "☁️", nome: "app-aws", repo: "app-aws", stack: "PHP · AWS SDK · Docker", desc: "Projeto base para integrar serviços da AWS com PHP." }),
      } },
      ".bashrc": { type: "file", lines: ["export EDITOR=idea", "alias ll='ls -la'", "PS1='\\u@github:\\w\\$ '"], render: [[["export ", "p"], ["EDITOR=idea", "w"]], [["alias ", "p"], ["ll='ls -la'", "w"]], [["PS1", "c"], ["='\\u@github:\\w\\$ '", "w"]]] },
    } } } },
  },
};
