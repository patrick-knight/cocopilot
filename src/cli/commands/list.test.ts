import { formatRepoList, TrackedRepo } from "./list";

describe("formatRepoList", () => {
  it("shows help text when no repos tracked", () => {
    const output = formatRepoList([]);
    expect(output).toContain("No repositories tracked");
    expect(output).toContain("coco init");
  });

  it("formats a table of repositories", () => {
    const repos: TrackedRepo[] = [
      {
        name: "my-app",
        url: "https://github.com/org/my-app",
        workerCount: 3,
        pendingPRs: 2,
      },
      {
        name: "api",
        url: "https://github.com/org/api",
        workerCount: 0,
        pendingPRs: 0,
      },
    ];
    const output = formatRepoList(repos);
    expect(output).toContain("NAME");
    expect(output).toContain("URL");
    expect(output).toContain("WORKERS");
    expect(output).toContain("PRS");
    expect(output).toContain("my-app");
    expect(output).toContain("api");
  });
});
