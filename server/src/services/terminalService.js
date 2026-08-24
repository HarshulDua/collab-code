// A whitelisted command interpreter, deliberately NOT a shell.
//
// The server container mounts /var/run/docker.sock (ARCHITECTURE.md §15.4),
// so handing users a real PTY here would hand them the host's Docker daemon
// and every containment guarantee in §7 with it. Instead each supported
// command is parsed into a structured intent and dispatched to a service that
// already has its own safety model: file commands mutate the room's Yjs
// document, git commands go through gitService's locked repo operations, and
// run commands go through the same sandboxed executionService the Run button
// uses. Anything not on this list is refused — there is no passthrough.
const gitService = require('./gitService');
const { executeCode } = require('./executionService');
const { languageForPath } = require('../utils/languageForPath');
const { isSafeRelativePath } = require('../utils/safePath');

const MAX_OUTPUT_CHARS = 20000;

// ---------------------------------------------------------------- tokenizer

// Splits on whitespace but keeps quoted runs together, so a commit message or
// a filename with spaces survives as one argument.
function tokenize(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
    } else if (/\s/.test(ch)) {
      if (current || hasContent) tokens.push(current);
      current = '';
      hasContent = false;
    } else {
      current += ch;
    }
  }
  if (current || hasContent) tokens.push(current);
  return tokens;
}

// ------------------------------------------------------------- path helpers

function normalize(pathStr) {
  const segments = [];
  for (const raw of pathStr.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') segments.pop();
    else segments.push(raw);
  }
  return segments.join('/');
}

// Resolves an argument against the current working directory. Everything is
// rooted at the project root; `..` can never climb above it because normalize
// simply pops an empty stack.
function resolvePath(cwd, arg) {
  if (!arg || arg === '.') return cwd;
  if (arg.startsWith('/')) return normalize(arg);
  return normalize(`${cwd}/${arg}`);
}

function isDirectory(files, dirPath) {
  if (dirPath === '') return true;
  const prefix = `${dirPath}/`;
  return Object.keys(files).some((p) => p.startsWith(prefix));
}

function listDirectory(files, dirPath) {
  const prefix = dirPath === '' ? '' : `${dirPath}/`;
  const dirs = new Set();
  const entries = [];

  for (const p of Object.keys(files)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) entries.push(rest);
    else dirs.add(rest.slice(0, slash));
  }

  return [...[...dirs].sort().map((d) => `${d}/`), ...entries.sort()];
}

function requireSafe(path) {
  if (path !== '' && !isSafeRelativePath(path)) {
    throw new Error(`invalid path: ${path} (letters, numbers, "_-./" only, no "..")`);
  }
}

// ------------------------------------------------------------------ helpers

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[output truncated]`;
}

const GITKEEP = '.gitkeep';

// Language-native invocations users actually type, mapped onto the runner
// registry. `run` is the generic form that infers from the extension.
const RUN_ALIASES = {
  python: 'python',
  python3: 'python',
  node: 'javascript',
  'ts-node': 'typescript',
  tsc: 'typescript',
  java: 'java',
  mono: 'csharp',
  rustc: 'rust',
  gcc: 'c',
  'g++': 'cpp',
};

const HELP = `Available commands

  Files
    ls [path]            list a directory
    cd <path>            change directory
    pwd                  print working directory
    cat <file>           print a file
    touch <file>         create an empty file
    mkdir <dir>          create a directory
    rm [-r] <path>       remove a file or directory
    mv <src> <dst>       move or rename
    cp <src> <dst>       copy
    echo <text>          print text
    echo <text> > <file> write text to a file  (>> appends)

  Run
    run <file>           run a file, language inferred from its extension
    python <file>        also: node, java, go run, rustc, gcc, g++, tsc
    go run <file>

  Git
    git status           working tree vs. last commit
    git log              commit history
    git branch [name]    list branches, or create one
    git checkout [-b] <branch>
    git commit -m "msg"  commit the current project state
    git diff [hash]      show a commit's patch
    git merge <branch>   merge a branch into the current one

  Other
    help                 this message
    clear                clear the screen

