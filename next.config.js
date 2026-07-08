/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOT "standalone" — that mode generates Next's own minimal server.js, which
  // we don't use. server.ts (project root) is the entrypoint; it boots Next in
  // the same process as the WebSocket upgrade handler. See docs/multiplayer-design.md §3.
};

module.exports = nextConfig;
