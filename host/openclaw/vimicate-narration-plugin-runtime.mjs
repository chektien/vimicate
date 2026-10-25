import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  VIMICATE_SHARED_NARRATION_CONTRACT,
  createVimicateNarrationRecordContract
} from "./vimicate-narration-record-contract.mjs";

import {
  createVimicateNarrationStateStore,
  VIMICATE_NARRATION_STATE_STORE_CONTRACT
} from "./vimicate-narration-state-store.mjs";

export {
  createVimicateNarrationStateStore,
  VIMICATE_NARRATION_STATE_FILENAME,
  VIMICATE_NARRATION_STATE_STORE_CONTRACT
} from "./vimicate-narration-state-store.mjs";
export const VIMICATE_NARRATION_HEALTH_FILENAME =
  "openclaw-shared-narration-health.json";

const RUN_SESSION_AUTHORITY_NAMESPACE = "shared-narration-session-v1";

function fail(message) {
  throw new Error(`vimicate shared narration plugin: ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function closeQuietly(handle) {
  if (handle) await handle.close().catch(() => {});
}

async function atomicWriteHealth(file, value) {
  const directory = path.dirname(file);
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail("Vimicate host directory is not fixed");
  }
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.`
      + `${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  let renamed = false;
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
    handle = undefined;
    await fs.rename(temporary, file);
    renamed = true;
    await fs.chmod(file, 0o600);
  } finally {
    await closeQuietly(handle);
    if (!renamed) await fs.unlink(temporary).catch(() => {});
  }
}

function requirePluginAPI(api) {
  if (typeof api?.agent?.events?.registerAgentEventSubscription !== "function") {
    fail("agent event subscription API is required");
  }
  for (const name of ["registerGatewayMethod", "registerService"]) {
    if (typeof api?.[name] !== "function") fail(`plugin API ${name} is required`);
  }
}

function requireStore(store) {
  for (const name of ["probe", "readState", "commitState"]) {
    if (typeof store?.[name] !== "function") {
      fail(`state store ${name} is required`);
    }
  }
}

export function registerVimicateNarrationPlugin(api, dependencies) {
  requirePluginAPI(api);
  if (typeof dependencies?.formatError !== "function") {
    fail("Gateway error formatter is required");
  }
  const configuredVimicateDir = dependencies.vimicateDir
    ?? process.env.VIMICATE_HOME
    ?? path.join(os.homedir(), ".vimicate");
  if (!path.isAbsolute(configuredVimicateDir)) {
    fail("Vimicate host directory must be absolute");
  }
  const vimicateDir = path.resolve(configuredVimicateDir);
  const healthFile = path.join(
    vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  );
  const store = dependencies.store ?? createVimicateNarrationStateStore({
    vimicateDir
  });
  requireStore(store);

  let handler;
  let activation;
  let stickyFailure;
  let generation = 0;
  let stopped = false;
  let eventQueue = Promise.resolve();

  async function removeHealth() {
    await fs.unlink(healthFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  async function markUnhealthy(error) {
    if (stickyFailure) {
      await removeHealth().catch(() => {});
      return;
    }
    generation += 1;
    stickyFailure = error instanceof Error
      ? error
      : new Error(String(error));
    handler = undefined;
    await removeHealth().catch(() => {});
    api.logger?.error?.(
      `vimicate shared narration disabled: ${errorMessage(stickyFailure)}`
    );
  }

  async function activate() {
    if (stickyFailure) throw stickyFailure;
    if (stopped) fail("plugin service is stopped");
    if (handler) return handler;
    if (!activation) {
      const activationGeneration = generation;
      activation = (async () => {
        const storeProbe = await store.probe();
        if (storeProbe?.contract !== VIMICATE_NARRATION_STATE_STORE_CONTRACT) {
          fail("state store probe is unhealthy");
        }
        const candidate = createVimicateNarrationRecordContract({
          readState: store.readState,
          commitState: store.commitState
        });
        const contractProbe = await candidate.probe();
        if (contractProbe?.contract !== VIMICATE_SHARED_NARRATION_CONTRACT) {
          fail("record contract probe is unhealthy");
        }
        if (stickyFailure
            || stopped
            || activationGeneration !== generation) {
          throw stickyFailure ?? new Error("plugin activation was invalidated");
        }
        await atomicWriteHealth(healthFile, {
          schemaVersion: 1,
          contract: VIMICATE_SHARED_NARRATION_CONTRACT,
          pid: process.pid,
          store: storeProbe.contract,
          subscription: "sanitized-agent-lifecycle-item-v2",
          handler: "operator-read-rpc-v1",
          ready: true
        });
        if (stickyFailure
            || stopped
            || activationGeneration !== generation) {
          await removeHealth();
          throw stickyFailure ?? new Error("plugin activation was invalidated");
        }
        handler = candidate;
        return handler;
      })().catch(async (error) => {
        if (!stopped) await markUnhealthy(error);
        else await removeHealth().catch(() => {});
        throw stickyFailure ?? error;
      }).finally(() => {
        activation = undefined;
      });
    }
    return activation;
  }

  api.agent.events.registerAgentEventSubscription({
    id: "vimicate-shared-narration",
    description: "Retain bounded user-visible Codex preamble narration",
    streams: ["lifecycle", "item"],
    handle: (event, context) => {
      const operation = eventQueue.then(async () => {
        if (stopped || stickyFailure) return;
        try {
          if (event?.stream === "lifecycle") {
            if (typeof event.sessionKey === "string"
                && event.sessionKey.trim()
                && typeof event.sessionId === "string"
                && event.sessionId.trim()) {
              context?.setRunContext?.(RUN_SESSION_AUTHORITY_NAMESPACE, {
                sessionKey: event.sessionKey,
                sessionId: event.sessionId
              });
            }
            return;
          }
          const remembered = context?.getRunContext?.(
            RUN_SESSION_AUTHORITY_NAMESPACE
          );
          const candidate = {
            ...event,
            sessionKey: event?.sessionKey ?? remembered?.sessionKey,
            sessionId: event?.sessionId ?? remembered?.sessionId
          };
          const active = await activate();
          await active.record(candidate);
        } catch (error) {
          if (!stopped) await markUnhealthy(error);
        }
      });
      eventQueue = operation.catch(() => {});
      return operation;
    }
  });

  api.registerGatewayMethod(
    "vimicate.narration.page",
    async ({ params, respond }) => {
      const signal = dependencies.createRequestSignal?.()
        ?? AbortSignal.timeout(30_000);
      let active;
      try {
        if (signal.aborted) fail("request was cancelled");
        active = await activate();
        if (signal.aborted) fail("request was cancelled");
        const response = await active.request(params);
        if (signal.aborted) fail("request was cancelled");
        respond(true, response, undefined);
      } catch (error) {
        if (!signal.aborted && active && !stickyFailure) {
          try {
            await active.probe();
          } catch (probeError) {
            await markUnhealthy(probeError);
          }
        }
        respond(
          false,
          undefined,
          dependencies.formatError(
            `vimicate narration page failed: ${errorMessage(error)}`
          )
        );
      }
    },
    { scope: "operator.read" }
  );

  api.registerService({
    id: "vimicate-shared-narration",
    start: async () => {
      try {
        await activate();
        api.logger?.info?.("vimicate shared narration capability ready");
      } catch {
        // Activation logs the failure and leaves the health marker absent.
      }
    },
    stop: async () => {
      stopped = true;
      generation += 1;
      handler = undefined;
      await activation?.catch(() => {});
      await eventQueue.catch(() => {});
      await removeHealth().catch(() => {});
    }
  });

  return {
    activate,
    healthFile,
    stateFile: store.file,
    isReady: () => handler != null && stickyFailure == null,
    failure: () => stickyFailure
  };
}
