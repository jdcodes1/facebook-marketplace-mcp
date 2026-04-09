import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { SavedMonitor, SearchParams } from "../facebook/types.js";

const STORAGE_DIR = path.join(os.homedir(), ".fb-marketplace");
const MONITORS_FILE = path.join(STORAGE_DIR, "monitors.json");

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export function loadMonitors(): SavedMonitor[] {
  ensureStorageDir();
  if (!fs.existsSync(MONITORS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(MONITORS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveMonitors(monitors: SavedMonitor[]) {
  ensureStorageDir();
  fs.writeFileSync(MONITORS_FILE, JSON.stringify(monitors, null, 2));
}

export function addMonitor(
  name: string,
  params: Omit<SearchParams, "cursor">
): SavedMonitor {
  const monitors = loadMonitors();

  // Check for duplicate name
  const existing = monitors.find((m) => m.name === name);
  if (existing) {
    throw new Error(`Monitor "${name}" already exists. Choose a different name.`);
  }

  const monitor: SavedMonitor = {
    id: crypto.randomUUID(),
    name,
    params,
    seenIds: [],
    createdAt: new Date().toISOString(),
    lastChecked: null,
  };

  monitors.push(monitor);
  saveMonitors(monitors);
  return monitor;
}

export function getMonitor(name: string): SavedMonitor | undefined {
  return loadMonitors().find((m) => m.name === name);
}

export function updateMonitorSeenIds(
  name: string,
  newIds: string[]
): void {
  const monitors = loadMonitors();
  const monitor = monitors.find((m) => m.name === name);
  if (!monitor) return;

  // Keep last 500 seen IDs to prevent unbounded growth
  const combined = [...new Set([...monitor.seenIds, ...newIds])];
  monitor.seenIds = combined.slice(-500);
  monitor.lastChecked = new Date().toISOString();
  saveMonitors(monitors);
}

export function deleteMonitor(name: string): boolean {
  const monitors = loadMonitors();
  const idx = monitors.findIndex((m) => m.name === name);
  if (idx === -1) return false;
  monitors.splice(idx, 1);
  saveMonitors(monitors);
  return true;
}
