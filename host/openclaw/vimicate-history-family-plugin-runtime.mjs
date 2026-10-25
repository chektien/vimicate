import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VIMICATE_ARCHIVED_FAMILY_CONTRACT } from
  "./vimicate-history-family-contract.mjs";
import { createOpenClawHistoryFamilyLedgerWriter } from
  "./vimicate-history-family-ledger.mjs";
import { loadOpenClawHistoryFamilyContract } from
  "./vimicate-history-family-openclaw.mjs";

export const VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME =
  "openclaw-history-family-health.json";
export const VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT =
  "canonical-chat-history-page-v1";

function fail(message) {
  throw new Error(`vimicate archived-family plugin: ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function integrityFailureKind(error) {
  const typed = error?.vimicateHistoryFamilyFailureKind;
  if (typed === "integrity") return "audit";
  if (typed === "projection") return "disable";
  if (typed === "client" || typed === "transient") return "none";
  const message = errorMessage(error);
  if (message.startsWith("vimicate archived-family host:")) return "audit";
  if (message.startsWith("vimicate canonical history projector received")
      || message.includes("canonical history projection returned invalid")) {
    return "disable";
  }
  return "none";
}

async function awaitWithCancellation(promise, signal) {
  if (signal?.aborted) fail("request was cancelled");
  if (!signal) return promise;
  let cancel;
  const cancelled = new Promise((_, reject) => {
    cancel = () => reject(new Error("request was cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function atomicWriteHealth(file, value) {
  const directory = path.dirname(file);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("Vimicate host directory is not fixed");
  }
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(
      temporary,
      fsNative.constants.O_WRONLY
        | fsNative.constants.O_CREAT
        | fsNative.constants.O_EXCL
        | fsNative.constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function requirePluginAPI(api) {
  for (const name of ["registerGatewayMethod", "registerService", "on"]) {
    if (typeof api?.[name] !== "function") fail(`plugin API ${name} is required`);
  }
  if (typeof api?.runtime?.state?.resolveStateDir !== "function") {
    fail("plugin runtime state resolver is required");
  }
}

export function registerVimicateHistoryFamilyPlugin(api, dependencies) {
  requirePluginAPI(api);
  if (typeof dependencies?.projector?.readPage !== "function"
      || typeof dependencies?.projector?.probe !== "function") {
    fail("canonical projector read and probe functions are required");
  }
  if (typeof dependencies?.formatError !== "function") {
    fail("Gateway error formatter is required");
  }

  const configuredStateDir = dependencies.stateDir ?? api.runtime.state.resolveStateDir();
  const configuredVimicateDir = dependencies.vimicateDir
    ?? process.env.VIMICATE_HOME
    ?? path.join(os.homedir(), ".vimicate");
  if (!path.isAbsolute(configuredStateDir) || !path.isAbsolute(configuredVimicateDir)) {
    fail("plugin host directories must be absolute");
  }
  const stateDir = path.resolve(configuredStateDir);
  const vimicateDir = path.resolve(configuredVimicateDir);
  const healthFile = path.join(vimicateDir, VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME);
  const writer = createOpenClawHistoryFamilyLedgerWriter({ stateDir, vimicateDir });
  let handler;
  let activation;
  let stickyFailure;
  let lifecycleGeneration = 0;
  let stopped = false;
  let integrityQueue = Promise.resolve();
  let pendingIntegrityAudit;

  function withIntegrityGate(operation) {
    const result = integrityQueue.then(operation);
    integrityQueue = result.catch(() => {});
    return result;
  }

  async function removeHealth() {
    await fs.rm(healthFile, { force: true }).catch(() => {});
  }

  async function markUnhealthy(error) {
    lifecycleGeneration += 1;
    stickyFailure = error instanceof Error ? error : new Error(String(error));
    handler = undefined;
    await removeHealth();
    api.logger?.error?.(`vimicate archived-family disabled: ${errorMessage(stickyFailure)}`);
  }

  async function activate() {
    if (stickyFailure) throw stickyFailure;
    if (stopped) fail("plugin service is stopped");
    if (handler) return handler;
    if (!activation) {
      const generation = lifecycleGeneration;
      activation = (async () => {
        const projectorProbe = await dependencies.projector.probe();
        if (projectorProbe?.contract !== VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT) {
          fail("canonical projector probe is unhealthy");
        }
        if (stickyFailure || stopped || generation !== lifecycleGeneration) {
          throw stickyFailure ?? new Error("plugin activation was invalidated");
        }
        const { nextHandler } = await withIntegrityGate(
          async () => {
            if (stickyFailure || stopped || generation !== lifecycleGeneration) {
              throw stickyFailure ?? new Error("plugin activation was invalidated");
            }
            const writerProbe = await writer.probe();
            if (writerProbe?.contract !== "session-end-ledger-v1") {
              fail("session-end writer probe is unhealthy");
            }
            const nextHandler = await loadOpenClawHistoryFamilyContract({
              stateDir,
              vimicateDir,
              readProjectedHistoryPage: dependencies.projector.readPage
            });
            if (typeof nextHandler?.probe !== "function") {
              fail("archived-family audit probe is unavailable");
            }
            const handlerProbe = await nextHandler.probe();
            if (handlerProbe?.contract !== "archived-family-audit-v1") {
              fail("archived-family audit probe is unhealthy");
            }
            if (stickyFailure || stopped || generation !== lifecycleGeneration) {
              throw stickyFailure ?? new Error("plugin activation was invalidated");
            }
            await atomicWriteHealth(healthFile, {
              schemaVersion: 1,
              contract: VIMICATE_ARCHIVED_FAMILY_CONTRACT,
              pid: process.pid,
              writer: writerProbe.contract,
              projector: projectorProbe.contract,
              handler: "operator-read-rpc-v1",
              audit: handlerProbe.contract,
              ready: true
            });
            if (stickyFailure || stopped || generation !== lifecycleGeneration) {
              await removeHealth();
              throw stickyFailure ?? new Error("plugin activation was invalidated");
            }
            return { nextHandler };
          }
        );
        if (stickyFailure || stopped || generation !== lifecycleGeneration) {
          throw stickyFailure ?? new Error("plugin activation was invalidated");
        }
        handler = nextHandler;
        return handler;
      })().catch(async (error) => {
        if (!stickyFailure && !stopped
            && error?.vimicateHistoryFamilyFailureKind !== "transient") {
          await markUnhealthy(error);
        } else await removeHealth();
        throw stickyFailure ?? error;
      }).finally(() => {
        activation = undefined;
      });
    }
    return activation;
  }

  api.on("session_end", async (event, context) => {
    if (stopped) return;
    try {
      await withIntegrityGate(() => writer.record(event, context));
    } catch (error) {
      await markUnhealthy(error);
    }
  });

  api.on("model_call_started", async (event, context) => {
    if (stopped) return;
    try {
      await withIntegrityGate(() => writer.observeCurrent(event, context));
    } catch (error) {
      await markUnhealthy(error);
    }
  });

  function scheduleIntegrityAudit(candidate) {
    if (pendingIntegrityAudit || stickyFailure || stopped
        || typeof candidate?.probe !== "function") return;
    const signal = AbortSignal.timeout(30_000);
    const operation = withIntegrityGate(() => candidate.probe({ signal }))
      .catch((error) => {
        if (integrityFailureKind(error) !== "none") return markUnhealthy(error);
        return undefined;
      })
      .finally(() => {
        if (pendingIntegrityAudit === operation) pendingIntegrityAudit = undefined;
      });
    pendingIntegrityAudit = operation;
  }

  api.registerGatewayMethod(
    "vimicate.history.family",
    async ({ params, respond }) => {
      let activeHandler;
      const signal = dependencies.createRequestSignal?.()
        ?? AbortSignal.timeout(30_000);
      try {
        if (signal.aborted) fail("request was cancelled");
        activeHandler = await awaitWithCancellation(activate(), signal);
        respond(true, await activeHandler(params, { signal }), undefined);
      } catch (error) {
        const message = errorMessage(error);
        respond(
          false,
          undefined,
          dependencies.formatError(`vimicate history family failed: ${message}`)
        );
        if (!signal.aborted) {
          const integrityKind = integrityFailureKind(error);
          if (error?.vimicateHistoryFamilyFailureKind === "integrity") {
            // A typed owned-archive, ledger, or fixed-authority violation is
            // already definitive. A second audit could be obscured by an
            // unrelated live-current append, so fail closed immediately.
            void markUnhealthy(error);
          } else if (integrityKind === "audit") scheduleIntegrityAudit(activeHandler);
          else if (integrityKind === "disable") void markUnhealthy(error);
        }
      }
    },
    { scope: "operator.read" }
  );

  api.registerService({
    id: "vimicate-history-family",
    start: async () => {
      try {
        await activate();
        api.logger?.info?.("vimicate archived-family capability ready");
      } catch {
        // Failure is already logged and leaves capability advertisement absent.
      }
    },
    stop: async () => {
      stopped = true;
      lifecycleGeneration += 1;
      handler = undefined;
      await integrityQueue.catch(() => {});
      await removeHealth();
    }
  });

  return {
    activate,
    healthFile,
    isReady: () => handler != null && stickyFailure == null,
    failure: () => stickyFailure
  };
}
