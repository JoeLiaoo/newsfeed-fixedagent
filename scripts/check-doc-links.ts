// Check local Markdown links without network access or additional dependencies.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inputs = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs"];

function collect(input: string): string[] {
  const full = resolve(root, input);
  if (!existsSync(full)) throw new Error(`missing documentation path: ${input}`);
  if (statSync(full).isDirectory()) {
    return readdirSync(full).flatMap(name => collect(join(input, name)));
  }
  return full.endsWith(".md") ? [full] : [];
}

const problems: string[] = [];
let links = 0;
const pattern = /!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']+["'])?\)/g;
for (const name of inputs) {
  for (const file of collect(name)) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(pattern)) {
      let href = match[1]!;
      if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
      if (!href || href.startsWith("#") || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      const dest = href.split(/[?#]/, 1)[0]!;
      let decoded: string;
      try { decoded = decodeURIComponent(dest); }
      catch { problems.push(`${relative(root, file)}: malformed link ${href}`); continue; }
      const target = resolve(dirname(file), decoded);
      links++;
      if (!(target === root || target.startsWith(root + sep)) || !existsSync(target)) {
        const line = markdown.slice(0, match.index).split("\n").length;
        problems.push(`${relative(root, file)}:${line}: unresolved local link ${href}`);
      }
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else console.log(`Checked ${links} local Markdown links; all targets exist.`);