Supported languages: python, javascript, typescript, c, cpp, go, rust, java, csharp`;

// -------------------------------------------------------------------- runner

async function runFile({ files, target, language, userId, roomId }) {
  if (!(target in files)) return { output: `run: ${target}: no such file`, exitCode: 1 };

  const resolved = language || languageForPath(target);
  if (!resolved) {
    return { output: `run: ${target}: don't know how to run this file type`, exitCode: 1 };
  }

  const result = await executeCode({
    language: resolved,
    files,
    entryPath: target,
    userId,
    roomId,
  });

  const parts = [];
  if (result.stdout) parts.push(result.stdout.replace(/\n$/, ''));
  if (result.stderr) parts.push(result.stderr.replace(/\n$/, ''));
  if (result.timedOut) parts.push(`[timed out after ${result.durationMs}ms]`);
  else parts.push(`[exit ${result.exitCode} · ${result.durationMs}ms]`);

  return { output: parts.join('\n'), exitCode: result.exitCode ?? 1 };
}

// ----------------------------------------------------------------- git verbs

async function runGit({ args, roomId, branch, files, user }) {
  const [verb, ...rest] = args;

  switch (verb) {
    case undefined:
    case 'help':
      return { output: 'git: try status, log, branch, checkout, commit, diff, merge' };

    case 'status': {
      const committed = await gitService.getCommitTree(roomId, branch).catch(() => ({}));
      const livePaths = Object.keys(files).sort();
      const committedPaths = Object.keys(committed).sort();

      const added = livePaths.filter((p) => !(p in committed));
      const removed = committedPaths.filter((p) => !(p in files));
      const modified = livePaths.filter((p) => p in committed && committed[p] !== files[p]);

      const lines = [`On branch ${branch}`];
      if (added.length === 0 && removed.length === 0 && modified.length === 0) {
        lines.push('nothing to commit, working tree clean');
      } else {
        lines.push('Changes not staged for commit:');
        modified.forEach((p) => lines.push(`        modified:   ${p}`));
        added.forEach((p) => lines.push(`        new file:   ${p}`));
        removed.forEach((p) => lines.push(`        deleted:    ${p}`));
        lines.push('', 'Everything above is committed together — this project snapshots the');
        lines.push('whole tree, so there is no staging area and `git add` is unnecessary.');
      }
      return { output: lines.join('\n') };
    }

    case 'add':
      return {
        output:
          "git add: not needed here — commits snapshot the whole project tree,\nso there's no staging area. Use `git commit -m \"...\"` directly.",
      };

    case 'log': {
      const commits = await gitService.log(roomId, branch);
      if (commits.length === 0) return { output: 'no commits yet' };
      return {
        output: commits
          .map((c) => `${c.hash.slice(0, 7)}  ${c.authorName.padEnd(16)}  ${c.message}`)
          .join('\n'),
      };
    }

    case 'branch': {
      if (rest.length === 0) {
        const { all } = await gitService.listBranches(roomId);
        return { output: all.map((b) => `${b === branch ? '*' : ' '} ${b}`).join('\n') };
      }
      await gitService.createBranch(roomId, rest[0], branch);
      return { output: `created branch ${rest[0]}`, branchCreated: rest[0] };
    }

    case 'checkout': {
      const wantsNew = rest[0] === '-b';
      const name = wantsNew ? rest[1] : rest[0];
      if (!name) return { output: 'git checkout: branch name required', exitCode: 1 };
      if (wantsNew) {
        await gitService.createBranch(roomId, name, branch);
      } else if (!(await gitService.branchExists(roomId, name))) {
        return { output: `git checkout: branch '${name}' does not exist`, exitCode: 1 };
      }
      // The client owns which branch it is viewing (branch switching is
      // per-user, ARCHITECTURE.md §10.4), so this asks it to switch rather
      // than mutating shared state.
      return { output: `switched to branch ${name}`, switchBranch: name };
    }

    case 'commit': {
      const mIndex = rest.findIndex((a) => a === '-m');
      const message = mIndex === -1 ? null : rest[mIndex + 1];
      if (!message) return { output: 'git commit: message required — git commit -m "your message"', exitCode: 1 };

      const result = await gitService.commit({
        roomId,
        branch,
        message,
        authorName: user.name,
        authorEmail: user.email,
        files,
      });
      if (result.noChanges) return { output: 'nothing to commit, working tree clean' };
      return { output: `[${branch} ${result.hash.slice(0, 7)}] ${result.message}`, committed: result };
    }

    case 'diff': {
      const hash = rest[0];
      if (!hash) {
        const commits = await gitService.log(roomId, branch);
        if (commits.length === 0) return { output: 'no commits yet' };
        return { output: truncate(await gitService.show(roomId, commits[0].hash)) };
      }
      return { output: truncate(await gitService.show(roomId, hash)) };
    }

    case 'merge': {
      const from = rest[0];
      if (!from) return { output: 'git merge: branch name required', exitCode: 1 };
      const result = await gitService.merge({
        roomId,
        from,
        into: branch,
        authorName: user.name,
        authorEmail: user.email,
      });
      if (result.conflicted) {
        return { output: `merge conflict in: ${result.files.join(', ')}\nmerge aborted, nothing changed`, exitCode: 1 };
      }
      return { output: `merged ${from} into ${branch}`, newFiles: result.files };
    }

    default:
      return { output: `git: '${verb}' is not supported here — try: status, log, branch, checkout, commit, diff, merge`, exitCode: 1 };
  }
}

