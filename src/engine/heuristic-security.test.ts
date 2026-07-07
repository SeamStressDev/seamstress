/*
 * Security regressions from the trio audit (scaffold validation/audit/).
 * Each test fails against the pre-fix heuristic and passes after the fix; the
 * reversion proof is recorded in the fixing commit.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRepo, sourceFileStats } from "./heuristic.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "seam-sec-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, "locked"), 0o755);
    } catch {
      /* not every case makes a locked dir */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

describe("F5: an unreadable directory does not abort the scan", () => {
  it("skips an EACCES directory and returns cleanly instead of throwing", () => {
    const repo = tmp();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "checkout.js"), "import Stripe from 'stripe';\n");
    mkdirSync(join(repo, "locked"));
    writeFileSync(join(repo, "locked", "x.js"), "payment\n");
    chmodSync(join(repo, "locked"), 0o000);
    expect(() => scanRepo(repo)).not.toThrow();
  });
});

describe("F6: directory symlinks are not followed out of the scan root", () => {
  it("does not read a file outside repoPath reached only via a directory symlink", () => {
    const root = tmp();
    mkdirSync(join(root, "target", "src"), { recursive: true });
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "target", "src", "ok.js"), "hello\n");
    writeFileSync(join(root, "outside", "leak-auth-payment.js"), "webhook payment admin\n");
    symlinkSync(join(root, "outside"), join(root, "target", "portal"), "dir");
    const paths = scanRepo(join(root, "target")).map((c) => c.path);
    expect(paths.some((p) => p.includes("leak-auth-payment"))).toBe(false);
  });
});

describe("F9: sourceFileStats reports scored coverage, not the raw file count", () => {
  it("scanned reflects the cap while total counts every file", () => {
    const repo = tmp();
    mkdirSync(join(repo, "src"));
    for (let i = 0; i < 12; i += 1) {
      writeFileSync(join(repo, "src", `f${i}.js`), "x\n");
    }
    const stats = sourceFileStats(repo, 5);
    expect(stats.total).toBe(12);
    expect(stats.scanned).toBe(5);
  });
});
