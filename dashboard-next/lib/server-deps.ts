// Centralized server-side imports. Route handlers grab their dependencies
// from here so we don't repeat the require() boilerplate in every file.
// All modules below are CommonJS — Next bundles them server-side only.

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const db = require('./db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const sync = require('./sync');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const githubSync = require('./github-sync');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const parser = require('./parser');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const triggerJobs = require('./trigger-jobs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const tmux = require('./tmux');