// ------------------------------------------------------------------- execute

/**
 * Runs one command line. Never throws for user error — a bad command comes
 * back as output with a non-zero exitCode, the way a shell behaves.
 *
 * Returns { output, cwd, exitCode, files?, switchBranch?, refreshGit? }.
 * `files` is present only when the command changed the project tree; the
 * caller is responsible for writing it back and broadcasting.
 */
async function execute({ command, cwd = '', files, roomId, branch, user }) {
  const tokens = tokenize(command);
  if (tokens.length === 0) return { output: '', cwd, exitCode: 0 };

  const [cmd, ...args] = tokens;
  const next = { ...files };

  try {
    switch (cmd) {
      case 'help':
        return { output: HELP, cwd, exitCode: 0 };

      case 'pwd':
        return { output: `/${cwd}`, cwd, exitCode: 0 };

      case 'ls': {
        const target = resolvePath(cwd, args[0]);
        requireSafe(target);
        if (target !== '' && !isDirectory(files, target)) {
          if (target in files) return { output: target.split('/').pop(), cwd, exitCode: 0 };
          return { output: `ls: ${args[0]}: no such file or directory`, cwd, exitCode: 1 };
        }
        const entries = listDirectory(files, target);
        return { output: entries.length ? entries.join('\n') : '', cwd, exitCode: 0 };
      }

      case 'cd': {
        const target = resolvePath(cwd, args[0] ?? '');
        requireSafe(target);
        if (target !== '' && !isDirectory(files, target)) {
          return { output: `cd: ${args[0]}: no such directory`, cwd, exitCode: 1 };
        }
        return { output: '', cwd: target, exitCode: 0 };
      }

      case 'cat': {
        if (!args[0]) return { output: 'cat: file required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, args[0]);
        requireSafe(target);
        if (!(target in files)) return { output: `cat: ${args[0]}: no such file`, cwd, exitCode: 1 };
        return { output: truncate(files[target]), cwd, exitCode: 0 };
      }

      case 'touch': {
        if (!args[0]) return { output: 'touch: file required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, args[0]);
        requireSafe(target);
        if (target in files) return { output: '', cwd, exitCode: 0 };
        next[target] = '';
        return { output: '', cwd, exitCode: 0, files: next };
      }

      case 'mkdir': {
        if (!args[0]) return { output: 'mkdir: directory required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, args[0]);
        requireSafe(target);
        if (isDirectory(files, target)) return { output: `mkdir: ${args[0]}: already exists`, cwd, exitCode: 1 };
        // Directories aren't a tracked entity in this model — a path with a
        // slash implies one, exactly as in git. An empty directory therefore
        // needs a placeholder file to exist at all, which is the same
        // convention git itself uses.
        next[`${target}/${GITKEEP}`] = '';
        return { output: '', cwd, exitCode: 0, files: next };
      }

      case 'rm': {
        const recursive = args[0] === '-r' || args[0] === '-rf';
        const nameArg = recursive ? args[1] : args[0];
        if (!nameArg) return { output: 'rm: path required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, nameArg);
        requireSafe(target);

        if (target in files) {
          delete next[target];
        } else if (isDirectory(files, target)) {
          if (!recursive) return { output: `rm: ${nameArg}: is a directory (use rm -r)`, cwd, exitCode: 1 };
          Object.keys(next)
            .filter((p) => p.startsWith(`${target}/`))
            .forEach((p) => delete next[p]);
        } else {
          return { output: `rm: ${nameArg}: no such file or directory`, cwd, exitCode: 1 };
        }

        if (Object.keys(next).length === 0) {
          return { output: 'rm: refusing to remove the last file in the project', cwd, exitCode: 1 };
        }
        return { output: '', cwd, exitCode: 0, files: next };
      }

      case 'mv':
      case 'cp': {
        if (!args[0] || !args[1]) return { output: `${cmd}: source and destination required`, cwd, exitCode: 1 };
        const src = resolvePath(cwd, args[0]);
        let dst = resolvePath(cwd, args[1]);
        requireSafe(src);
        requireSafe(dst);
        if (!(src in files)) return { output: `${cmd}: ${args[0]}: no such file`, cwd, exitCode: 1 };
        // Moving onto a directory keeps the basename, like the real tools.
        if (isDirectory(files, dst)) dst = `${dst}/${src.split('/').pop()}`;
        if (dst in files) return { output: `${cmd}: ${args[1]}: already exists`, cwd, exitCode: 1 };
        next[dst] = files[src];
        if (cmd === 'mv') delete next[src];
        return { output: '', cwd, exitCode: 0, files: next };
      }

      case 'echo': {
        const redirect = args.findIndex((a) => a === '>' || a === '>>');
        if (redirect === -1) return { output: args.join(' '), cwd, exitCode: 0 };
        const text = args.slice(0, redirect).join(' ');
        const fileArg = args[redirect + 1];
        if (!fileArg) return { output: 'echo: destination file required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, fileArg);
        requireSafe(target);
        const append = args[redirect] === '>>';
        next[target] = append ? `${files[target] ?? ''}${text}\n` : `${text}\n`;
        return { output: '', cwd, exitCode: 0, files: next };
      }

      case 'clear':
        return { output: '', cwd, exitCode: 0, clear: true };

      case 'git': {
        const result = await runGit({ args, roomId, branch, files, user });
        const out = { output: result.output ?? '', cwd, exitCode: result.exitCode ?? 0 };
        if (result.switchBranch) out.switchBranch = result.switchBranch;
        if (result.committed || result.branchCreated || result.newFiles) out.refreshGit = true;
        if (result.newFiles) out.files = result.newFiles;
        return out;
      }

      case 'run': {
        if (!args[0]) return { output: 'run: file required', cwd, exitCode: 1 };
        const target = resolvePath(cwd, args[0]);
        requireSafe(target);
        const r = await runFile({ files, target, userId: user.id, roomId });
        return { output: r.output, cwd, exitCode: r.exitCode };
      }

      case 'go': {
        if (args[0] !== 'run' || !args[1]) return { output: 'go: only `go run <file>` is supported', cwd, exitCode: 1 };
        const target = resolvePath(cwd, args[1]);
        requireSafe(target);
        const r = await runFile({ files, target, language: 'go', userId: user.id, roomId });
        return { output: r.output, cwd, exitCode: r.exitCode };
      }

      default: {
        if (cmd in RUN_ALIASES) {
          const fileArg = args.find((a) => !a.startsWith('-'));
          if (!fileArg) return { output: `${cmd}: file required`, cwd, exitCode: 1 };
          const target = resolvePath(cwd, fileArg);
          requireSafe(target);
          const r = await runFile({ files, target, language: RUN_ALIASES[cmd], userId: user.id, roomId });
          return { output: r.output, cwd, exitCode: r.exitCode };
        }
        return { output: `${cmd}: command not found — type \`help\` for the supported list`, cwd, exitCode: 127 };
      }
    }
  } catch (err) {
    return { output: `${cmd}: ${err.message}`, cwd, exitCode: 1 };
  }
}

module.exports = { execute, tokenize, resolvePath, listDirectory, isDirectory, HELP };
