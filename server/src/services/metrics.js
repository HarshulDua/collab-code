const counters = {
  roomsCreated: 0,
  executionsRun: 0,
  executionsFailed: 0,
  errors: 0,
  connectionsTotal: 0,
};

function increment(name, by = 1) {
  if (!(name in counters)) return;
  counters[name] += by;
}

function snapshot() {
  return { ...counters };
}

module.exports = { increment, snapshot };
