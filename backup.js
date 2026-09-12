#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

function env(name, fallback = undefined) {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}

function mongoUri() {
  return env("MONGODB_URI") || env("MONGO_URL") || env("MONGO_URI");
}

function requireEnv(name) {
  const value = name === "MONGODB_URI" ? mongoUri() : env(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (or MONGO_URL)`);
  }
  return value;
}

function maskUri(uri) {
  try {
    const parsed = new URL(uri);
    if (!parsed.password) {
      return uri;
    }
    parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[unparseable-uri]";
  }
}

function log(message) {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  console.log(`${stamp} INFO ${message}`);
}

function logError(message, error) {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const detail = error?.stack || error?.message || String(error);
  console.error(`${stamp} ERROR ${message}`);
  console.error(detail);
}

function backupDir() {
  return env("BACKUP_DIR", "/backups");
}

function intervalMs() {
  const hours = Number.parseFloat(env("BACKUP_INTERVAL_HOURS", "24"));
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("BACKUP_INTERVAL_HOURS must be a number greater than 0");
  }
  return Math.round(hours * 3600 * 1000);
}

function archiveName(database) {
  const stamp = new Date().toISOString().replace(/:/g, "").replace(/\.\d{3}Z$/, "Z");
  const prefix = env("BACKUP_PREFIX", "mongodb");
  const dbPart = database || "all";
  return `${prefix}-${dbPart}-${stamp}.archive.gz`;
}

function runMongodump(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("mongodump", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("mongodump is not installed in this environment"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runBackup() {
  const uri = requireEnv("MONGODB_URI");
  const database = env("MONGO_DB");
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });

  const dest = path.join(dir, archiveName(database));
  const destTmp = `${dest}.tmp`;
  const args = ["--uri", uri, "--gzip", `--archive=${destTmp}`];
  if (database) {
    args.push("--db", database);
  }

  log(`Starting backup → ${path.basename(dest)}`);
  log(`Target: ${maskUri(uri)}${database ? ` / db=${database}` : " / all databases"}`);

  const result = await runMongodump(args);
  if (result.code !== 0) {
    await fs.unlink(destTmp).catch(() => {});
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`mongodump failed (exit ${result.code}): ${detail}`);
  }

  await fs.rename(destTmp, dest);
  await fs.writeFile(path.join(dir, ".last-success"), new Date().toISOString(), "utf8");

  const stat = await fs.stat(dest);
  const sizeMb = stat.size / (1024 * 1024);
  log(`Backup written: ${dest} (${sizeMb.toFixed(2)} MB)`);
  return dest;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safeBackup(label) {
  try {
    await runBackup();
  } catch (error) {
    logError(`${label} failed; will retry on the next interval`, error);
  }
}

async function runScheduler() {
  const wait = intervalMs();
  const runOnStart = ["1", "true", "yes"].includes(
    (env("RUN_ON_START", "true") || "true").toLowerCase(),
  );

  log(`Scheduler started; interval=${wait / 1000}s`);
  if (runOnStart) {
    await safeBackup("Initial backup");
  }

  while (true) {
    log(`Next backup in ${wait / 3600000} hour(s)`);
    await sleep(wait);
    await safeBackup("Scheduled backup");
  }
}

function main() {
  const shutdown = (signal) => {
    log(`Received signal ${signal}; shutting down`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  const once = process.argv.includes("--once");
  const work = once ? runBackup() : runScheduler();
  work.catch((error) => {
    logError("Backup process failed", error);
    process.exit(1);
  });
}

main();
