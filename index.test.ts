import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function runPlugin(opts: {
  repoRoot: string;
  worktreePath: string;
  commands: string[];
}) {
  const configDir = tmp("herdr-plugin-config-");
  writeFileSync(
    join(configDir, "config.toml"),
    `[[repos]]\npath = ${JSON.stringify(opts.repoRoot)}\ncommands = ${JSON.stringify(opts.commands)}\n`,
  );

  const event = {
    event: "worktree_created",
    data: {
      workspace: { worktree: { repo_root: opts.repoRoot } },
      worktree: { path: opts.worktreePath, branch: "feat/test" },
    },
  };

  return spawnSync("bun", [join(import.meta.dir, "index.ts")], {
    env: {
      ...process.env,
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify(event),
      HERDR_PLUGIN_CONFIG_DIR: configDir,
    },
    encoding: "utf8",
  });
}

test("cd persists to the next command", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");
  mkdirSync(join(worktreePath, "frontend"));

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: ["cd frontend", "touch installed"],
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(worktreePath, "frontend", "installed"))).toBe(true);
  expect(existsSync(join(worktreePath, "installed"))).toBe(false);
});

test("relative commands without cd stay in the worktree root", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");
  mkdirSync(join(worktreePath, "frontend"));

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: ["touch installed"],
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(worktreePath, "installed"))).toBe(true);
});

test("cd then another cd updates cwd again", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");
  mkdirSync(join(worktreePath, "frontend"));
  mkdirSync(join(worktreePath, "backend"));

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: [
      "cd frontend",
      "touch front",
      "cd ../backend",
      "touch back",
    ],
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(worktreePath, "frontend", "front"))).toBe(true);
  expect(existsSync(join(worktreePath, "backend", "back"))).toBe(true);
});

test("failed command aborts and keeps later commands from running", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: ["false", "touch should-not-exist"],
  });

  expect(result.status).not.toBe(0);
  expect(existsSync(join(worktreePath, "should-not-exist"))).toBe(false);
});

test("cd to a missing directory fails", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: ["cd missing", "touch should-not-exist"],
  });

  expect(result.status).not.toBe(0);
  expect(existsSync(join(worktreePath, "should-not-exist"))).toBe(false);
});

test("cd in a single command still affects that command", () => {
  const repoRoot = tmp("herdr-repo-");
  const worktreePath = tmp("herdr-worktree-");
  mkdirSync(join(worktreePath, "frontend"));

  const result = runPlugin({
    repoRoot,
    worktreePath,
    commands: ["cd frontend && touch installed"],
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(worktreePath, "frontend", "installed"))).toBe(true);
});
