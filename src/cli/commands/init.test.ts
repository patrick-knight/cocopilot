import { isValidGitHubUrl, repoNameFromUrl } from "./init";

describe("isValidGitHubUrl", () => {
  it("accepts valid GitHub HTTPS URLs", () => {
    expect(isValidGitHubUrl("https://github.com/owner/repo")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/owner/repo.git")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/my-org/my-repo")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/user123/project.name")).toBe(
      true,
    );
  });

  it("accepts http URLs", () => {
    expect(isValidGitHubUrl("http://github.com/owner/repo")).toBe(true);
  });

  it("accepts www prefix", () => {
    expect(isValidGitHubUrl("https://www.github.com/owner/repo")).toBe(true);
  });

  it("rejects non-GitHub URLs", () => {
    expect(isValidGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
    expect(isValidGitHubUrl("https://bitbucket.org/owner/repo")).toBe(false);
  });

  it("rejects invalid formats", () => {
    expect(isValidGitHubUrl("not-a-url")).toBe(false);
    expect(isValidGitHubUrl("github.com/owner/repo")).toBe(false);
    expect(isValidGitHubUrl("https://github.com/owner")).toBe(false);
    expect(isValidGitHubUrl("https://github.com/")).toBe(false);
  });
});

describe("repoNameFromUrl", () => {
  it("extracts repo name from URL", () => {
    expect(repoNameFromUrl("https://github.com/owner/my-project")).toBe(
      "my-project",
    );
  });

  it("strips .git suffix", () => {
    expect(repoNameFromUrl("https://github.com/owner/my-project.git")).toBe(
      "my-project",
    );
  });
});
