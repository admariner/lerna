import {
  checkWorkingTree as _checkWorkingTree,
  collectProjectUpdates as _collectUpdates,
  output as _output,
  promptConfirmation,
  promptSelectOne as _promptSelectOne,
  throwIfUncommitted as _throwIfUncommitted,
} from "@lerna/core";
import {
  commandRunner,
  getCommitMessage,
  gitAdd,
  gitCommit,
  gitSHASerializer,
  gitTag,
  initFixtureFactory,
  loggingOutput,
  showCommit,
  tempDirSerializer,
} from "@lerna/test-helpers";
import execa from "execa";
import fs from "fs-extra";
import path from "path";
import _writePkg from "write-pkg";
import { gitPush as _libPush } from "./git-push";
import { isAnythingCommitted as _isAnythingCommitted } from "./is-anything-committed";
import { isBehindUpstream as _isBehindUpstream } from "./is-behind-upstream";
import { remoteBranchExists as _remoteBranchExists } from "./remote-branch-exists";

jest.mock("write-pkg", () => require("@lerna/test-helpers/__mocks__/write-pkg"));

jest.mock("@lerna/core", () => require("@lerna/test-helpers/__mocks__/@lerna/core"));

jest.mock("./git-push");
jest.mock("./is-anything-committed", () => ({
  isAnythingCommitted: jest.fn().mockReturnValue(true),
}));
jest.mock("./is-behind-upstream", () => ({
  isBehindUpstream: jest.fn().mockReturnValue(false),
}));
jest.mock("./remote-branch-exists", () => ({
  remoteBranchExists: jest.fn().mockResolvedValue(true),
}));

const throwIfUncommitted = jest.mocked(_throwIfUncommitted);
const checkWorkingTree = jest.mocked(_checkWorkingTree);

// The mocked version isn't the same as the real one
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const promptSelectOne = _promptSelectOne as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collectUpdates = _collectUpdates as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const writePkg = _writePkg as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const output = _output as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const libPush = _libPush as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isAnythingCommitted = _isAnythingCommitted as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isBehindUpstream = _isBehindUpstream as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remoteBranchExists = _remoteBranchExists as any;

const initFixture = initFixtureFactory(path.resolve(__dirname, "../../../publish"));

// certain tests need to use the real thing
const collectUpdatesActual = jest.requireActual("@lerna/core").collectProjectUpdates;

// file under test

const lernaVersion = commandRunner(require("../command"));

// assertion helpers
const listDirty = (cwd) =>
  // git ls-files --exclude-standard --modified --others
  execa("git", ["ls-files", "--exclude-standard", "--modified", "--others"], { cwd }).then((result) =>
    result.stdout.split("\n").filter(Boolean)
  );

// stabilize commit SHA
expect.addSnapshotSerializer(gitSHASerializer);

// normalize temp directory paths in snapshots
expect.addSnapshotSerializer(tempDirSerializer);

