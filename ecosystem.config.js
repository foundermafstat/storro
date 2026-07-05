const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env.production"), quiet: true });

const baseEnv = {
  ...process.env,
  NODE_ENV: "production",
  APP_ENV: process.env.APP_ENV || "production",
};

module.exports = {
  apps: [
    {
      name: "storro-web",
      script: "node_modules/.bin/next",
      args: "start --hostname 127.0.0.1 -p 7788",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        ...baseEnv,
        PORT: "7788",
      },
    },
    {
      name: "storro-worker",
      script: "scripts/worker-entry.mjs",
      interpreter: "node",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      env: baseEnv,
    },
  ],
};
