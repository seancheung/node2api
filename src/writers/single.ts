import path from 'path';
import { Project, ts } from 'ts-morph';
import { Writer } from '../types';

class SingleWiter extends Writer {
  write(stream?: boolean): void {
    const { config, parser } = this;
    const project = new Project();
    const controllers = project.addSourceFilesAtPaths(config.server.sources);
    const types = project.addSourceFilesAtPaths(config.server.types);

    // create single source file
    const src = project.createSourceFile(
      config.client.target,
      config.client.comment,
      { overwrite: true },
    );

    // import http module
    src.addImportDeclaration({
      defaultImport: 'http',
      moduleSpecifier: this.resolveHttpModule(),
    });

    // create modules and interfaces
    src.addModules(Array.from(parser.createModules(controllers)));
    src.addInterfaces(Array.from(parser.createInterfaces(types)));

    // write to filesystem or stream
    if (stream) {
      process.stdout.write(src.print({ scriptKind: ts.ScriptKind.TS }));
    } else {
      if (config.client.formatSettings) {
        src.formatText(config.client.formatSettings as any);
      }
      src.saveSync();
    }
  }

  private resolveHttpModule() {
    // add http module import
    const { httpModule, type = 'axios', target } = this.config.client;
    let httpModulePath: string;
    if (!httpModule) {
      httpModulePath = type;
    } else {
      httpModulePath = path.relative(path.dirname(target), httpModule);
      const { dir, name } = path.parse(httpModulePath);
      httpModulePath = path.join(dir, name);
      if (!httpModulePath.startsWith('/')) {
        httpModulePath = './' + httpModulePath;
      }
    }
    return httpModulePath;
  }
}

export default SingleWiter;
