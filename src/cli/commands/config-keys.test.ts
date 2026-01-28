import { createProgram } from "../coco.js";

describe("config keys CLI", () => {
  it("registers the config command", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("config");
  });

  it("has keys subcommand under config", () => {
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config")!;
    const subNames = config.commands.map((c) => c.name());
    expect(subNames).toContain("keys");
  });

  it("has set and list subcommands under keys", () => {
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config")!;
    const keys = config.commands.find((c) => c.name() === "keys")!;
    const subNames = keys.commands.map((c) => c.name());
    expect(subNames).toContain("set");
    expect(subNames).toContain("list");
  });

  describe("set command", () => {
    it("requires provider and key arguments", () => {
      const program = createProgram();
      const config = program.commands.find((c) => c.name() === "config")!;
      const keys = config.commands.find((c) => c.name() === "keys")!;
      const set = keys.commands.find((c) => c.name() === "set")!;

      const args = set.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe("provider");
      expect(args[1].name()).toBe("key");
    });

    it("has --skip-validation option", () => {
      const program = createProgram();
      const config = program.commands.find((c) => c.name() === "config")!;
      const keys = config.commands.find((c) => c.name() === "keys")!;
      const set = keys.commands.find((c) => c.name() === "set")!;

      const optionNames = set.options.map((o) => o.long);
      expect(optionNames).toContain("--skip-validation");
    });
  });
});
