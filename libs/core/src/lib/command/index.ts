import { ProjectFileMap } from "@nx/devkit";
import { ExecOptions as NodeExecOptions } from "child_process";
import cloneDeep from "clone-deep";
import dedent from "dedent";
import { daemonClient } from "nx/src/daemon/client/client";
import os from "os";
import yargs from "yargs";
import log, { Logger } from "../npmlog";
import { CommandConfigOptions, Project } from "../project";
import { ProjectGraphWithPackages } from "../project-graph-with-packages";
import { ValidationError } from "../validation-error";
import { writeLogFile } from "../write-log-file";
import { cleanStack } from "./clean-stack";
import { defaultOptions } from "./default-options";
import { detectProjects } from "./detect-projects";
import { isGitInitialized } from "./is-git-initialized";
import { logPackageError } from "./log-package-error";
import { warnIfHanging } from "./warn-if-hanging";

/**
 * Execa compatible options type
 *
 * Current used execa version options type uses```cwd: string``` and not
 * ``` cwd?: string | URL ```
 *
 * Can be removed when latest execa version is used!!!
 * */
export type ExecOptions = Omit<NodeExecOptions, "cwd"> & { cwd?: string };

const DEFAULT_CONCURRENCY = os.cpus().length;

/**
 * Specific logger with log-level success enabled in order to use function without index signature
 */
export interface LernaLogger extends Logger {
  /**
   * Log with level success
   * @param prefix
   * @param message
   * @param args
   */
  success(prefix: string, message: string, ...args: any[]): void;
}
export interface PreInitializedProjectData {
  projectFileMap: ProjectFileMap;
  projectGraph: ProjectGraphWithPackages;
}

export type Arguments<T extends CommandConfigOptions = CommandConfigOptions> = {
  cwd?: string;
  composed?: string;
  lernaVersion?: string;
  onResolved?: (value: unknown) => unknown;
  onRejected?: (reason: unknown) => unknown;
} & yargs.ArgumentsCamelCase<T>;

export class Command<T extends CommandConfigOptions = CommandConfigOptions> {
  name: string;
  composed: boolean;
  options: T = {} as T;
  runner: Promise<unknown>;
  concurrency = 0;
  toposort = false;
  execOpts: ExecOptions = {};
  logger!: LernaLogger;
  envDefaults: any;
  argv: Arguments<T> = {} as Arguments<T>;
  projectGraph!: ProjectGraphWithPackages;
  projectFileMap!: ProjectFileMap;

  private _project?: Project;
  get project(): Project {
    if (this._project === undefined) {
      throw new ValidationError("ENOPROJECT", "Lerna Project not initialized!");
    }
    return this._project;
  }

  set project(project: Project) {
    this._project = project;
  }

  constructor(
    _argv: Arguments<T>,
    {
      skipValidations,
      preInitializedProjectData,
    }: {
      skipValidations: boolean;
      preInitializedProjectData?: PreInitializedProjectData;
    } = { skipValidations: false }
  ) {
    log.pause();
    log.heading = "lerna";

    const argv = cloneDeep(_argv);
    log.silly("argv", argv);

    // "FooCommand" => "foo"
    this.name = this.constructor.name.replace(/Command$/, "").toLowerCase();

    // composed commands are called from other commands, like publish -> version
    this.composed = typeof argv.composed === "string" && argv.composed !== this.name;

    if (!this.composed) {
      // composed commands have already logged the lerna version
      log.notice("cli", `v${argv.lernaVersion}`);
    }

    // launch the command
    let runner = new Promise((resolve, reject) => {
      // run everything inside a Promise chain
      let chain: Promise<unknown> = Promise.resolve();

      chain = chain.then(() => {
        this.project = new Project(argv.cwd, { skipLernaConfigValidations: skipValidations });
      });
      chain = chain.then(() => this.configureEnvironment());
      chain = chain.then(() => this.configureOptions());
      chain = chain.then(() => this.configureProperties());
      chain = chain.then(() => {
        // create logger that subclasses use
        this.logger = Command.createLogger(this.name, this.options.loglevel);
      });
      // For the special "repair" command we want to initialize everything but don't want to run validations as that will end up becoming cyclical
      if (!skipValidations) {
        chain = chain.then(() => this.runValidations());
      }
      chain = chain.then(() => {
        /**
         * Due to lerna publish's legacy of being backwards compatible with running versioning and publishing
         * in a single step, we need to be able to receive any project data which might already exist from the
         * publish command (in the case that it invokes the version command from within its implementation details).
         */
        if (preInitializedProjectData) {
          this.projectFileMap = preInitializedProjectData.projectFileMap;
          this.projectGraph = preInitializedProjectData.projectGraph;
          return;
        }
        return this.detectProjects();
      });
      chain = chain.then(() => this.runPreparations());
      chain = chain.then(() => this.runCommand());

      chain.then(
        (result) => {
          warnIfHanging();

          // Now that we have made our calls to the daemon, we need it to exit so that the overall process can too
          daemonClient.reset();

          resolve(result);
        },
        (err) => {
          if (err.pkg) {
            // Cleanly log specific package error details
            logPackageError(err, this.options.stream);
          } else if (err.name !== "ValidationError") {
            // npmlog does some funny stuff to the stack by default,
            // so pass it directly to avoid duplication.
            log.error("", cleanStack(err, this.constructor.name));
          }

          // ValidationError does not trigger a log dump, nor do external package errors
          if (err.name !== "ValidationError" && !err.pkg) {
            writeLogFile(this.project.rootPath);
          }

          warnIfHanging();

          // Now that we have made our calls to the daemon, we need it to exit so that the overall process can too
          daemonClient.reset();

          // error code is handled by cli.fail()
          reject(err);
        }
      );
    });

    // passed via yargs context in tests, never actual CLI
    /* istanbul ignore else */
    if (argv.onResolved || argv.onRejected) {
      runner = runner.then(argv.onResolved, argv.onRejected);

      // when nested, never resolve inner with outer callbacks
      delete argv.onResolved;
      delete argv.onRejected;
    }

    // "hide" irrelevant argv keys from options
    for (const key of ["cwd", "$0"]) {
      Object.defineProperty(argv, key, { enumerable: false });
    }

    Object.defineProperty(this, "argv", {
      value: Object.freeze(argv),
    });

    this.runner = runner;
  }

