import { ContainerManager, LogOptions } from "./container-manager";
import {
  ContainerConfig,
  ContainerType,
  ContainerStatus,
  LABELS,
  containerName,
  DEFAULT_RESOURCE_LIMITS,
} from "./types";

// --- Mock dockerode ---

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockRemove = jest.fn().mockResolvedValue(undefined);
const mockInspect = jest.fn();
const mockLogs = jest.fn();

const mockContainer = {
  id: "abc123def456",
  start: mockStart,
  stop: mockStop,
  remove: mockRemove,
  inspect: mockInspect,
  logs: mockLogs,
};

const mockCreateContainer = jest.fn().mockResolvedValue(mockContainer);
const mockListContainers = jest.fn().mockResolvedValue([]);
const mockGetContainer = jest.fn().mockReturnValue(mockContainer);
const mockPing = jest.fn().mockResolvedValue("OK");
const mockInfo = jest.fn().mockResolvedValue({ ServerVersion: "27.5.0" });

jest.mock("dockerode", () => {
  return jest.fn().mockImplementation(() => ({
    createContainer: mockCreateContainer,
    listContainers: mockListContainers,
    getContainer: mockGetContainer,
    ping: mockPing,
    info: mockInfo,
  }));
});

describe("ContainerManager", () => {
  let manager: ContainerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ContainerManager();

    // Default inspect response
    mockInspect.mockResolvedValue({
      Id: "abc123def456",
      Name: "/cocopilot-truffle-Snickers",
      Config: {
        Image: "cocopilot-agent:latest",
        Labels: {
          [LABELS.MANAGED_BY]: "true",
          [LABELS.CONTAINER_TYPE]: ContainerType.TRUFFLE,
          [LABELS.WORKER_NAME]: "Snickers",
        },
      },
      State: { Status: "running" },
      Created: "2026-01-27T10:00:00Z",
    });
  });

  describe("spawn", () => {
    const truffleConfig: ContainerConfig = {
      type: ContainerType.TRUFFLE,
      image: "cocopilot-agent:latest",
      name: "Snickers",
      volumes: [
        { hostPath: "/home/user/worktrees/Snickers", containerPath: "/workspace" },
        { hostPath: "/home/user/messages", containerPath: "/messages" },
      ],
      env: { AGENT_NAME: "Snickers", TASK: "Add unit tests" },
    };

    it("creates and starts a truffle container", async () => {
      const info = await manager.spawn(truffleConfig);

      expect(mockCreateContainer).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(info.id).toBe("abc123def456");
      expect(info.name).toBe("cocopilot-truffle-Snickers");
      expect(info.type).toBe(ContainerType.TRUFFLE);
      expect(info.workerName).toBe("Snickers");
      expect(info.status).toBe(ContainerStatus.RUNNING);
    });

    it("sets the correct container name", async () => {
      await manager.spawn(truffleConfig);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.name).toBe("cocopilot-truffle-Snickers");
    });

    it("applies CoCoPilot labels", async () => {
      await manager.spawn(truffleConfig);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Labels[LABELS.MANAGED_BY]).toBe("true");
      expect(createOpts.Labels[LABELS.CONTAINER_TYPE]).toBe(ContainerType.TRUFFLE);
      expect(createOpts.Labels[LABELS.WORKER_NAME]).toBe("Snickers");
    });

    it("configures volume binds", async () => {
      await manager.spawn(truffleConfig);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.HostConfig.Binds).toEqual([
        "/home/user/worktrees/Snickers:/workspace:rw",
        "/home/user/messages:/messages:rw",
      ]);
    });

    it("supports read-only volume mounts", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        volumes: [
          { hostPath: "/repo", containerPath: "/workspace", readOnly: true },
        ],
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.HostConfig.Binds).toEqual(["/repo:/workspace:ro"]);
    });

    it("sets environment variables", async () => {
      await manager.spawn(truffleConfig);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain("AGENT_NAME=Snickers");
      expect(createOpts.Env).toContain("TASK=Add unit tests");
    });

    it("applies default resource limits", async () => {
      await manager.spawn(truffleConfig);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.HostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
      expect(createOpts.HostConfig.NanoCpus).toBe(2e9);
    });

    it("applies custom resource limits", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        resources: { memory: "512m", cpus: "0.5" },
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.HostConfig.Memory).toBe(512 * 1024 * 1024);
      expect(createOpts.HostConfig.NanoCpus).toBe(0.5e9);
    });

    it("throws if truffle has no name", async () => {
      const config: ContainerConfig = {
        type: ContainerType.TRUFFLE,
        image: "cocopilot-agent:latest",
      };

      await expect(manager.spawn(config)).rejects.toThrow(
        "Truffle containers require a worker name.",
      );
    });

    it("sets custom command when provided", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        cmd: ["node", "custom-agent.js"],
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Cmd).toEqual(["node", "custom-agent.js"]);
    });

    it("configures network when provided", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        networkName: "cocopilot-net",
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.NetworkingConfig).toEqual({
        EndpointsConfig: { "cocopilot-net": {} },
      });
    });

    it("merges custom labels with CoCoPilot labels", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        labels: { "custom.label": "value" },
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.Labels[LABELS.MANAGED_BY]).toBe("true");
      expect(createOpts.Labels["custom.label"]).toBe("value");
    });

    it("spawns a chocolatier container without a worker name", async () => {
      mockInspect.mockResolvedValueOnce({
        Id: "choc123",
        Name: "/cocopilot-chocolatier",
        Config: {
          Image: "cocopilot-agent:latest",
          Labels: {
            [LABELS.MANAGED_BY]: "true",
            [LABELS.CONTAINER_TYPE]: ContainerType.CHOCOLATIER,
          },
        },
        State: { Status: "running" },
        Created: "2026-01-27T10:00:00Z",
      });

      const info = await manager.spawn({
        type: ContainerType.CHOCOLATIER,
        image: "cocopilot-agent:latest",
      });

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.name).toBe("cocopilot-chocolatier");
      expect(info.type).toBe(ContainerType.CHOCOLATIER);
    });

    it("sets autoRemove when configured", async () => {
      const config: ContainerConfig = {
        ...truffleConfig,
        autoRemove: true,
      };

      await manager.spawn(config);

      const createOpts = mockCreateContainer.mock.calls[0][0];
      expect(createOpts.HostConfig.AutoRemove).toBe(true);
    });
  });

  describe("stop", () => {
    it("stops a container with default timeout", async () => {
      await manager.stop("abc123");

      expect(mockGetContainer).toHaveBeenCalledWith("abc123");
      expect(mockStop).toHaveBeenCalledWith({ t: 10 });
    });

    it("stops a container with custom timeout", async () => {
      await manager.stop("abc123", 30);

      expect(mockStop).toHaveBeenCalledWith({ t: 30 });
    });
  });

  describe("remove", () => {
    it("removes a container", async () => {
      await manager.remove("abc123");

      expect(mockGetContainer).toHaveBeenCalledWith("abc123");
      expect(mockRemove).toHaveBeenCalledWith({ force: false });
    });

    it("force-removes a container", async () => {
      await manager.remove("abc123", true);

      expect(mockRemove).toHaveBeenCalledWith({ force: true });
    });
  });

  describe("destroy", () => {
    it("stops and removes a container", async () => {
      await manager.destroy("abc123");

      expect(mockStop).toHaveBeenCalledWith({ t: 10 });
      expect(mockRemove).toHaveBeenCalledWith({ force: true });
    });

    it("handles already-stopped containers gracefully", async () => {
      mockStop.mockRejectedValueOnce(
        new Error("container abc123 is not running"),
      );

      await manager.destroy("abc123");

      expect(mockRemove).toHaveBeenCalledWith({ force: true });
    });

    it("rethrows non-'not running' stop errors", async () => {
      mockStop.mockRejectedValueOnce(new Error("Docker daemon unreachable"));

      await expect(manager.destroy("abc123")).rejects.toThrow(
        "Docker daemon unreachable",
      );
    });
  });

  describe("list", () => {
    const mockContainerData = [
      {
        Id: "abc123",
        Names: ["/cocopilot-truffle-Snickers"],
        Image: "cocopilot-agent:latest",
        State: "running",
        Created: 1706349600,
        Labels: {
          [LABELS.MANAGED_BY]: "true",
          [LABELS.CONTAINER_TYPE]: ContainerType.TRUFFLE,
          [LABELS.WORKER_NAME]: "Snickers",
        },
      },
      {
        Id: "def456",
        Names: ["/cocopilot-chocolatier"],
        Image: "cocopilot-agent:latest",
        State: "running",
        Created: 1706349600,
        Labels: {
          [LABELS.MANAGED_BY]: "true",
          [LABELS.CONTAINER_TYPE]: ContainerType.CHOCOLATIER,
        },
      },
    ];

    it("lists all CoCoPilot containers", async () => {
      mockListContainers.mockResolvedValueOnce(mockContainerData);

      const containers = await manager.list();

      expect(mockListContainers).toHaveBeenCalledWith({
        all: true,
        filters: {
          label: [`${LABELS.MANAGED_BY}=true`],
        },
      });
      expect(containers).toHaveLength(2);
      expect(containers[0].name).toBe("cocopilot-truffle-Snickers");
      expect(containers[0].type).toBe(ContainerType.TRUFFLE);
      expect(containers[0].workerName).toBe("Snickers");
      expect(containers[1].name).toBe("cocopilot-chocolatier");
      expect(containers[1].type).toBe(ContainerType.CHOCOLATIER);
    });

    it("filters by container type", async () => {
      mockListContainers.mockResolvedValueOnce([mockContainerData[0]]);

      await manager.list({ type: ContainerType.TRUFFLE });

      const filters = mockListContainers.mock.calls[0][0].filters;
      expect(filters.label).toContain(
        `${LABELS.CONTAINER_TYPE}=${ContainerType.TRUFFLE}`,
      );
    });

    it("filters by status", async () => {
      mockListContainers.mockResolvedValueOnce([]);

      await manager.list({ status: [ContainerStatus.RUNNING] });

      const filters = mockListContainers.mock.calls[0][0].filters;
      expect(filters.status).toEqual(["running"]);
    });

    it("returns empty array when no containers exist", async () => {
      mockListContainers.mockResolvedValueOnce([]);

      const containers = await manager.list();

      expect(containers).toEqual([]);
    });
  });

  describe("inspect", () => {
    it("returns container info", async () => {
      const info = await manager.inspect("abc123");

      expect(info.id).toBe("abc123def456");
      expect(info.name).toBe("cocopilot-truffle-Snickers");
      expect(info.type).toBe(ContainerType.TRUFFLE);
      expect(info.workerName).toBe("Snickers");
      expect(info.status).toBe(ContainerStatus.RUNNING);
      expect(info.image).toBe("cocopilot-agent:latest");
    });

    it("maps exited state correctly", async () => {
      mockInspect.mockResolvedValueOnce({
        Id: "abc123",
        Name: "/cocopilot-truffle-KitKat",
        Config: {
          Image: "cocopilot-agent:latest",
          Labels: {
            [LABELS.MANAGED_BY]: "true",
            [LABELS.CONTAINER_TYPE]: ContainerType.TRUFFLE,
            [LABELS.WORKER_NAME]: "KitKat",
          },
        },
        State: { Status: "exited" },
        Created: "2026-01-27T10:00:00Z",
      });

      const info = await manager.inspect("abc123");

      expect(info.status).toBe(ContainerStatus.EXITED);
    });
  });

  describe("logs", () => {
    it("returns container logs as a string", async () => {
      mockLogs.mockResolvedValueOnce(Buffer.from("line1\nline2\nline3"));

      const output = await manager.logs("abc123");

      expect(output).toBe("line1\nline2\nline3");
      expect(mockLogs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: undefined,
        since: undefined,
        timestamps: false,
        follow: false,
      });
    });

    it("supports tail option", async () => {
      mockLogs.mockResolvedValueOnce(Buffer.from("last line"));

      await manager.logs("abc123", { tail: 1 });

      expect(mockLogs).toHaveBeenCalledWith(
        expect.objectContaining({ tail: 1 }),
      );
    });

    it("supports since option", async () => {
      mockLogs.mockResolvedValueOnce(Buffer.from(""));

      await manager.logs("abc123", { since: 1706349600 });

      expect(mockLogs).toHaveBeenCalledWith(
        expect.objectContaining({ since: 1706349600 }),
      );
    });

    it("supports timestamps option", async () => {
      mockLogs.mockResolvedValueOnce(Buffer.from("2026-01-27T10:00:00Z line1"));

      await manager.logs("abc123", { timestamps: true });

      expect(mockLogs).toHaveBeenCalledWith(
        expect.objectContaining({ timestamps: true }),
      );
    });

    it("handles string response from dockerode", async () => {
      mockLogs.mockResolvedValueOnce("string log output");

      const output = await manager.logs("abc123");

      expect(output).toBe("string log output");
    });

    it("allows disabling stdout or stderr", async () => {
      mockLogs.mockResolvedValueOnce(Buffer.from("stderr only"));

      await manager.logs("abc123", { stdout: false, stderr: true });

      expect(mockLogs).toHaveBeenCalledWith(
        expect.objectContaining({ stdout: false, stderr: true }),
      );
    });
  });

  describe("ping", () => {
    it("returns true when Docker is reachable", async () => {
      const result = await manager.ping();

      expect(result).toBe(true);
    });

    it("returns false when Docker is unreachable", async () => {
      mockPing.mockRejectedValueOnce(new Error("connection refused"));

      const result = await manager.ping();

      expect(result).toBe(false);
    });
  });

  describe("info", () => {
    it("returns Docker daemon info", async () => {
      const result = await manager.info();

      expect(result).toEqual({ ServerVersion: "27.5.0" });
    });
  });
});

describe("types", () => {
  describe("containerName", () => {
    it("creates truffle container name with worker name", () => {
      expect(containerName(ContainerType.TRUFFLE, "Snickers")).toBe(
        "cocopilot-truffle-Snickers",
      );
    });

    it("creates non-truffle container name", () => {
      expect(containerName(ContainerType.CHOCOLATIER)).toBe(
        "cocopilot-chocolatier",
      );
      expect(containerName(ContainerType.TEMPERER)).toBe(
        "cocopilot-temperer",
      );
      expect(containerName(ContainerType.GANACHE)).toBe(
        "cocopilot-ganache",
      );
    });

    it("ignores name for non-truffle types", () => {
      expect(containerName(ContainerType.CHOCOLATIER, "ignored")).toBe(
        "cocopilot-chocolatier",
      );
    });
  });
});
