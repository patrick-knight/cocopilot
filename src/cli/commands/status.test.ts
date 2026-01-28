import { formatStatus, SystemStatus } from "./status";

describe("formatStatus", () => {
  it("shows 'Not running' when daemon is stopped", () => {
    const status: SystemStatus = {
      daemon: { running: false },
      repositories: [],
      containers: 0,
      memoryUsage: "0 B",
      cpuUsage: "0%",
    };
    const output = formatStatus(status);
    expect(output).toContain("Not running");
    expect(output).toContain("None tracked");
  });

  it("shows daemon info when running", () => {
    const status: SystemStatus = {
      daemon: {
        running: true,
        pid: 12345,
        dashboardUrl: "http://localhost:3000",
        uptime: "2h 34m",
      },
      repositories: [],
      containers: 0,
      memoryUsage: "0 B",
      cpuUsage: "0%",
    };
    const output = formatStatus(status);
    expect(output).toContain("Running (PID 12345)");
    expect(output).toContain("http://localhost:3000");
    expect(output).toContain("2h 34m");
  });

  it("lists repositories with worker and PR counts", () => {
    const status: SystemStatus = {
      daemon: { running: true, pid: 1 },
      repositories: [
        { name: "my-app", workerCount: 3, pendingPRs: 2 },
        { name: "api-service", workerCount: 1, pendingPRs: 0 },
      ],
      containers: 4,
      memoryUsage: "1.2 GB / 4 GB",
      cpuUsage: "22%",
    };
    const output = formatStatus(status);
    expect(output).toContain("Repositories (2):");
    expect(output).toContain("my-app");
    expect(output).toContain("3 workers");
    expect(output).toContain("2 PRs pending");
    expect(output).toContain("api-service");
    expect(output).toContain("1 worker");
    expect(output).toContain("0 PRs pending");
    expect(output).toContain("4 running");
  });

  it("uses singular form for 1 worker and 1 PR", () => {
    const status: SystemStatus = {
      daemon: { running: true, pid: 1 },
      repositories: [{ name: "repo", workerCount: 1, pendingPRs: 1 }],
      containers: 1,
      memoryUsage: "512 MB",
      cpuUsage: "10%",
    };
    const output = formatStatus(status);
    expect(output).toContain("1 worker,");
    expect(output).toContain("1 PR pending");
  });
});