  static createLogger(name: string, loglevel?: string): LernaLogger {
    if (loglevel) {
      log.level = loglevel;
    }
    // handle log.success()
    log.addLevel("success", 3001, { fg: "green", bold: true });
    // emit all buffered logs at configured level and higher
    log.resume();
    return log["newGroup"](name);
  }

  // proxy "Promise" methods to "private" instance
  then(onResolved: () => void, onRejected: (err: string | Error) => void) {
    return this.runner.then(onResolved, onRejected);
  }

  /* istanbul ignore next */
  catch(onRejected: (err: string | Error) => void) {
    return this.runner.catch(onRejected);
  }

  get requiresGit() {
    return true;
  }

  // Override this to inherit config from another command.
  // For example `changed` inherits config from `publish`.
  get otherCommandConfigs(): string[] {
    return [];
  }

  async detectProjects() {
    const { projectGraph, projectFileMap } = await detectProjects(this.project.packageConfigs);

    this.projectGraph = projectGraph;
    this.projectFileMap = projectFileMap;
  }

  configureEnvironment() {
    const ci = require("is-ci");
    let loglevel;
    let progress;

    /* istanbul ignore next */
    if (ci || !process.stderr.isTTY) {
      log.disableColor();
      progress = false;
    } else if (!process.stdout.isTTY) {
      // stdout is being piped, don't log non-errors or progress bars
      progress = false;
      loglevel = "error";
    } else if (process.stderr.isTTY) {
      log.enableColor();
      log.enableUnicode();
    }

    Object.defineProperty(this, "envDefaults", {
      value: {
        ci,
        progress,
        loglevel,
      },
    });
  }

  configureOptions() {
    // Command config object normalized to "command" namespace
    const commandConfig = this.project.config.command || {};

    // The current command always overrides otherCommandConfigs
    const overrides = [this.name, ...this.otherCommandConfigs].map((key) => commandConfig[key]);

    this.options = defaultOptions(
      // CLI flags, which if defined overrule subsequent values
      this.argv,
      // Namespaced command options from `lerna.json`
      ...overrides,
      // Global options from `lerna.json`
      this.project.config,
      // Environmental defaults prepared in previous step
      this.envDefaults
    );

    if (this.options.verbose && this.options.loglevel !== "silly") {
      this.options.loglevel = "verbose";
    }
  }

  configureProperties() {
    const { concurrency = 0, sort, maxBuffer } = this.options;
    this.concurrency = Math.max(1, +concurrency || DEFAULT_CONCURRENCY);
    this.toposort = sort === undefined || sort;
    this.execOpts = {
      cwd: this.project.rootPath,
      maxBuffer,
    };
  }

  enableProgressBar() {
    /* istanbul ignore next */
    if (this.options.progress !== false) {
      log.enableProgress();
    }
  }

  runValidations() {
    if ((this.options.since !== undefined || this.requiresGit) && !isGitInitialized(this.project.rootPath)) {
      throw new ValidationError(
        "ENOGIT",
        "The git binary was not found, this is not a git repository, or you git doesn't have the right ownership. Run `git rev-parse` to get more details."
      );
    }

    if (this.options.independent && !this.project.isIndependent()) {
      throw new ValidationError(
        "EVERSIONMODE",
        dedent`
          You ran lerna with --independent or -i, but the repository is not set to independent mode.
          To use independent mode you need to set lerna.json's "version" property to "independent".
          Then you won't need to pass the --independent or -i flags.
        `
      );
    }
  }

  runPreparations() {
    if (!this.composed && this.project.isIndependent()) {
      // composed commands have already logged the independent status
      log.info("versioning", "independent");
    }

    if (!this.composed && this.options.ci) {
      log.info("ci", "enabled");
    }
  }

  async runCommand(): Promise<unknown> {
    const proceed = await this.initialize();
    if (proceed !== false) {
      return this.execute();
    }
    return undefined;
  }

  initialize(): void | boolean | Promise<void | boolean> {
    throw new ValidationError(this.name, "initialize() needs to be implemented.");
  }

  /**
   * The execute() method can return a value in some cases (e.g. on the version command)
   */
  execute(): void | Promise<unknown> {
    throw new ValidationError(this.name, "execute() needs to be implemented.");
  }
}
