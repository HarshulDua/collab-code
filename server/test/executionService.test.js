const mongoose = require('mongoose');

jest.mock('../src/services/runners', () => ({
  getRunner: jest.fn(),
}));

const { getRunner } = require('../src/services/runners');
const { executeCode } = require('../src/services/executionService');
const ExecutionLog = require('../src/models/ExecutionLog');

const userId = new mongoose.Types.ObjectId().toString();
const roomId = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  getRunner.mockReset();
});

describe('executionService.executeCode', () => {
  it('wraps single-file `code` as a one-entry files map before running', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: 'hi\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 12 });
    getRunner.mockReturnValue({ run });

    const result = await executeCode({ language: 'python', code: 'print("hi")', userId, roomId });

    expect(run).toHaveBeenCalledWith({ 'main.py': 'print("hi")' }, 'main.py', { stdin: undefined });
    expect(result.stdout).toBe('hi\n');

    const logs = await ExecutionLog.find({ room: roomId });
    expect(logs).toHaveLength(1);
    expect(logs[0].stdout).toBe('hi\n');
    expect(logs[0].entryPath).toBe('main.py');
    expect(logs[0].files).toBeUndefined(); // only set for genuinely multi-file runs
  });

  it('runs a multi-file project against the given entryPath', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 });
    getRunner.mockReturnValue({ run });

    const files = { 'main.py': 'from utils.helper import go\ngo()', 'utils/helper.py': 'def go():\n    print("ok")' };
    const result = await executeCode({ language: 'python', files, entryPath: 'main.py', userId, roomId });

    expect(run).toHaveBeenCalledWith(files, 'main.py', { stdin: undefined });
    expect(result.stdout).toBe('ok\n');

    const log = await ExecutionLog.findOne({ room: roomId, entryPath: 'main.py' });
    expect(log.files).toEqual(files);
    expect(log.code).toBe(files['main.py']); // entry file content mirrored for backward-compat display
  });

  it('defaults entryPath to the first file when omitted', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 });
    getRunner.mockReturnValue({ run });

    await executeCode({ language: 'python', files: { 'app.py': 'print(1)' }, userId, roomId });

    expect(run).toHaveBeenCalledWith({ 'app.py': 'print(1)' }, 'app.py', { stdin: undefined });
  });

  it('passes stdin through to the runner and persists it', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: 'echo: hi\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 3 });
    getRunner.mockReturnValue({ run });

    await executeCode({ language: 'python', code: 'print("echo:", input())', stdin: 'hi', userId, roomId });

    expect(run).toHaveBeenCalledWith({ 'main.py': 'print("echo:", input())' }, 'main.py', { stdin: 'hi' });

    const log = await ExecutionLog.findOne({ room: roomId });
    expect(log.stdin).toBe('hi');
  });

  it('rejects a file path that attempts directory traversal', async () => {
    getRunner.mockReturnValue({ run: jest.fn() });
    await expect(
      executeCode({
        language: 'python',
        files: { '../../etc/evil.py': 'print(1)' },
        entryPath: '../../etc/evil.py',
        userId,
        roomId,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an entryPath that is not one of the given files', async () => {
    getRunner.mockReturnValue({ run: jest.fn() });
    await expect(
      executeCode({ language: 'python', files: { 'main.py': 'print(1)' }, entryPath: 'other.py', userId, roomId })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects oversized stdin', async () => {
    getRunner.mockReturnValue({ run: jest.fn() });
    await expect(
      executeCode({ language: 'python', code: 'print(1)', stdin: 'a'.repeat(25000), userId, roomId })
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects empty code', async () => {
    getRunner.mockReturnValue({ run: jest.fn() });
    await expect(executeCode({ language: 'python', code: '   ', userId, roomId })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects code over the max length', async () => {
    getRunner.mockReturnValue({ run: jest.fn() });
    const huge = 'a'.repeat(25000);
    await expect(executeCode({ language: 'python', code: huge, userId, roomId })).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('propagates timed-out results without treating them as errors', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true, durationMs: 8000 });
    getRunner.mockReturnValue({ run });

    const result = await executeCode({ language: 'python', code: 'while True: pass', userId, roomId });
    expect(result.timedOut).toBe(true);

    const log = await ExecutionLog.findOne({ room: roomId });
    expect(log.timedOut).toBe(true);
  });

  it('enforces a per-user rate limit', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 });
    getRunner.mockReturnValue({ run });

    const limitedUser = new mongoose.Types.ObjectId().toString();
    for (let i = 0; i < 10; i += 1) {
      await executeCode({ language: 'python', code: 'print(1)', userId: limitedUser, roomId });
    }

    await expect(
      executeCode({ language: 'python', code: 'print(1)', userId: limitedUser, roomId })
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it('does not persist a log when no roomId is given', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 });
    getRunner.mockReturnValue({ run });

    const soloUser = new mongoose.Types.ObjectId().toString();
    await executeCode({ language: 'python', code: 'print(1)', userId: soloUser });

    const logs = await ExecutionLog.find({ user: soloUser });
    expect(logs).toHaveLength(0);
  });
});
