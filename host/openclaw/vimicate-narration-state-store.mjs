import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const VIMICATE_NARRATION_STATE_FILENAME =
  "openclaw-shared-narration-v1.json";
export const VIMICATE_NARRATION_STATE_STORE_CONTRACT =
  "shared-narration-state-v1";

const DEFAULT_MAXIMUM_STATE_BYTES = 16 * 1024 * 1024;

function fail(message) {
  throw new Error(`vimicate shared narration plugin: ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function exactMode(stat) {
  return Number(stat.mode & 0o777n);
}

function sameFileIdentity(lhs, rhs) {
  return lhs.dev === rhs.dev && lhs.ino === rhs.ino;
}

function sameReadIdentity(lhs, rhs) {
  return sameFileIdentity(lhs, rhs)
    && lhs.size === rhs.size
    && lhs.mtimeNs === rhs.mtimeNs
    && lhs.mode === rhs.mode
    && lhs.uid === rhs.uid
    && lhs.gid === rhs.gid
    && (lhs.ctimeNs === rhs.ctimeNs
      || (lhs.nlink === 1n && rhs.nlink === 0n));
}

async function closeQuietly(handle) {
  if (handle) await handle.close().catch(() => {});
}

function requireMaximumStateBytes(value) {
  const resolved = value ?? DEFAULT_MAXIMUM_STATE_BYTES;
  if (!Number.isSafeInteger(resolved)
      || resolved < 1
      || resolved > DEFAULT_MAXIMUM_STATE_BYTES) {
    fail("maximumStateBytes is outside its accepted bound");
  }
  return resolved;
}

export function createVimicateNarrationStateStore({
  vimicateDir,
  maximumStateBytes
}) {
  if (typeof vimicateDir !== "string" || !path.isAbsolute(vimicateDir)) {
    fail("Vimicate host directory must be absolute");
  }
  const directory = path.resolve(vimicateDir);
  const file = path.join(directory, VIMICATE_NARRATION_STATE_FILENAME);
  const byteLimit = requireMaximumStateBytes(maximumStateBytes);
  let pinnedDirectory;

  async function inspectDirectory() {
    let pathnameStat;
    try {
      pathnameStat = await fs.lstat(directory, { bigint: true });
    } catch (error) {
      fail(`Vimicate host directory is unavailable: ${errorMessage(error)}`);
    }
    if (!pathnameStat.isDirectory() || pathnameStat.isSymbolicLink()) {
      fail("Vimicate host directory is not fixed");
    }
    if ((pathnameStat.mode & 0o077n) !== 0n) {
      fail("Vimicate host directory must be private");
    }
    const canonical = await fs.realpath(directory);
    if (canonical !== directory) {
      fail("Vimicate host directory is not canonical");
    }
    let handle;
    try {
      handle = await fs.open(
        directory,
        fsNative.constants.O_RDONLY
          | fsNative.constants.O_DIRECTORY
          | fsNative.constants.O_NOFOLLOW
      );
      const descriptorStat = await handle.stat({ bigint: true });
      if (!descriptorStat.isDirectory()
          || !sameFileIdentity(pathnameStat, descriptorStat)) {
        fail("Vimicate host directory changed during inspection");
      }
      return descriptorStat;
    } finally {
      await closeQuietly(handle);
    }
  }

  async function requirePinnedDirectory() {
    const current = await inspectDirectory();
    if (!pinnedDirectory) {
      pinnedDirectory = { dev: current.dev, ino: current.ino };
    } else if (!sameFileIdentity(pinnedDirectory, current)) {
      fail("Vimicate authority directory changed");
    }
    return current;
  }

  function requireStateFile(stat, allowRetired = false) {
    if (!stat.isFile() || stat.isSymbolicLink()
        || (stat.nlink !== 1n && !(allowRetired && stat.nlink === 0n))) {
      fail("state path is not a fixed regular file");
    }
    if (exactMode(stat) !== 0o600) fail("state file must use mode 0600");
    if (stat.size > BigInt(byteLimit + 1)) fail("state exceeds its byte bound");
  }

  async function readState() {
    await requirePinnedDirectory();
    let handle;
    try {
      handle = await fs.open(
        file,
        fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW
      );
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      fail(`state path is not a fixed regular file: ${errorMessage(error)}`);
    }
    try {
      // An atomic save can retire this inode before even the first fstat.
      // Validate this opened snapshot, not the lifetime of its directory link.
      const before = await handle.stat({ bigint: true });
      requireStateFile(before, true);
      const bytes = await handle.readFile();
      await requirePinnedDirectory();
      let current;
      try {
        current = await fs.lstat(file, { bigint: true });
      } catch (error) {
        fail(`state path is not a fixed regular file: ${errorMessage(error)}`);
      }
      requireStateFile(current);
      const after = await handle.stat({ bigint: true });
      requireStateFile(after, true);
      if (!sameReadIdentity(before, after) || BigInt(bytes.length) !== before.size) {
        fail("state changed during read");
      }
      if (!sameFileIdentity(current, after) && after.nlink !== 0n) {
        fail("state snapshot was moved instead of atomically replaced");
      }
      // Only unlink's 1→0 ctime transition is permitted above. Content, mode,
      // owner, size and mtime must be unchanged. The fixed path is independently
      // private and regular; the next call opens its successor, with no cache.
      const text = bytes.toString("utf8");
      const serialized = text.endsWith("\n") ? text.slice(0, -1) : text;
      if (Buffer.byteLength(serialized, "utf8") > byteLimit) {
        fail("state exceeds its byte bound");
      }
      try {
        return JSON.parse(serialized);
      } catch {
        fail("state JSON is invalid");
      }
    } finally {
      await closeQuietly(handle);
    }
  }

  async function commitState(value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      fail("state is not JSON serializable");
    }
    if (typeof serialized !== "string"
        || Buffer.byteLength(serialized, "utf8") > byteLimit) {
      fail("state exceeds its byte bound");
    }
    await requirePinnedDirectory();
    // Refuse to replace an unexpected, loose, linked, or malformed target.
    await readState();
    const temporary = path.join(
      directory,
      `.${VIMICATE_NARRATION_STATE_FILENAME}.${process.pid}.`
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
      await handle.writeFile(`${serialized}\n`, "utf8");
      await handle.sync();
      const temporaryStat = await handle.stat({ bigint: true });
      if (!temporaryStat.isFile()
          || temporaryStat.nlink !== 1n
          || exactMode(temporaryStat) !== 0o600) {
        fail("temporary state file is not private");
      }
      await handle.close();
      handle = undefined;
      await requirePinnedDirectory();
      await fs.rename(temporary, file);
      renamed = true;
      await requirePinnedDirectory();
      await readState();
      let directoryHandle;
      try {
        directoryHandle = await fs.open(
          directory,
          fsNative.constants.O_RDONLY
            | fsNative.constants.O_DIRECTORY
            | fsNative.constants.O_NOFOLLOW
        );
        await directoryHandle.sync();
      } catch (error) {
        if (!["EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
      } finally {
        await closeQuietly(directoryHandle);
      }
    } finally {
      await closeQuietly(handle);
      if (!renamed) await fs.unlink(temporary).catch(() => {});
    }
  }

  async function probe() {
    await requirePinnedDirectory();
    const state = await readState();
    return {
      contract: VIMICATE_NARRATION_STATE_STORE_CONTRACT,
      present: state != null,
      bytes: state == null
        ? 0
        : Buffer.byteLength(JSON.stringify(state), "utf8")
    };
  }

  return { file, readState, commitState, probe };
}
