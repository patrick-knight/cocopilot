import { Command } from "commander";
import { startDaemon } from "../daemon.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the Concher daemon and web UI")
    .option("--port <number>", "Port for the web dashboard", "3000")
    .option("--no-ui", "Start daemon without the web UI")
    .option("--foreground", "Run in the foreground instead of daemonizing")
    .action(async (options: { port: string; ui: boolean; foreground: boolean }) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Error: Invalid port number "${options.port}"`);
        process.exitCode = 1;
        return;
      }

      try {
        console.log("Starting CoCoPilot daemon...");
        if (options.ui) {
          console.log(`Dashboard will be available at http://localhost:${port}`);
        }

        await startDaemon(options.foreground);

        console.log("Daemon started successfully.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT") || message.includes("docker")) {
          console.error("Error: Docker is not running. Start Docker Desktop and try again.");
        } else if (message.includes("EADDRINUSE")) {
          console.error(`Error: Port ${port} is already in use. Choose a different port with --port.`);
        } else if (message.includes("EACCES")) {
          console.error("Error: Permission denied. Try running with elevated privileges.");
        } else {
          console.error(`Error: Failed to start daemon — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
