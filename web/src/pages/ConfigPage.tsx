/**
 * Config / Recipe Book Page
 *
 * Settings management UI for CoCoPilot configuration.
 * Supports theme, worker settings, MCP servers, and webhooks.
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../../src/web/components/ThemeToggle.js";

interface McpServer {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

interface Config {
  theme: "light" | "dark" | "system";
  workers: {
    maxConcurrent: number;
    idleTimeout: number;
    defaultModel: string;
  };
  mcpServers: McpServer[];
  daemon: {
    port: number;
    logLevel: string;
  };
}

const VALID_EVENTS = [
  "worker.created",
  "worker.updated",
  "worker.completed",
  "worker.failed",
  "worker.removed",
  "pr.created",
  "pr.merged",
  "ci.failed",
];

export function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New webhook form
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);

  // New MCP server form
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/config").then((res) => res.json()),
      fetch("/api/v1/webhooks").then((res) => res.json()),
    ])
      .then(([configData, webhookData]) => {
        setConfig(configData);
        setWebhooks(Array.isArray(webhookData) ? webhookData : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/v1/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccess("Configuration saved successfully!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAddWebhook = async () => {
    if (!newWebhookUrl || newWebhookEvents.length === 0) {
      setError("URL and at least one event are required");
      return;
    }

    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newWebhookUrl, events: newWebhookEvents }),
      });
      if (!res.ok) throw new Error(await res.text());
      const webhook = await res.json();
      setWebhooks([...webhooks, webhook]);
      setNewWebhookUrl("");
      setNewWebhookEvents([]);
      setSuccess("Webhook added!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setWebhooks(webhooks.filter((w) => w.id !== id));
      setSuccess("Webhook deleted!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/webhooks/${id}/test`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setSuccess("Test webhook sent!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddMcpServer = () => {
    if (!newMcpName || !newMcpCommand || !config) return;
    const newServer: McpServer = {
      name: newMcpName,
      command: newMcpCommand,
      args: newMcpArgs ? newMcpArgs.split(" ") : undefined,
      enabled: true,
    };
    setConfig({
      ...config,
      mcpServers: [...config.mcpServers, newServer],
    });
    setNewMcpName("");
    setNewMcpCommand("");
    setNewMcpArgs("");
    setShowMcpForm(false);
  };

  const handleRemoveMcpServer = (name: string) => {
    if (!config) return;
    setConfig({
      ...config,
      mcpServers: config.mcpServers.filter((s) => s.name !== name),
    });
  };

  const handleToggleMcpServer = (name: string) => {
    if (!config) return;
    setConfig({
      ...config,
      mcpServers: config.mcpServers.map((s) =>
        s.name === name ? { ...s, enabled: !s.enabled } : s
      ),
    });
  };

  const toggleWebhookEvent = (event: string) => {
    setNewWebhookEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-2xl font-bold">
              🍫 CoCoPilot
            </Link>
            <span className="text-muted-foreground">/ Configuration</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              to="/"
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Alerts */}
        {error && (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
            <p className="text-destructive">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-4">
            <p className="text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}

        {/* Theme Settings */}
        <section className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">🎨 Appearance</h2>
          <div className="flex items-center gap-4">
            <label className="text-sm">Theme</label>
            <select
              value={config?.theme || "system"}
              onChange={(e) =>
                setConfig(config ? { ...config, theme: e.target.value as Config["theme"] } : null)
              }
              className="px-3 py-2 border border-border rounded-md bg-background"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
        </section>

        {/* Worker Settings */}
        <section className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">🍫 Worker Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Max Concurrent Workers</label>
              <input
                type="number"
                min={1}
                max={10}
                value={config?.workers.maxConcurrent || 3}
                onChange={(e) =>
                  setConfig(
                    config
                      ? {
                          ...config,
                          workers: {
                            ...config.workers,
                            maxConcurrent: parseInt(e.target.value, 10),
                          },
                        }
                      : null
                  )
                }
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Idle Timeout (minutes)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={config?.workers.idleTimeout || 15}
                onChange={(e) =>
                  setConfig(
                    config
                      ? {
                          ...config,
                          workers: {
                            ...config.workers,
                            idleTimeout: parseInt(e.target.value, 10),
                          },
                        }
                      : null
                  )
                }
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Default Model</label>
              <input
                type="text"
                value={config?.workers.defaultModel || ""}
                onChange={(e) =>
                  setConfig(
                    config
                      ? {
                          ...config,
                          workers: { ...config.workers, defaultModel: e.target.value },
                        }
                      : null
                  )
                }
                placeholder="e.g., claude-sonnet-4"
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
            </div>
          </div>
        </section>

        {/* MCP Servers */}
        <section className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">🔌 MCP Servers</h2>
            <button
              onClick={() => setShowMcpForm(!showMcpForm)}
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              + Add Server
            </button>
          </div>

          {showMcpForm && (
            <div className="bg-muted/50 p-4 rounded-lg mb-4 space-y-3">
              <input
                type="text"
                placeholder="Server name"
                value={newMcpName}
                onChange={(e) => setNewMcpName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
              <input
                type="text"
                placeholder="Command (e.g., npx)"
                value={newMcpCommand}
                onChange={(e) => setNewMcpCommand(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
              <input
                type="text"
                placeholder="Arguments (space-separated)"
                value={newMcpArgs}
                onChange={(e) => setNewMcpArgs(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background"
              />
              <button
                onClick={handleAddMcpServer}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-md"
              >
                Add
              </button>
            </div>
          )}

          {config?.mcpServers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No MCP servers configured.</p>
          ) : (
            <div className="space-y-2">
              {config?.mcpServers.map((server) => (
                <div
                  key={server.name}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-md"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={() => handleToggleMcpServer(server.name)}
                      className="w-4 h-4"
                    />
                    <div>
                      <span className="font-medium">{server.name}</span>
                      <span className="text-sm text-muted-foreground ml-2">
                        {server.command} {server.args?.join(" ")}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMcpServer(server.name)}
                    className="text-destructive hover:text-destructive/80 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Webhooks */}
        <section className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">🔔 Webhooks</h2>

          {/* Add webhook form */}
          <div className="bg-muted/50 p-4 rounded-lg mb-4 space-y-3">
            <input
              type="url"
              placeholder="Webhook URL (https://...)"
              value={newWebhookUrl}
              onChange={(e) => setNewWebhookUrl(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md bg-background"
            />
            <div className="flex flex-wrap gap-2">
              {VALID_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={newWebhookEvents.includes(event)}
                    onChange={() => toggleWebhookEvent(event)}
                  />
                  {event}
                </label>
              ))}
            </div>
            <button
              onClick={handleAddWebhook}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md"
            >
              Add Webhook
            </button>
          </div>

          {/* Webhook list */}
          {webhooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No webhooks registered.</p>
          ) : (
            <div className="space-y-2">
              {webhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-md"
                >
                  <div>
                    <span className="font-mono text-sm">{webhook.url}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {webhook.events.map((event) => (
                        <span
                          key={event}
                          className="text-xs bg-muted px-2 py-0.5 rounded"
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTestWebhook(webhook.id)}
                      className="text-sm px-2 py-1 bg-muted hover:bg-muted/80 rounded"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleDeleteWebhook(webhook.id)}
                      className="text-destructive hover:text-destructive/80 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "💾 Save Configuration"}
          </button>
        </div>
      </main>
    </div>
  );
}

export default ConfigPage;
