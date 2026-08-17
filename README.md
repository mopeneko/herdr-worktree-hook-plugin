# herdr-worktree-hook-plugin

A [herdr](https://herdr.dev/) plugin that runs user-defined shell commands right after a new worktree is created — the equivalent of a `postCreate` hook.

Useful for automating one-off setup steps such as installing dependencies, copying `.env` files, or seeding a local database whenever a fresh worktree lands.

## How it works

The plugin subscribes to the `worktree.created` event. When it fires, it:

1. Reads `$HERDR_PLUGIN_CONFIG_DIR/config.toml`.
2. Looks up an entry whose `path` matches the created worktree's `repo_root`.
3. Runs each of the entry's `commands` sequentially, starting in the new worktree's directory. `cd` in one command persists to the commands that follow.
4. Aborts on the first non-zero exit code.

If the config file is missing, or no entry matches the repository, the plugin exits silently with code 0.

## Configuration

Put a `config.toml` in the plugin's config directory (herdr exposes this path via `HERDR_PLUGIN_CONFIG_DIR` when the plugin runs):

```toml
[[repos]]
path = "~/projects/a"
commands = [
  "bun install",
  "cp -n .env.example .env",
]

[[repos]]
path = "/home/user/b"
commands = [
  "cd frontend",
  "npm install",
]
```

### Fields

- **`path`** — Absolute path to the repository root. `~` and `~/…` are expanded to `$HOME`. Must match the event payload's `data.workspace.worktree.repo_root` exactly after expansion.
- **`commands`** — Array of shell command strings. Each is executed with `/bin/sh -c`, in order. Execution stops on the first failure and the plugin exits with that command's exit code. `cd` in one command persists to the commands that follow.

### Command environment

Each command runs with:

- **`cwd`** — the newly created worktree path, then whatever directory a previous `cd` left behind
- **`REPO_ROOT`** — the repository root (main worktree)
- **`WORKTREE_PATH`** — the new worktree's path
- **`BRANCH`** — the new worktree's branch name

The parent process environment is inherited as well.

## Development

```bash
bun install       # install dependencies
bun run build.ts  # bundle to build/index.js
```

The built entry point is invoked by herdr as declared in `herdr-plugin.toml`:

```toml
[[events]]
on = "worktree.created"
command = ["node", "build/index.js"]
```

## Platforms

Linux and macOS. Windows is not supported because commands are executed via `/bin/sh`.
