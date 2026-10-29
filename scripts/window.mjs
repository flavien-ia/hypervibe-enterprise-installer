#!/usr/bin/env node
// window.mjs - ouvre une fenêtre de terminal qui exécute ask-key.mjs, et
// attend qu'elle se ferme. La saisie masquée exige un vrai TTY, que la
// conversation Claude n'a pas : c'est la même mécanique que le coffre-fort du
// harnais (Windows testé ; macOS et Linux suivent le même pattern).
//
// Sortie : le code de retour d'ask-key (0 = clé enregistrée, 2 = abandon).

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASK = join(__dirname, "ask-key.mjs");
const OS = platform();

if (OS === "win32") {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = ["--no-deprecation", ASK].map(q).join(",");
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `$p = Start-Process -FilePath node -ArgumentList @(${argList}) -Wait -PassThru; exit $p.ExitCode`],
    { stdio: "inherit" },
  );
  process.exit(res.status || 0);
}

// macOS / Linux : fenêtre + sentinelle portant le code de sortie interne.
const sentinel = join(tmpdir(), `hv-enterprise-key-${process.pid}.done`);
try { if (existsSync(sentinel)) rmSync(sentinel); } catch { /* neuf */ }
const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const nodeCmd = `node --no-deprecation ${sh(ASK)}`;
const runLine = `${nodeCmd}; echo $? > ${sh(sentinel)}`;

console.error("Une fenêtre va s'ouvrir pour saisir la clé de licence.");
console.error(`Si rien ne s'ouvre, lance à la main : ${nodeCmd}`);

if (OS === "darwin") {
  const osa = `tell application "Terminal" to do script "${runLine.replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`;
  const r = spawnSync("osascript", ["-e", osa], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("Impossible d'ouvrir le Terminal (autorisation d'automatisation macOS ?).");
    process.exit(1);
  }
} else {
  const r = spawnSync("x-terminal-emulator", ["-e", "bash", "-lc", runLine], { encoding: "utf8" });
  if (r.status !== 0 && r.error) {
    console.error("Aucun émulateur de terminal trouvé : lance la commande affichée ci-dessus à la main.");
    process.exit(1);
  }
}

// Attendre la sentinelle (15 min max), en scrutant doucement.
const debut = Date.now();
while (Date.now() - debut < 15 * 60 * 1000) {
  if (existsSync(sentinel)) {
    const code = parseInt(readFileSync(sentinel, "utf8").trim(), 10) || 0;
    try { rmSync(sentinel); } catch { /* tant pis */ }
    process.exit(code);
  }
  spawnSync(OS === "darwin" ? "sleep" : "sleep", ["1"]);
}
console.error("Fenêtre restée ouverte trop longtemps : abandon.");
process.exit(1);
