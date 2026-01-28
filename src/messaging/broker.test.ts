import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MessageBroker } from "./broker";
import { FileMessageStore } from "./file-store";
import { CocoMessage, MessageType } from "./types";

/**
 * These tests focus on the FileMessageStore-backed parts of the broker.
 * Redis integration tests require a running Redis instance and are
 * better suited for integration test suites.
 */

describe("MessageBroker (file persistence)", () => {
  let tmpDir: string;
  let store: FileMessageStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cocopilot-broker-test-"));
    store = new FileMessageStore({ basePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("FileMessageStore round-trip", () => {
    it("save → getPending → acknowledge → getAcknowledged", async () => {
      const msg: CocoMessage = {
        id: "round-trip-1",
        type: MessageType.NUDGE,
        from: "chocolatier",
        to: "Snickers",
        payload: { hint: "Check the logs" },
        priority: "high",
        timestamp: Date.now(),
        ack_required: true,
      };

      await store.save(msg);

      // Should appear in pending
      let pending = await store.getPending("Snickers");
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe(MessageType.NUDGE);

      // Acknowledge
      const ackResult = await store.acknowledge("Snickers", "round-trip-1");
      expect(ackResult).toBe(true);

      // Should no longer be pending
      pending = await store.getPending("Snickers");
      expect(pending).toHaveLength(0);

      // Should appear in acknowledged
      const acked = await store.getAcknowledged("Snickers");
      expect(acked).toHaveLength(1);
      expect(acked[0].ack_received).toBeDefined();
    });
  });

  describe("message payload types", () => {
    it("preserves TASK_ASSIGNED payload", async () => {
      const msg: CocoMessage = {
        id: "payload-1",
        type: MessageType.TASK_ASSIGNED,
        from: "chocolatier",
        to: "KitKat",
        payload: {
          task: "Implement user auth",
          branch: "work/KitKat",
          model: "claude-sonnet-4-5",
          priority: "high",
        },
        priority: "high",
        timestamp: Date.now(),
        ack_required: true,
      };

      await store.save(msg);
      const [retrieved] = await store.getPending("KitKat");
      expect(retrieved.payload).toEqual(msg.payload);
    });

    it("preserves PR_CREATED payload", async () => {
      const msg: CocoMessage = {
        id: "payload-2",
        type: MessageType.PR_CREATED,
        from: "Twix",
        to: "temperer",
        payload: {
          pr_number: 42,
          pr_url: "https://github.com/org/repo/pull/42",
          title: "feat: add user auth",
          branch: "work/Twix",
        },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      };

      await store.save(msg);
      const [retrieved] = await store.getPending("temperer");
      expect(retrieved.payload).toEqual(msg.payload);
    });

    it("preserves CI_FAILED payload", async () => {
      const msg: CocoMessage = {
        id: "payload-3",
        type: MessageType.CI_FAILED,
        from: "temperer",
        to: "chocolatier",
        payload: {
          pr_number: 42,
          pr_url: "https://github.com/org/repo/pull/42",
          failure_summary: "Test suite failed: 3 tests",
          workflow_url: "https://github.com/org/repo/actions/runs/123",
        },
        priority: "high",
        timestamp: Date.now(),
        ack_required: true,
      };

      await store.save(msg);
      const [retrieved] = await store.getPending("chocolatier");
      expect(retrieved.payload).toEqual(msg.payload);
    });
  });

  describe("broadcast persistence", () => {
    it("stores and retrieves broadcast messages", async () => {
      const msg: CocoMessage = {
        id: "bcast-1",
        type: MessageType.BROADCAST,
        from: "chocolatier",
        to: "*",
        payload: { message: "System maintenance in 5 minutes", level: "warning" },
        priority: "high",
        timestamp: Date.now(),
        ack_required: false,
      };

      await store.save(msg);
      const broadcasts = await store.getPendingBroadcasts();
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].type).toBe(MessageType.BROADCAST);
    });
  });
});
