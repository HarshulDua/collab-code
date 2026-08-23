const pythonRunner = require('./pythonRunner');

const runners = {
  python: pythonRunner,
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
