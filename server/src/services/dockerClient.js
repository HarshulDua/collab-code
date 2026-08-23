const Docker = require('dockerode');

let docker;

function getDocker() {
  if (!docker) {
    docker = new Docker();
  }
  return docker;
}

module.exports = { getDocker };
