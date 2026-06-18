module.exports = {
  apps: [{
    name: 'email-agent',
    script: 'backend/src/server.js',
    node_args: '--experimental-vm-modules',
    watch: false,
    autorestart: true,
    max_restarts: 10,
  }]
};
