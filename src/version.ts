import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package version. Resolved from package.json so the MCP handshake cannot drift.
 * The vendored plugin copy keeps package.json beside the file. The npm build
 * keeps it one directory up from dist/.
 */
export function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "package.json"), join(here, "..", "package.json")];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next location.
    }
  }
  throw new Error("package.json is missing version");
}

export const SERVER_VERSION = packageVersion();
