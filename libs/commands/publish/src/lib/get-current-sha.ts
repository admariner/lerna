import { log } from "@lerna/core";
import { ExecOptions } from "child_process";

const childProcess = require("@lerna/child-process");

/**
 * Retrieve current SHA from git.
 */
export function getCurrentSHA(opts: ExecOptions) {
  log.silly("getCurrentSHA", "");

  const sha = childProcess.execSync("git", ["rev-parse", "HEAD"], opts);
  log.verbose("getCurrentSHA", sha);

  return sha;
}
