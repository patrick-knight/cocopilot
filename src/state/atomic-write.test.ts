import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  atomicWriteFile,
  atomicWriteFileSync,
  readJsonFile,
  writeJsonFile,
  writeJsonFileSync,
} from "./atomic-write";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coco-test-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("writes file content correctly", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "hello world");
    const content = await fs.promises.readFile(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  it("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "test.txt");
    await atomicWriteFile(filePath, "nested");
    const content = await fs.promises.readFile(filePath, "utf-8");
    expect(content).toBe("nested");
  });

  it("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "first");
    await atomicWriteFile(filePath, "second");
    const content = await fs.promises.readFile(filePath, "utf-8");
    expect(content).toBe("second");
  });

  it("does not leave temp files on success", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await atomicWriteFile(filePath, "data");
    const files = await fs.promises.readdir(tmpDir);
    expect(files).toEqual(["test.txt"]);
  });
});

describe("atomicWriteFileSync", () => {
  it("writes file content correctly", () => {
    const filePath = path.join(tmpDir, "sync.txt");
    atomicWriteFileSync(filePath, "sync content");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toBe("sync content");
  });

  it("creates parent directories", () => {
    const filePath = path.join(tmpDir, "x", "y", "sync.txt");
    atomicWriteFileSync(filePath, "deep");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toBe("deep");
  });
});

describe("readJsonFile", () => {
  it("returns parsed JSON", async () => {
    const filePath = path.join(tmpDir, "data.json");
    await fs.promises.writeFile(filePath, '{"key": "value"}');
    const result = await readJsonFile<{ key: string }>(filePath);
    expect(result).toEqual({ key: "value" });
  });

  it("returns undefined for missing file", async () => {
    const result = await readJsonFile(path.join(tmpDir, "nope.json"));
    expect(result).toBeUndefined();
  });

  it("throws on malformed JSON", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    await fs.promises.writeFile(filePath, "{not json");
    await expect(readJsonFile(filePath)).rejects.toThrow();
  });
});

describe("writeJsonFile", () => {
  it("writes pretty-printed JSON with trailing newline", async () => {
    const filePath = path.join(tmpDir, "out.json");
    await writeJsonFile(filePath, { a: 1, b: [2, 3] });
    const raw = await fs.promises.readFile(filePath, "utf-8");
    expect(raw).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
  });

  it("round-trips with readJsonFile", async () => {
    const filePath = path.join(tmpDir, "round.json");
    const data = { hello: "world", numbers: [1, 2, 3] };
    await writeJsonFile(filePath, data);
    const result = await readJsonFile(filePath);
    expect(result).toEqual(data);
  });
});

describe("writeJsonFileSync", () => {
  it("writes valid JSON synchronously", () => {
    const filePath = path.join(tmpDir, "sync.json");
    writeJsonFileSync(filePath, { sync: true });
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ sync: true });
  });
});
