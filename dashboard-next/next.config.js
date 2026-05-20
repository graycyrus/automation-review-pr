/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native addon — must not be bundled by webpack
  serverExternalPackages: ['better-sqlite3'],
};

module.exports = nextConfig;
