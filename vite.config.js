const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
  // Required for Electron loadFile(file://): absolute "/assets/..." breaks the renderer in production.
  base: "./",
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly: on some Windows setups "localhost" resolves to ::1 only,
    // which wait-on tcp:5175 (IPv4) never sees, so Electron never launches.
    host: "127.0.0.1",
    port: 5175,
    strictPort: true
  }
});
