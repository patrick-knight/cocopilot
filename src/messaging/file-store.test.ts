import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileMessageStore } from "./file-store";
import { CocoMessage, MessageType } from "./types";

function makeMessage(overrides: Partial<CocoMessage> = {}): CocoMessage {
  return {
    id: "test-msg-001",
    type: MessageType.TASK_ASSIGNED,
    from: "chocolatier",
    to: "Snickers",
    payload: { task: "Add tests", branch: "work/Snickers" },
    priority: "normal",
    timestamp: Date.now(),
    ack_required: true,
    ...overrides,
  };
}

describe("FileMessageStore", () => {
  let tmpDir: string;
  let store: FileMessageStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cocopilot-test-"));
    store = new FileMessageStore({ basePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("save", () => {
    it("saves a message as a JSON file in the agent directory", async () => {
      const msg = makeMessage();
      await store.save(msg);

      const filePath = path.join(tmpDir, "Snickers", "test-msg-001.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.id).toBe("test-msg-001");
      expect(content.type).toBe(MessageType.TASK_ASSIGNED);
    });

    it("saves broadcast messages to __broadcast__ directory", async () => {
      const msg = makeMessage({ to: "*", id: "bcast-001" });
      await store.save(msg);

      const filePath = path.join(tmpDir, "__broadcast__", "bcast-001.json");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("creates directories recursively", async () => {
      const msg = makeMessage({ to: "NewAgent", id: "new-001" });
      await store.save(msg);

      const dirExists = fs.existsSync(path.join(tmpDir, "NewAgent"));
      expect(dirExists).toBe(true);
    });
  });

  describe("getPending", () => {
    it("returns pending messages sorted by timestamp", async () => {
      await store.save(makeMessage({ id: "msg-2", timestamp: 200 }));
      await store.save(makeMessage({ id: "msg-1", timestamp: 100 }));
      await store.save(makeMessage({ id: "msg-3", timestamp: 300 }));

      const pending = await store.getPending("Snickers");
      expect(pending).toHaveLength(3);
      expect(pending[0].id).toBe("msg-1");
      expect(pending[1].id).toBe("msg-2");
      expect(pending[2].id).toBe("msg-3");
    });

    it("returns empty array for nonexistent agent", async () => {
      const pending = await store.getPending("NonExistent");
      expect(pending).toEqual([]);
    });

    it("excludes acknowledged messages", async () => {
      await store.save(makeMessage({ id: "msg-1" }));
      await store.save(makeMessage({ id: "msg-2" }));
      await store.acknowledge("Snickers", "msg-1");

      const pending = await store.getPending("Snickers");
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("msg-2");
    });
  });

  describe("acknowledge", () => {
    it("creates an .ack.json file and removes the pending file", async () => {
      const msg = makeMessage({ id: "ack-test" });
      await store.save(msg);

      const result = await store.acknowledge("Snickers", "ack-test");
      expect(result).toBe(true);

      const pendingPath = path.join(tmpDir, "Snickers", "ack-test.json");
      const ackPath = path.join(tmpDir, "Snickers", "ack-test.ack.json");

      expect(fs.existsSync(pendingPath)).toBe(false);
      expect(fs.existsSync(ackPath)).toBe(true);

      const acked = JSON.parse(fs.readFileSync(ackPath, "utf-8"));
      expect(acked.ack_received).toBeDefined();
      expect(typeof acked.ack_received).toBe("number");
    });

    it("returns false for nonexistent message", async () => {
      const result = await store.acknowledge("Snickers", "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("getAcknowledged", () => {
    it("returns only acknowledged messages", async () => {
      await store.save(makeMessage({ id: "msg-1" }));
      await store.save(makeMessage({ id: "msg-2" }));
      await store.acknowledge("Snickers", "msg-1");

      const acked = await store.getAcknowledged("Snickers");
      expect(acked).toHaveLength(1);
      expect(acked[0].id).toBe("msg-1");
    });
  });

  describe("getAll", () => {
    it("returns both pending and acknowledged messages", async () => {
      await store.save(makeMessage({ id: "msg-1", timestamp: 100 }));
      await store.save(makeMessage({ id: "msg-2", timestamp: 200 }));
      await store.acknowledge("Snickers", "msg-1");

      const all = await store.getAll("Snickers");
      expect(all).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("deletes a pending message", async () => {
      await store.save(makeMessage({ id: "del-1" }));
      const result = await store.delete("Snickers", "del-1");
      expect(result).toBe(true);

      const pending = await store.getPending("Snickers");
      expect(pending).toHaveLength(0);
    });

    it("deletes an acknowledged message", async () => {
      await store.save(makeMessage({ id: "del-2" }));
      await store.acknowledge("Snickers", "del-2");
      const result = await store.delete("Snickers", "del-2");
      expect(result).toBe(true);

      const acked = await store.getAcknowledged("Snickers");
      expect(acked).toHaveLength(0);
    });

    it("returns false for nonexistent message", async () => {
      const result = await store.delete("Snickers", "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("removes acknowledged messages older than max age", async () => {
      await store.save(makeMessage({ id: "old-1" }));
      await store.acknowledge("Snickers", "old-1");

      // Manually set the ack timestamp to the past
      const ackPath = path.join(tmpDir, "Snickers", "old-1.ack.json");
      const content = JSON.parse(fs.readFileSync(ackPath, "utf-8"));
      content.ack_received = Date.now() - 100_000; // 100s ago
      fs.writeFileSync(ackPath, JSON.stringify(content));

      const deleted = await store.cleanup(50_000); // Max age 50s
      expect(deleted).toBe(1);
    });

    it("preserves recent acknowledged messages", async () => {
      await store.save(makeMessage({ id: "recent-1" }));
      await store.acknowledge("Snickers", "recent-1");

      const deleted = await store.cleanup(60_000); // Max age 60s
      expect(deleted).toBe(0);
    });

    it("returns 0 when basePath does not exist", async () => {
      const emptyStore = new FileMessageStore({
        basePath: path.join(tmpDir, "nonexistent"),
      });
      const deleted = await emptyStore.cleanup(1000);
      expect(deleted).toBe(0);
    });
  });

  describe("getPendingBroadcasts", () => {
    it("returns pending messages from __broadcast__ directory", async () => {
      await store.save(makeMessage({ id: "bcast-1", to: "*" }));
      await store.save(makeMessage({ id: "bcast-2", to: "*" }));

      const broadcasts = await store.getPendingBroadcasts();
      expect(broadcasts).toHaveLength(2);
    });
  });
});