describe("VersionCommand", () => {
  describe("normal mode", () => {
    it("versions changed packages", async () => {
      const testDir = await initFixture("normal");
      // when --conventional-commits is absent,
      // --no-changelog should have _no_ effect
      await lernaVersion(testDir)("--no-changelog");

      expect(checkWorkingTree).toHaveBeenCalled();

      expect(promptSelectOne.mock.calls).toMatchSnapshot("prompt");
      expect(promptConfirmation).toHaveBeenLastCalledWith("Are you sure you want to create these versions?");

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot("commit");

      expect(libPush).toHaveBeenLastCalledWith(
        "origin",
        "main",
        expect.objectContaining({
          cwd: testDir,
        })
      );
      expect(output.logged()).toMatchSnapshot("console output");
    });

    it("should error when --skip-git is used", async () => {
      const testDir = await initFixture("normal");
      await expect(lernaVersion(testDir)("--skip-git")).rejects.toThrowErrorMatchingInlineSnapshot(
        `"--skip-git was replaced by --no-git-tag-version --no-push. We recommend running \`lerna repair\` in order to ensure your lerna.json is up to date, otherwise check your CLI usage and/or any configs you extend from."`
      );
    });

    it("throws an error when --independent is passed", async () => {
      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)("--independent");

      await expect(command).rejects.toThrow("independent");
    });

    it("throws an error if conventional prerelease and graduate flags are both passed", async () => {
      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)("--conventional-prerelease", "--conventional-graduate");

      await expect(command).rejects.toThrow(
        "--conventional-prerelease cannot be combined with --conventional-graduate."
      );
    });

    it("throws an error when remote branch doesn't exist", async () => {
      remoteBranchExists.mockReturnValueOnce(false);

      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)();

      await expect(command).rejects.toThrow("doesn't exist in remote");
    });

    it("throws an error when uncommitted changes are present", async () => {
      checkWorkingTree.mockImplementationOnce(() => {
        throw new Error("uncommitted");
      });

      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)();

      await expect(command).rejects.toThrow("uncommitted");
      // notably different than the actual message, but good enough here
    });

    it("throws an error when current ref is already tagged", async () => {
      checkWorkingTree.mockImplementationOnce(() => {
        throw new Error("released");
      });

      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)();

      await expect(command).rejects.toThrow("released");
      // notably different than the actual message, but good enough here
    });

    it("calls `throwIfUncommitted` when using --force-publish", async () => {
      const testDir = await initFixture("normal");

      await lernaVersion(testDir)("--force-publish");

      expect(throwIfUncommitted).toHaveBeenCalled();
    });

    it("only bumps changed packages when non-major version selected", async () => {
      const testDir = await initFixture("normal");

      collectUpdates.setUpdated(testDir, "package-3");
      promptSelectOne.chooseBump("minor");

      await lernaVersion(testDir)();

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("bumps all packages when major version selected", async () => {
      const testDir = await initFixture("normal");

      collectUpdates.setUpdated(testDir, "package-3");
      promptSelectOne.chooseBump("major");

      await lernaVersion(testDir)();

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("does not bump major of private packages with --no-private", async () => {
      const testDir = await initFixture("normal");

      // despite being a pendant leaf...
      collectUpdates.setUpdated(testDir, "package-4");
      promptSelectOne.chooseBump("major");

      await lernaVersion(testDir)("--no-private");

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
      // ...all packages are still majored
      expect(patch).toContain("package-1");
    });
  });

  describe("independent mode", () => {
    it("versions changed packages", async () => {
      // mock version prompt choices
      promptSelectOne.chooseBump("patch");
      promptSelectOne.chooseBump("minor");
      promptSelectOne.chooseBump("major");
      promptSelectOne.chooseBump("minor");
      promptSelectOne.chooseBump("patch");
      promptSelectOne.chooseBump("minor");

      const testDir = await initFixture("independent");
      await lernaVersion(testDir)(); // --independent is only valid in InitCommand

      expect(promptConfirmation).toHaveBeenCalled();

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot("commit");

      expect(libPush).toHaveBeenLastCalledWith(
        "origin",
        "main",
        expect.objectContaining({
          cwd: testDir,
        })
      );
      expect(output.logged()).toMatchSnapshot("console output");
    });
  });

  describe("--no-commit-hooks", () => {
    const setupPreCommitHook = (cwd) =>
      fs.outputFile(path.join(cwd, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    it("passes --no-verify to git commit execution", async () => {
      const cwd = await initFixture("normal");

      await setupPreCommitHook(cwd);
      await lernaVersion(cwd)("--no-commit-hooks");

      const message = await getCommitMessage(cwd);
      expect(message).toBe("v1.0.1");
    });

    it("consumes configuration from lerna.json", async () => {
      const cwd = await initFixture("normal");

      await setupPreCommitHook(cwd);
      await fs.outputJSON(path.join(cwd, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          publish: {
            commitHooks: false,
          },
        },
      });
      await lernaVersion(cwd)();

      const message = await getCommitMessage(cwd);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("--no-git-tag-version", () => {
    it("versions changed packages without git commit or push", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--no-git-tag-version");

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      expect(libPush).not.toHaveBeenCalled();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git tag/commit");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toEqual([
        "lerna.json",
        "packages/package-1/package.json",
        "packages/package-2/package.json",
        "packages/package-3/package.json",
        "packages/package-4/package.json",
        "packages/package-5/package.json",
      ]);
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          publish: {
            gitTagVersion: false,
          },
        },
      });
      await lernaVersion(testDir)();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git tag/commit");
    });

    it("skips dirty working tree validation", async () => {
      const testDir = await initFixture("normal");
      await fs.outputFile(path.join(testDir, "packages/package-1/hello.js"), "world");
      await lernaVersion(testDir)("--no-git-tag-version");

      expect(checkWorkingTree).not.toHaveBeenCalled();

      const logMessages = loggingOutput("warn");
      expect(logMessages).toContain("Skipping working tree validation, proceed at your own risk");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toContain("packages/package-1/hello.js");
    });
  });

  // TODO: (major) make --no-granular-pathspec the default
  describe("--no-granular-pathspec", () => {
    const getLeftover = (cwd) =>
      execa("git", ["ls-files", "--others"], { cwd }).then((result) => result.stdout);

    it("adds changed files globally", async () => {
      const cwd = await initFixture("normal");
      await fs.outputFile(path.join(cwd, ".gitignore"), "packages/dynamic");
      await fs.outputJSON(path.join(cwd, "packages/dynamic/package.json"), {
        name: "dynamic",
        version: "1.0.0",
      });
      // a "dynamic", intentionally unversioned package must _always_ be forced
      await lernaVersion(cwd)("--force-publish=dynamic", "--no-granular-pathspec");

      const leftover = await getLeftover(cwd);
      expect(leftover).toBe("packages/dynamic/package.json");
    });

    it("consumes configuration from lerna.json", async () => {
      const cwd = await initFixture("normal");
      await fs.outputFile(path.join(cwd, ".gitignore"), "packages/dynamic");
      await fs.outputJSON(path.join(cwd, "packages/dynamic/package.json"), {
        name: "dynamic",
        version: "1.0.0",
      });
      await fs.outputJSON(path.join(cwd, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        granularPathspec: false,
      });
      // a "dynamic", intentionally unversioned package must _always_ be forced
      await lernaVersion(cwd)("--force-publish=dynamic");

      const leftover = await getLeftover(cwd);
      expect(leftover).toBe("packages/dynamic/package.json");
    });
  });

  // TODO: (major) make --no-private the default
  describe("--no-private", () => {
    it("does not universally version private packages", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--no-private");

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });

    it("does not independently version private packages", async () => {
      const testDir = await initFixture("independent");
      await lernaVersion(testDir)("--no-private");

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          version: {
            private: false,
          },
        },
      });
      await lernaVersion(testDir)();

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });
  });

  describe("--no-push", () => {
    it("versions changed packages without git push", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--no-push");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();

      expect(libPush).not.toHaveBeenCalled();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git push");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toEqual([]);
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          publish: {
            push: false,
          },
        },
      });
      await lernaVersion(testDir)();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git push");
    });
  });

  describe("--tag-version-prefix", () => {
    it("versions changed packages with custom tag prefix", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--tag-version-prefix", "rev");

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: rev1.0.1");
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          publish: {
            tagVersionPrefix: "durable",
          },
        },
      });
      await lernaVersion(testDir)();

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: durable1.0.1");
    });

    it("omits tag prefix when passed empty string", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--tag-version-prefix", "");

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: 1.0.1");
    });
  });

  describe("--yes", () => {
    it("skips confirmation prompt", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--yes", "patch");

      expect(promptSelectOne).not.toHaveBeenCalled();
      expect(promptConfirmation).not.toHaveBeenCalled();

      const message = await getCommitMessage(testDir);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("--json", () => {
    it("prints json format", async () => {
      const testDir = await initFixture("normal");

      await lernaVersion(testDir)("--yes", "--json", "patch");

      // Output should be a parseable string
      const jsonOutput = JSON.parse(output.logged());
      expect(jsonOutput).toMatchInlineSnapshot(`
Array [
  Object {
    "location": "__TEST_ROOTDIR__/packages/package-1",
    "name": "package-1",
    "newVersion": "1.0.1",
    "private": false,
    "version": "1.0.0",
  },
  Object {
    "location": "__TEST_ROOTDIR__/packages/package-2",
    "name": "package-2",
    "newVersion": "1.0.1",
    "private": false,
    "version": "1.0.0",
  },
  Object {
    "location": "__TEST_ROOTDIR__/packages/package-3",
    "name": "package-3",
    "newVersion": "1.0.1",
    "private": false,
    "version": "1.0.0",
  },
  Object {
    "location": "__TEST_ROOTDIR__/packages/package-4",
    "name": "package-4",
    "newVersion": "1.0.1",
    "private": false,
    "version": "1.0.0",
  },
  Object {
    "location": "__TEST_ROOTDIR__/packages/package-5",
    "name": "package-5",
    "newVersion": "1.0.1",
    "private": true,
    "version": "1.0.0",
  },
]
`);
    });

    it("prints NO json format", async () => {
      const testDir = await initFixture("normal");

      await lernaVersion(testDir)("--yes", "patch");

      expect(output.logged()).toMatchInlineSnapshot(`
"
Changes:
 - package-1: 1.0.0 => 1.0.1
 - package-2: 1.0.0 => 1.0.1
 - package-3: 1.0.0 => 1.0.1
 - package-4: 1.0.0 => 1.0.1
 - package-5: 1.0.0 => 1.0.1 (private)
"
`);
    });
  });

  describe("--exact", () => {
    it("updates matching local dependencies of published packages with exact versions", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--exact");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("updates existing exact versions", async () => {
      const testDir = await initFixture("normal-exact");
      await lernaVersion(testDir)();

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });
  });

  describe("--git-remote", () => {
    it("pushes tags to specified remote", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--git-remote", "upstream");

      expect(libPush).toHaveBeenLastCalledWith(
        "upstream",
        "main",
        expect.objectContaining({
          cwd: testDir,
        })
      );
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        packages: ["packages/*"],
        command: {
          publish: {
            gitRemote: "durable",
          },
        },
      });
      await lernaVersion(testDir)();

      expect(libPush).toHaveBeenLastCalledWith(
        "durable",
        "main",
        expect.objectContaining({
          cwd: testDir,
        })
      );
    });
  });

  describe("--amend", () => {
    it("amends the previous commit", async () => {
      const testDir = await initFixture("normal", "previous");
      await lernaVersion(testDir)("--amend");

      const message = await getCommitMessage(testDir);
      expect(message).toBe("previous");

      expect(checkWorkingTree).not.toHaveBeenCalled();
    });

    it("considers custom messages", async () => {
      const testDir = await initFixture("normal", "preserved");
      await lernaVersion(testDir)("-m", "custom", "--amend");

      const message = await getCommitMessage(testDir);

      expect(message).toBe("custom");
    });
  });

  describe("--amend --independent", () => {
    it("amends the previous commit", async () => {
      const testDir = await initFixture("independent", "previous");
      await lernaVersion(testDir)("--amend");

      const message = await getCommitMessage(testDir);
      expect(message).toBe("previous");
    });
  });

  describe("when local clone is behind upstream", () => {
    it("throws an error during interactive publish", async () => {
      isBehindUpstream.mockReturnValueOnce(true);

      const testDir = await initFixture("normal");
      const command = lernaVersion(testDir)("--no-ci");

      await expect(command).rejects.toThrow("Please merge remote changes");
    });

    it("logs a warning and exits early during CI publish", async () => {
      isBehindUpstream.mockReturnValueOnce(true);

      const testDir = await initFixture("normal");

      await lernaVersion(testDir)("--ci");

      const [warning] = loggingOutput("warn");
      expect(warning).toMatch("behind remote upstream");
      expect(warning).toMatch("exiting");
    });
  });

  describe("unversioned packages", () => {
    it("exits with an error for non-private packages with no version", async () => {
      const testDir = await initFixture("not-versioned");
      const command = lernaVersion(testDir)();

      await expect(command).rejects.toThrow("A version field is required in package-3's package.json file.");
    });

    it("ignores private packages with no version", async () => {
      const testDir = await initFixture("not-versioned-private");
      await lernaVersion(testDir)();
      expect(Object.keys(writePkg.updatedVersions())).not.toContain("package-4");
    });
  });

  describe("working on a detached HEAD", () => {
    const detachedHEAD = async (fixture = "normal") => {
      const cwd = await initFixture(fixture);
      const { stdout: sha } = await execa("git", ["rev-parse", "HEAD"], { cwd });
      await execa("git", ["checkout", sha], { cwd });
      return cwd;
    };

    it("throws by default", async () => {
      const cwd = await detachedHEAD();
      const command = lernaVersion(cwd)();

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });

    it("does not throw for version --no-git-tag-version", async () => {
      const cwd = await detachedHEAD();
      await lernaVersion(cwd)("--no-git-tag-version");
      const unstaged = await listDirty(cwd);
      expect(unstaged).toEqual([
        "lerna.json",
        "packages/package-1/package.json",
        "packages/package-2/package.json",
        "packages/package-3/package.json",
        "packages/package-4/package.json",
        "packages/package-5/package.json",
      ]);
    });

    it("throws for version --conventional-commits", async () => {
      const cwd = await detachedHEAD();
      const command = lernaVersion(cwd)("--no-git-tag-version", "--conventional-commits");

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });

    it("throws for version --allow-branch", async () => {
      const cwd = await detachedHEAD();
      const command = lernaVersion(cwd)("--no-git-tag-version", "--allow-branch", "main");

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });
  });

  it("exits with an error when no commits are present", async () => {
    isAnythingCommitted.mockReturnValueOnce(false);

    const testDir = await initFixture("normal", false);
    const command = lernaVersion(testDir)();

    await expect(command).rejects.toThrow(
      "No commits in this repository. Please commit something before using version."
    );
  });

  it("exits early when no changes found", async () => {
    const cwd = await initFixture("normal");

    collectUpdates.setUpdated(cwd);

    await lernaVersion(cwd)();

    const logMessages = loggingOutput("success");
    expect(logMessages).toContain("No changed packages to version");
  });

  it("versions all transitive dependents after change", async () => {
    const testDir = await initFixture("snake-graph");

    await gitTag(testDir, "v1.0.0");
    await fs.outputFile(path.join(testDir, "packages/package-1/hello.js"), "world");
    await gitAdd(testDir, ".");
    await gitCommit(testDir, "feat: hello");

    collectUpdates.mockImplementationOnce(collectUpdatesActual);

    await lernaVersion(testDir)("major", "--yes");

    const patch = await showCommit(testDir);
    expect(patch).toMatchSnapshot();
  });

  it("versions all packages with cycles", async () => {
    const testDir = await initFixture("cycle-parent");

    await gitTag(testDir, "v1.0.0");

    await Promise.all(
      ["a", "b", "c", "d"].map((n) => fs.outputFile(path.join(testDir, "packages", n, "index.js"), "hello"))
    );
    await gitAdd(testDir, ".");
    await gitCommit(testDir, "feat: hello");

    collectUpdates.mockImplementationOnce(collectUpdatesActual);

    await lernaVersion(testDir)("major", "--yes");

    const patch = await showCommit(testDir, "--name-only");
    expect(patch).toMatchInlineSnapshot(`
      "v2.0.0

      HEAD -> main, tag: v2.0.0

      lerna.json
      packages/a/package.json
      packages/b/package.json
      packages/c/package.json
      packages/d/package.json"
    `);
  });

  describe("with relative file: specifiers", () => {
    const setupChanges = async (cwd, pkgRoot = "packages") => {
      await gitTag(cwd, "v1.0.0");
      await fs.outputFile(path.join(cwd, `${pkgRoot}/package-1/hello.js`), "world");
      await gitAdd(cwd, ".");
      await gitCommit(cwd, "setup");
    };

    it("does not overwrite relative specifier in git commit", async () => {
      const testDir = await initFixture("relative-file-specs");

      await setupChanges(testDir);
      await lernaVersion(testDir)("major", "--yes");

      expect(writePkg.updatedVersions()).toEqual({
        "package-1": "2.0.0",
        "package-2": "2.0.0",
        "package-3": "2.0.0",
        "package-4": "2.0.0",
        "package-5": "2.0.0",
        "package-6": "2.0.0",
        "package-7": "2.0.0",
        "package-8": "2.0.0",
        "package-9": "2.0.0",
        "package-a": "2.0.0",
        "package-b": "2.0.0",
        "package-c": "2.0.0",
        "package-d": "2.0.0",
        "package-e": "2.0.0",
        "package-f": "2.0.0",
      });

      // package-1 has no relative file: dependencies
      expect(writePkg.updatedManifest("package-2").dependencies).toMatchObject({
        "package-1": "file:../package-1",
      });
      expect(writePkg.updatedManifest("package-3").dependencies).toMatchObject({
        "package-2": "file:../package-2",
      });
      expect(writePkg.updatedManifest("package-4").optionalDependencies).toMatchObject({
        "package-3": "file:../package-3",
      });
      expect(writePkg.updatedManifest("package-5").dependencies).toMatchObject({
        "package-4": "file:../package-4",
        "package-6": "file:../package-6",
      });
      expect(writePkg.updatedManifest("package-8").peerDependencies).toMatchObject({
        "package-1": "file:../package-1",
      });
      expect(writePkg.updatedManifest("package-9").peerDependencies).toMatchObject({
        "package-1": "^1.0.0",
      });
      expect(writePkg.updatedManifest("package-a").peerDependencies).toMatchObject({
        "package-1": "workspace:*",
      });
      expect(writePkg.updatedManifest("package-b").peerDependencies).toMatchObject({
        "package-1": "workspace:^",
      });
      expect(writePkg.updatedManifest("package-c").peerDependencies).toMatchObject({
        "package-1": "workspace:~",
      });
      expect(writePkg.updatedManifest("package-d").peerDependencies).toMatchObject({
        "package-1": "workspace:^2.0.0",
      });
      expect(writePkg.updatedManifest("package-e").peerDependencies).toMatchObject({
        "package-1": "workspace:~2.0.0",
      });
      expect(writePkg.updatedManifest("package-f").peerDependencies).toMatchObject({
        "package-1": "workspace:2.0.0",
      });
    });
  });

  describe("--include-merged-tags", () => {
    it("accepts --include-merged-tags", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--include-merged-tags", "--yes", "patch");

      expect(promptSelectOne).not.toHaveBeenCalled();
      expect(promptConfirmation).not.toHaveBeenCalled();

      const message = await getCommitMessage(testDir);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("with leaf lockfiles", () => {
    it("updates lockfile version to new package version", async () => {
      const cwd = await initFixture("lockfile-leaf");
      await lernaVersion(cwd)("--yes", "major");

      const changedFiles = await showCommit(cwd, "--name-only");
      expect(changedFiles).toContain("packages/package-1/package-lock.json");
    });
  });

  describe("with spurious -- arguments", () => {
    it("ignores the extra arguments with cheesy parseConfiguration()", async () => {
      const cwd = await initFixture("lifecycle");
      await lernaVersion(cwd)("--yes", "--", "--loglevel", "ignored", "--blah");

      const logMessages = loggingOutput("warn");
      expect(logMessages).toContain("Arguments after -- are no longer passed to subprocess executions.");
    });
  });
});
