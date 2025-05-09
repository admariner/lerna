export { addDependencies } from "./lib/add-dependencies";
export { addDependents } from "./lib/add-dependents";
export { checkWorkingTree, throwIfUncommitted } from "./lib/check-working-tree";
export * from "./lib/cli";
export {
  ProjectCollectorOptions,
  ProjectUpdateCollectorOptions,
  collectProjectUpdates,
  collectProjects,
} from "./lib/collect-updates";
export { Command, ExecOptions, LernaLogger, PreInitializedProjectData, Arguments } from "./lib/command";
export { detectProjects } from "./lib/command/detect-projects";
export { isGitInitialized } from "./lib/command/is-git-initialized";
export { applyBuildMetadata, recommendVersion, updateChangelog } from "./lib/conventional-commits";
export * from "./lib/corepack";
export { describeRef, describeRefSync } from "./lib/describe-ref";
export { FilterOptions, filterOptions } from "./lib/filter-options";
export { filterProjects } from "./lib/filter-projects";
export { getPackageManifestPath } from "./lib/get-package-manifest-path";
export * from "./lib/get-packages-for-option";
export { gitCheckout } from "./lib/git-checkout";
export { hasNpmVersion } from "./lib/has-npm-version";
export { formatJSON, listableFormatProjects } from "./lib/listable-format-projects";
export { ListableOptions, listableOptions } from "./lib/listable-options";
export { logPacked } from "./lib/log-packed";
export { Conf } from "./lib/npm-conf/conf";
export { npmInstall, npmInstallDependencies } from "./lib/npm-install";
export { npmPublish } from "./lib/npm-publish";
export { npmRunScript, npmRunScriptStreaming } from "./lib/npm-run-script";
export { getOneTimePassword } from "./lib/otplease";
export { output } from "./lib/output";
export { Packed, packDirectory } from "./lib/pack-directory";
export { AssetDefinition, ExtendedNpaResult, Package, RawManifest } from "./lib/package";
export { prereleaseIdFromVersion } from "./lib/prerelease-id-from-version";
export { Profiler, generateProfileOutputPath } from "./lib/profiler";
export { CommandConfigOptions, LernaConfig, Project, getPackages } from "./lib/project";
export {
  ProjectGraphProjectNodeWithPackage,
  ProjectGraphWithPackages,
  ProjectGraphWorkspacePackageDependency,
  getPackage,
  isExternalNpmDependency,
} from "./lib/project-graph-with-packages";
export { promptConfirmation, promptSelectOne, promptTextInput } from "./lib/prompt";
export { pulseTillDone } from "./lib/pulse-till-done";
export { rimrafDir } from "./lib/rimraf-dir";
export { createRunner, runLifecycle } from "./lib/run-lifecycle";
export { runProjectsTopologically } from "./lib/run-projects-topologically";
export { createGitHubClient, createGitLabClient, parseGitRepo } from "./lib/scm-clients";
export { default as tempWrite } from "./lib/temp-write";
export { timer } from "./lib/timer";
export { toposortProjects } from "./lib/toposort-projects";
export { ValidationError } from "./lib/validation-error";
export { default as log, Logger } from "./lib/npmlog";
export { npmConf, npmDistTag };

const npmConf = require("./lib/npm-conf");

const npmDistTag = require("./lib/npm-dist-tag");
