#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { requireStoppedGateway } from "./recover-vimicate-reset-epoch-cli.mjs";
import { createOpenClawHistoryFamilyLedgerWriter } from "./vimicate-history-family-ledger.mjs";

const execute = promisify(execFile);
export function parseArguments(argv) {
  const options = { sessionIds: [] };
  const names = new Map([["--state-dir", "stateDir"], ["--vimicate-dir", "vimicateDir"],
    ["--stable-session-key", "stableSessionKey"], ["--openclaw-root", "openClawRoot"]]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--dry-run") {
      if (Object.hasOwn(options, "apply")) throw new Error("choose exactly one dry-run or apply");
      options.apply = argument === "--apply";
    } else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("argument value is required");
      if (argument === "--session-id") options.sessionIds.push(value);
      else {
        const key = names.get(argument);
        if (!key || Object.hasOwn(options, key)) throw new Error("unknown or duplicate argument");
        options[key] = value;
      }
    }
  }
  if (!Object.hasOwn(options, "apply") || options.sessionIds.length < 2
      || [...names.values()].some(key => !options[key])) throw new Error("explicit paths, ordered session IDs and mode are required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = path.resolve(options.openClawRoot);
  if (await fs.realpath(root) !== root) throw new Error("OpenClaw package root must be canonical");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.name !== "openclaw" || manifest.version !== "2026.7.1-2") {
    throw new Error("OpenClaw maintenance status contract has not been verified for this version");
  }
  const assertOffline = async () => {
    const { stdout } = await execute(process.execPath, [path.join(root, "dist/index.js"),
      "gateway", "status", "--json", "--no-probe"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    requireStoppedGateway(JSON.parse(stdout), options.stateDir);
  };
  const result = await createOpenClawHistoryFamilyLedgerWriter(options).repairWitnessedChain(options, assertOffline);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
