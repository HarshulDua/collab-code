const pythonRunner = require('./pythonRunner');
const jsRunner = require('./jsRunner');
const cRunner = require('./cRunner');
const cppRunner = require('./cppRunner');
const goRunner = require('./goRunner');
const rustRunner = require('./rustRunner');
const javaRunner = require('./javaRunner');
const csharpRunner = require('./csharpRunner');
const typescriptRunner = require('./typescriptRunner');

const runners = {
  python: pythonRunner,
  javascript: jsRunner,
  typescript: typescriptRunner,
  c: cRunner,
  cpp: cppRunner,
  go: goRunner,
  rust: rustRunner,
  java: javaRunner,
  csharp: csharpRunner,
};

function getRunner(language) {
  const runner = runners[language];
  if (!runner) {
    const supported = Object.keys(runners).join(', ');
    throw new Error(`Unsupported language "${language}". Supported: ${supported}`);
  }
  return runner;
}

module.exports = { getRunner, supportedLanguages: Object.keys(runners) };
