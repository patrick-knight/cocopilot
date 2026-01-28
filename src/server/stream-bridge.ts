/**
 * Stream Bridge — wires Redis agent output streams to Socket.IO dynamic namespaces.
 *
 * For each connected client requesting `/stream/:agentName`, subscribes to the
 * Redis channel `cocopilot:stream:{agentName}` and forwards output lines as
 * `agent_output` events. Unsubscribes when the client disconnects.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { RedisMessageBus } from "../messaging/index.js";
import { streamChannel } from "../messaging/types.js";

/**
 * Set up the dynamic `/stream/:agentName` namespace on the Socket.IO server.
 * Returns a cleanup function to remove the namespace listeners.
 */
export function createStreamBridge(
  io: SocketIOServer,
  redisBus: RedisMessageBus,
): () => void {
  const streamNamespace = io.of(/^\/stream\/[\w.-]+$/);

  streamNamespace.on("connection", (socket) => {
    // Extract agent name from the namespace path: /stream/<agentName>
    const nsp = socket.nsp.name;
    const agentName = nsp.replace("/stream/", "");
    const channel = streamChannel(agentName);

    // Create a handler that forwards Redis messages as socket events
    const handler = (message: unknown): void => {
      socket.emit("agent_output", message);
    };

    // Subscribe to the Redis channel
    redisBus.subscribeChannel(channel, handler as never).catch(() => {
      // Non-fatal: Redis may not be ready
    });

    // Clean up on disconnect
    socket.on("disconnect", () => {
      redisBus.unsubscribeChannel(channel).catch(() => {});
    });
  });

  return () => {
    streamNamespace.disconnectSockets(true);
  };
}
