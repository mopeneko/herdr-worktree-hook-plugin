import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

type WorktreeCreatedEvent = {
  event: string;
  data: {
    workspace: {
      worktree: {
        repo_root: string;
      };
    };
    worktree: {
      path: string;
      branch: string;
    };
  };
};

type RepoEntry = {
  path: string;
  commands?: string[];
};

type PluginConfig = {
  repos?: RepoEntry[];
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

const raw = process.env.HERDR_PLUGIN_EVENT_JSON;
if (!raw) {
  console.error("HERDR_PLUGIN_EVENT_JSON is not set");
  process.exit(1);
}

let event: WorktreeCreatedEvent;
try {
  event = JSON.parse(raw);
} catch (err) {
  console.error(`Failed to parse HERDR_PLUGIN_EVENT_JSON: ${err}`);
  process.exit(1);
}

if (event.event !== "worktree_created") {
  process.exit(0);
}

const repoRoot = event.data?.workspace?.worktree?.repo_root;
const worktreePath = event.data?.worktree?.path;
const branch = event.data?.worktree?.branch;

if (!repoRoot || !worktreePath || !branch) {
  console.error("Missing required fields in event payload");
  process.exit(1);
}

const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
if (!configDir) {
  console.error("HERDR_PLUGIN_CONFIG_DIR is not set");
  process.exit(1);
}

const configPath = join(configDir, "config.toml");
if (!existsSync(configPath)) {
  process.exit(0);
}

let config: PluginConfig;
try {
  config = parseToml(readFileSync(configPath, "utf8")) as PluginConfig;
} catch (err) {
  console.error(`Failed to parse ${configPath}: ${err}`);
  process.exit(1);
}

const repoEntry = config.repos?.find((r) => expandHome(r.path) === repoRoot);
if (!repoEntry) {
  process.exit(0);
}

const commands = (repoEntry.commands ?? [])
  .map((s) => s.trim())
  .filter(Boolean);
if (commands.length === 0) {
  process.exit(0);
}

const hookEnv = {
  ...process.env,
  REPO_ROOT: repoRoot,
  WORKTREE_PATH: worktreePath,
  BRANCH: branch,
};

const pwdDir = mkdtempSync(join(tmpdir(), "herdr-hook-pwd-"));
const pwdFile = join(pwdDir, "pwd");
let cwd = worktreePath;
let exitCode = 0;

try {
  for (const command of commands) {
    console.log(`$ ${command}`);
    const result = spawnSync(
      "/bin/sh",
      ["-c", `trap 'printf %s "$PWD" > "$HERDR_HOOK_PWD_FILE"' EXIT\n${command}`],
      {
        cwd,
        env: { ...hookEnv, HERDR_HOOK_PWD_FILE: pwdFile },
        stdio: "inherit",
      },
    );

    try {
      const recorded = readFileSync(pwdFile, "utf8").trim();
      if (recorded) cwd = recorded;
    } catch {
      // Keep the previous cwd if the shell did not record PWD.
    }

    if (result.error) {
      console.error(`Failed to spawn command: ${result.error.message}`);
      exitCode = 1;
      break;
    }
    if (result.status !== 0) {
      console.error(
        `postCreate hook failed with exit code ${result.status}: ${command}`,
      );
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(pwdDir, { recursive: true, force: true });
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
