/**
 * Fails the build early on an unsupported Node.
 *
 * Without this, Node 18 gets a long way in — emptying `dist/` and writing the
 * assets — before dying inside a transitive dependency with a bare
 * `crypto is not defined`. The result is a dist/ that looks built but has no
 * service worker, which then fails silently in the browser as a stuck install.
 */

const major = Number(process.versions.node.split('.')[0])

if (major < 20) {
  console.error(
    `\n  Tareez POS needs Node 20 or newer — this is Node ${process.versions.node}.\n\n` +
      `    nvm use          (an .nvmrc is committed)\n\n` +
      `  On Node 18 the service worker cannot be generated, and the build would\n` +
      `  leave dist/ half-written rather than failing cleanly.\n`,
  )
  process.exit(1)
}
