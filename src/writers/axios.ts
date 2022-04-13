import path from 'path';
import { Project, SourceFile, StructureKind, ts } from 'ts-morph';
import { Config } from '../config';
import { Parser, Writer } from '../types';

class AxiosWriter extends Writer {
  protected readonly requestsFile: string;
  protected readonly typesFile: string;

  constructor(protected readonly config: Config.AxiosOutput, parser: Parser) {
    super(config, parser);
    if (typeof config.dest === 'string') {
      this.requestsFile = this.typesFile = config.dest;
    } else {
      this.requestsFile = config.dest.requestFile;
      this.typesFile = config.dest.typesFile;
    }
  }

  write(stream?: boolean): void {
    const { config, parser } = this;
    const project = new Project();
    let requestsSrc: SourceFile;
    let typesSrc: SourceFile;

    // create single source file
    requestsSrc = project.createSourceFile(this.requestsFile, config.comment, {
      overwrite: true,
    });
    if (this.requestsFile === this.typesFile) {
      typesSrc = requestsSrc;
    } else {
      typesSrc = project.createSourceFile(this.typesFile, config.comment, {
        overwrite: true,
      });
    }

    const types = Array.from(parser.getTypes());
    const controllers = Array.from(parser.getControllers());

    // import http module
    requestsSrc.addImportDeclaration({
      defaultImport: 'http',
      moduleSpecifier: this.resolveHttpModule(),
    });

    // create modules
    requestsSrc.addModules(
      controllers.map(({ name, docs, requests }) => ({
        name,
        docs,
        isExported: true,
        statements: Array.from(requests).map((func) => ({
          kind: StructureKind.Function,
          ...func,
        })),
      })),
    );

    if (typesSrc !== requestsSrc) {
      requestsSrc.addImportDeclaration({
        namedImports: types.map((t) => t.name),
        moduleSpecifier: path.relative(
          path.dirname(this.requestsFile),
          this.typesFile,
        ),
      });
    }

    // add types
    for (const type of types) {
      switch (type.kind) {
        case StructureKind.Interface:
          typesSrc.addInterface(type);
          break;
        case StructureKind.Enum:
          typesSrc.addEnum(type);
          break;
        case StructureKind.TypeAlias:
          typesSrc.addTypeAlias(type);
          break;
      }
    }

    // write to filesystem or stream
    if (stream) {
      process.stdout.write(requestsSrc.print({ scriptKind: ts.ScriptKind.TS }));
      if (typesSrc !== requestsSrc) {
        process.stdout.write(typesSrc.print({ scriptKind: ts.ScriptKind.TS }));
      }
    } else {
      if (config.formatSettings) {
        requestsSrc.formatText(config.formatSettings as any);
        if (typesSrc !== requestsSrc) {
          typesSrc.formatText(config.formatSettings as any);
        }
      }
      requestsSrc.saveSync();
      if (typesSrc !== requestsSrc) {
        typesSrc.saveSync();
      }
    }
  }

  private resolveHttpModule() {
    // add http module import
    const { httpModule } = this.config;
    let httpModulePath: string;
    if (!httpModule) {
      httpModulePath = 'axios';
    } else {
      httpModulePath = path.relative(
        path.dirname(this.requestsFile),
        httpModule,
      );
      const { dir, name } = path.parse(httpModulePath);
      httpModulePath = path.join(dir, name);
      if (!httpModulePath.startsWith('/')) {
        httpModulePath = './' + httpModulePath;
      }
    }
    return httpModulePath;
  }
}

export default AxiosWriter;
