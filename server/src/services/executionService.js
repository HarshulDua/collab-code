const Semaphore = require('../utils/Semaphore');
const { getRunner } = require('./runners');
const { checkAndConsume } = require('./rateLimiter');
const ExecutionLog = require('../models/ExecutionLog');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { isSafeRelativePath } = require('../utils/safePath');

const MAX_TOTAL_CODE_LENGTH = 20_000;
const MAX_FILE_COUNT = 40;
const MAX_STDIN_LENGTH = 20_000;
const semaphore = new Semaphore(env.execMaxConcurrent);

function normalizeFiles({ code, files, entryPath }) {
  if (files && typeof files === 'object' && !Array.isArray(files)) {
    const paths = Object.keys(files);
    if (paths.length === 0) throw new ApiError(400, 'files must contain at least one file');
    if (paths.length > MAX_FILE_COUNT) throw new ApiError(413, `too many files (max ${MAX_FILE_COUNT})`);

    const resolvedEntry = entryPath || paths[0];
    if (!paths.includes(resolvedEntry)) throw new ApiError(400, 'entryPath must be one of the given files');

    let totalLength = 0;
    for (const [p, content] of Object.entries(files)) {
      if (!isSafeRelativePath(p)) throw new ApiError(400, `invalid file path: ${p}`);
      if (typeof content !== 'string') throw new ApiError(400, `file content must be a string: ${p}`);
      totalLength += content.length;
    }
    if (totalLength === 0) throw new ApiError(400, 'files must contain some code');
    if (totalLength > MAX_TOTAL_CODE_LENGTH) {
      throw new ApiError(413, `combined file content exceeds max length of ${MAX_TOTAL_CODE_LENGTH} characters`);
    }

    return { files, entryPath: resolvedEntry };
  }

  if (!code || !code.trim()) {
    throw new ApiError(400, 'code is required');
  }
  if (code.length > MAX_TOTAL_CODE_LENGTH) {
    throw new ApiError(413, `code exceeds max length of ${MAX_TOTAL_CODE_LENGTH} characters`);
  }
  const resolvedEntry = entryPath && isSafeRelativePath(entryPath) ? entryPath : 'main.py';
  return { files: { [resolvedEntry]: code }, entryPath: resolvedEntry };
}

async function executeCode({ language, code, files, entryPath, stdin, userId, roomId }) {
  const normalized = normalizeFiles({ code, files, entryPath });

  if (stdin != null && (typeof stdin !== 'string' || stdin.length > MAX_STDIN_LENGTH)) {
    throw new ApiError(413, `stdin exceeds max length of ${MAX_STDIN_LENGTH} characters`);
  }

  const allowed = await checkAndConsume(
    `exec:rate:${userId}`,
    env.execRateLimitPerMin,
    60
  );
  if (!allowed) {
    throw new ApiError(429, 'Execution rate limit exceeded. Try again shortly.');
  }

  const runner = getRunner(language);

  await semaphore.acquire();
  let result;
  try {
    result = await runner.run(normalized.files, normalized.entryPath, { stdin });
  } finally {
    semaphore.release();
  }

  if (roomId && userId) {
    const isMultiFile = Object.keys(normalized.files).length > 1;
    await ExecutionLog.create({
      room: roomId,
      user: userId,
      language,
      code: normalized.files[normalized.entryPath],
      files: isMultiFile ? normalized.files : undefined,
      entryPath: normalized.entryPath,
      stdin: stdin || '',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    });
  }

  return result;
}

module.exports = { executeCode, semaphore };
