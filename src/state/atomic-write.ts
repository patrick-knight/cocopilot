/**
 * Atomic file write utilities.
 *
 * Prevents corruption by writing to a temporary file in the same directory
 * and then renaming it into place. `rename(2)` is atomic on POSIX when
 * source and destination are on the same filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Write `data` to `filePath` atomically.
 *
 * 1. Write to a sibling temp file (same directory → same filesystem).
 * 2. fsync the file descriptor to flush to disk.
 * 3. Rename the temp file over the target.
 *
 * If any step fails the temp file is cleaned up and the original target is
 * left untouched.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp-${randomUUID()}`);

  let fd: fs.promises.FileHandle | undefined;
  try {
    fd = await fs.promises.open(tmpPath, "w", 0o644);
    await fd.writeFile(data, "utf-8");
    await fd.sync();
    await fd.close();
    fd = undefined;

    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    if (fd) {
      await fd.close().catch(() => {});
    }
    // Best-effort cleanup of the temp file.
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous variant of atomicWriteFile for use during shutdown or signal
 * handlers where async code cannot run.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp-${randomUUID()}`);

  let fd: number | undefined;
  try {
    fd = fs.openSync(tmpPath, "w", 0o644);
    fs.writeFileSync(fd, data, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

/**
 * Read and parse a JSON file, returning `undefined` if the file does not
 * exist.  Throws on malformed JSON.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

/**
 * Write a value as pretty-printed JSON atomically.
 */
export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value, null, 2) + "\n";
  await atomicWriteFile(filePath, json);
}

/**
 * Synchronous variant of writeJsonFile.
 */
export function writeJsonFileSync(filePath: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2) + "\n";
  atomicWriteFileSync(filePath, json);
}
