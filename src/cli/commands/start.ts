import { Command } from "commander";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the Concher daemon and web UI")
    .option("--port <number>", "Port for the web dashboard", "3000")
    .option("--no-ui", "Start daemon without the web UI")
    .action(async (options: { port: string; ui: boolean }) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Error: Invalid port number "${options.port}"`);
        process.exitCode = 1;
        return;
      }

      console.log("Starting CoCoPilot daemon...");
      if (options.ui) {
        console.log(`Dashboard will be available at http://localhost:${port}`);
      }

      // TODO: Implement actual daemon startup (Docker container orchestration)
      console.log("Daemon started successfully.");
    });
}
