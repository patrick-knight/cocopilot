import { scopedAgentName, scopedWorkerName, isScopedName, bareNameFromScoped } from "./scoped-name";

describe("scopedAgentName", () => {
  it("produces type:repoName format", () => {
    expect(scopedAgentName("temperer", "my-app")).toBe("temperer:my-app");
    expect(scopedAgentName("chocolatier", "widgets")).toBe(
      "chocolatier:widgets",
    );
    expect(scopedAgentName("enrober", "oura-cal")).toBe("enrober:oura-cal");
  });

  it("throws when repoName is empty", () => {
    expect(() => scopedAgentName("temperer", "")).toThrow(/repoName is required/);
  });

  it("throws when repoName is whitespace-only", () => {
    expect(() => scopedAgentName("temperer", "   ")).toThrow(
      /repoName is required/,
    );
  });

  it("includes the type and repoName in the error message", () => {
    expect(() => scopedAgentName("enrober", "")).toThrow(/enrober/);
  });
});

describe("scopedWorkerName", () => {
  it("produces workerName:repoName format", () => {
    expect(scopedWorkerName("Snickers", "my-app")).toBe("Snickers:my-app");
    expect(scopedWorkerName("KitKat", "widgets")).toBe("KitKat:widgets");
  });

  it("throws when repoName is empty", () => {
    expect(() => scopedWorkerName("Snickers", "")).toThrow(
      /repoName is required/,
    );
  });

  it("throws when repoName is whitespace-only", () => {
    expect(() => scopedWorkerName("Snickers", "  ")).toThrow(
      /repoName is required/,
    );
  });

  it("includes the worker name in the error message", () => {
    expect(() => scopedWorkerName("Snickers", "")).toThrow(/Snickers/);
  });
});

describe("isScopedName", () => {
  it("returns true for scoped names", () => {
    expect(isScopedName("temperer:my-app")).toBe(true);
    expect(isScopedName("Snickers:widgets")).toBe(true);
    expect(isScopedName("security-reviewer:oura-cal")).toBe(true);
  });

  it("returns false for unscoped names", () => {
    expect(isScopedName("temperer")).toBe(false);
    expect(isScopedName("Snickers")).toBe(false);
    expect(isScopedName("")).toBe(false);
  });
});

describe("bareNameFromScoped", () => {
  it("extracts the bare name from a scoped name", () => {
    expect(bareNameFromScoped("Snickers:my-app")).toBe("Snickers");
    expect(bareNameFromScoped("temperer:widgets")).toBe("temperer");
    expect(bareNameFromScoped("security-reviewer:oura-cal")).toBe(
      "security-reviewer",
    );
  });

  it("returns the name as-is when not scoped", () => {
    expect(bareNameFromScoped("Snickers")).toBe("Snickers");
    expect(bareNameFromScoped("temperer")).toBe("temperer");
  });

  it("handles empty string", () => {
    expect(bareNameFromScoped("")).toBe("");
  });
});
