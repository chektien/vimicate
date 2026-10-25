#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { recoverResetEpoch } from "./recover-vimicate-reset-epoch.mjs";

const execute = promisify(execFile);
export function requireStoppedGateway(status, stateDir) {
  if (status?.service?.loaded !== false || status?.service?.runtime?.pid != null
      || status?.service?.runtime?.status === "running"
      || status?.port?.status !== "free" || !Array.isArray(status?.port?.listeners)
      || status.port.listeners.length !== 0) {
    throw new Error("Gateway must be unloaded and its port proven free for exclusive maintenance");
  }
  if (stateDir && (typeof status?.config?.daemon?.path !== "string"
      || path.dirname(path.resolve(status.config.daemon.path)) !== path.resolve(stateDir))) {
    throw new Error("Gateway status does not own the requested OpenClaw state directory");
  }
}

export function parseArguments(argv) {
  const names = new Map([
    ["--state-dir", "stateDir"], ["--vimicate-dir", "vimicateDir"],
    ["--stable-session-key", "stableSessionKey"], ["--previous-session-id", "previousSessionId"],
    ["--current-session-id", "currentSessionId"], ["--openclaw-root", "openClawRoot"]
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--dry-run") {
      if (Object.hasOwn(options, "apply")) throw new Error("choose exactly one --apply or --dry-run");
      options.apply = argument === "--apply";
    } else {
      const key = names.get(argument), value = argv[++index];
      if (!key || !value || value.startsWith("--") || Object.hasOwn(options, key)) throw new Error("invalid or duplicate argument");
      options[key] = value;
    }
  }
  if (!Object.hasOwn(options, "apply") || [...names.values()].some((key) => !options[key])) {
    throw new Error("all explicit paths/session identities and --dry-run or --apply are required");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = path.resolve(options.openClawRoot);
  if (await fs.realpath(root) !== root) throw new Error("OpenClaw package root must be canonical");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.name !== "openclaw" || manifest.version !== "2026.7.1-2") {
    throw new Error("OpenClaw store API has not been verified for this package version");
  }
  const sdk = await import(pathToFileURL(path.join(root, "dist/plugin-sdk/session-store-runtime.js")).href);
  const assertOffline = async () => {
    const { stdout } = await execute(process.execPath, [path.join(root, "dist/index.js"),
      "gateway", "status", "--json", "--no-probe"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    requireStoppedGateway(JSON.parse(stdout), options.stateDir);
  };
  const result = await recoverResetEpoch(options, { assertOffline, updateSessionStore: sdk.updateSessionStore });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
