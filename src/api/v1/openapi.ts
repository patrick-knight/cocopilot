/**
 * OpenAPI documentation serving.
 *
 * GET /api/openapi.json — OpenAPI spec in JSON
 * GET /api/openapi.yaml — OpenAPI spec in YAML
 * GET /api/docs         — Swagger UI
 */

import { Router } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openapiRoutes(): Router {
  const router = Router();

  // Load OpenAPI spec
  const specPath = path.join(__dirname, "..", "openapi.yaml");
  let specYaml = "";
  let specJson = {};

  try {
    if (fs.existsSync(specPath)) {
      specYaml = fs.readFileSync(specPath, "utf-8");
      // Simple YAML to JSON conversion for basic OpenAPI spec
      specJson = parseSimpleYaml(specYaml);
    }
  } catch (err) {
    console.warn("[OpenAPI] Failed to load spec:", err);
  }

  // GET /openapi.json — JSON format
  router.get("/openapi.json", (_req, res) => {
    if (!specYaml) {
      res.status(404).json({ error: "OpenAPI spec not found" });
      return;
    }
    res.json(specJson);
  });

  // GET /openapi.yaml — YAML format
  router.get("/openapi.yaml", (_req, res) => {
    if (!specYaml) {
      res.status(404).send("OpenAPI spec not found");
      return;
    }
    res.setHeader("Content-Type", "text/yaml");
    res.send(specYaml);
  });

  // GET /docs — Swagger UI
  router.get("/docs", (_req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoCoPilot API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .info .title { font-size: 2em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  return router;
}

/**
 * Simple YAML parser for OpenAPI specs.
 * Handles basic structure without external dependencies.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  // Use a basic line-by-line parser for the OpenAPI spec structure
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result, indent: -1 }];
  let currentKey = "";

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack to correct level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;

    // Handle key: value pairs
    const colonMatch = content.match(/^([^:]+):\s*(.*)$/);
    if (colonMatch) {
      const [, key, value] = colonMatch;
      const cleanKey = key.replace(/^["']|["']$/g, "");

      if (value === "" || value === "|" || value === ">") {
        // Nested object or multiline string
        const newObj: Record<string, unknown> = {};
        current[cleanKey] = newObj;
        stack.push({ obj: newObj, indent });
        currentKey = cleanKey;
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array
        const arr = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
        current[cleanKey] = arr;
      } else {
        // Simple value
        let parsedValue: unknown = value.replace(/^["']|["']$/g, "");
        if (parsedValue === "true") parsedValue = true;
        else if (parsedValue === "false") parsedValue = false;
        else if (parsedValue === "null") parsedValue = null;
        else if (/^\d+$/.test(parsedValue as string)) parsedValue = parseInt(parsedValue as string, 10);
        current[cleanKey] = parsedValue;
      }
    } else if (content.startsWith("- ")) {
      // Array item
      if (!Array.isArray(current[currentKey])) {
        const parent = stack[stack.length - 2]?.obj || result;
        const lastKey = Object.keys(parent).pop();
        if (lastKey && !Array.isArray(parent[lastKey])) {
          parent[lastKey] = [];
        }
      }
      const arr = Array.isArray(current) ? current : (Object.values(current).find(Array.isArray) as unknown[]);
      if (arr) {
        arr.push(content.slice(2).replace(/^["']|["']$/g, ""));
      }
    }
  }

  return result;
}
