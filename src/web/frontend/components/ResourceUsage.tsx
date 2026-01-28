/**
 * ResourceUsage — Container resource utilization display.
 *
 * Shows CPU and memory usage for the worker's Docker container
 * with progress bars and numeric values.
 */

import React from "react";
import type { ContainerResources } from "../inspector-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

function progressColor(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ResourceUsageProps {
  /** Container resource stats, or null if unavailable. */
  resources: ContainerResources | null;
  /** Container status string. */
  containerStatus?: string;
}

export const ResourceUsage: React.FC<ResourceUsageProps> = ({
  resources,
  containerStatus,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200">
      <div className="px-4 py-3 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">
          Container Resources
        </h2>
      </div>

      <div className="p-4">
        {/* Container status */}
        <div className="mb-4">
          <span className="text-xs text-stone-500">Container Status</span>
          <p className="text-sm font-medium text-stone-800">
            {containerStatus ?? "Unknown"}
          </p>
        </div>

        {resources ? (
          <div className="space-y-4">
            {/* Memory */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-stone-500">Memory</span>
                <span className="text-xs text-stone-600">
                  {formatMb(resources.memoryUsageMb)} /{" "}
                  {formatMb(resources.memoryLimitMb)}
                </span>
              </div>
              <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progressColor(
                    (resources.memoryUsageMb / resources.memoryLimitMb) * 100,
                  )}`}
                  style={{
                    width: `${Math.min(
                      (resources.memoryUsageMb / resources.memoryLimitMb) * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* CPU */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-stone-500">CPU</span>
                <span className="text-xs text-stone-600">
                  {resources.cpuPercent.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progressColor(
                    resources.cpuPercent,
                  )}`}
                  style={{
                    width: `${Math.min(resources.cpuPercent, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-400">
            Resource data unavailable.
          </p>
        )}
      </div>
    </div>
  );
};
