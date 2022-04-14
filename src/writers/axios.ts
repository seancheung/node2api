import { dirname, join, parse, relative } from 'path';
import {
  FunctionDeclaration,
  ModuleDeclaration,
  ParameterDeclaration,
  printNode,
  Project,
  SourceFile,
  SyntaxKind,
  ts,
  TypeFormatFlags,
} from 'ts-morph';
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

    // import http module
    requestsSrc.addImportDeclaration({
      defaultImport: 'http',
      moduleSpecifier: this.resolveHttpModule(),
    });
    if (this.config.options) {
      requestsSrc.addImportDeclaration({
        namedImports: ['AxiosRequestConfig'],
        moduleSpecifier: 'axios',
        isTypeOnly: true,
      });
    }

    this.writeModules(requestsSrc);

    const typeNames = Array.from(this.writeTypes(typesSrc));
    if (typesSrc !== requestsSrc) {
      requestsSrc.addImportDeclaration({
        namedImports: typeNames,
        moduleSpecifier: resolveRelativeModule(
          this.typesFile,
          this.requestsFile,
        ),
      });
    }

    // format
    requestsSrc.fixUnusedIdentifiers();
    if (typesSrc !== requestsSrc) {
      typesSrc.fixUnusedIdentifiers();
    }
    if (config.formatSettings) {
      requestsSrc.formatText(config.formatSettings as any);
      if (typesSrc !== requestsSrc) {
        typesSrc.formatText(config.formatSettings as any);
      }
    }

    // write to filesystem or stream
    if (stream) {
      process.stdout.write(requestsSrc.print({ scriptKind: ts.ScriptKind.TS }));
      if (typesSrc !== requestsSrc) {
        process.stdout.write(typesSrc.print({ scriptKind: ts.ScriptKind.TS }));
      }
    } else {
      requestsSrc.saveSync();
      if (typesSrc !== requestsSrc) {
        typesSrc.saveSync();
      }
    }
  }

  protected writeModules(src: SourceFile): void {
    for (const controller of this.parser.getControllers()) {
      const mod = src.addModule({
        name: controller.name.toUpperCase(),
        docs: controller.docs.map((doc) => doc.getStructure()),
        isExported: true,
      });
      for (const request of controller.requests) {
        this.writeFunction(request, mod, controller.baseUrl);
      }
    }
  }

  protected writeFunction(
    request: Parser.Request,
    mod: ModuleDeclaration,
    baseUrl: string,
  ): void {
    const url = joinPaths(baseUrl, request.url);

    const func = mod.addFunction({
      name: request.func.getName(),
      isExported: true,
    });
    this.addTypeParameters(func, request);
    this.addParameters(func, request);
    this.addReturnType(func, request);
    this.addStatement(func, request, url);
    this.addDocs(func, request);
  }

  protected addTypeParameters(
    func: FunctionDeclaration,
    request: Parser.Request,
  ): void {
    for (const parameter of request.func.getTypeParameters()) {
      func.addTypeParameter(parameter.getStructure());
    }
  }

  protected addDocs(func: FunctionDeclaration, request: Parser.Request): void {
    for (const doc of request.func.getJsDocs()) {
      func.addJsDoc(doc.getStructure());
    }
  }

  protected addReturnType(
    func: FunctionDeclaration,
    request: Parser.Request,
  ): void {
    const returnType = request.res.getText(null, TypeFormatFlags.None);
    func.setReturnType(
      printNode(
        ts.factory.createTypeReferenceNode(
          ts.factory.createIdentifier('Promise'),
          [
            ts.factory.createTypeReferenceNode(
              ts.factory.createIdentifier(returnType),
            ),
          ],
        ),
      ),
    );
  }

  protected addParameters(
    func: FunctionDeclaration,
    request: Parser.Request,
  ): void {
    const parameters: ParameterDeclaration[] = [];
    if (request.params) {
      parameters.push(...request.params.map((p) => p.parameter));
    }
    if (request.query) {
      if (Array.isArray(request.query)) {
        parameters.push(...request.query.map((p) => p.parameter));
      } else {
        parameters.push(request.query);
      }
    }
    if (request.data) {
      if (Array.isArray(request.data)) {
        parameters.push(...request.data.map((p) => p.parameter));
      } else {
        parameters.push(request.data);
      }
    }
    func.addParameters(
      parameters.map((parameter) => ({
        name: parameter.getName(),
        type: parameter.getType().getText(null, TypeFormatFlags.None),
        hasQuestionToken: parameter.isOptional(),
      })),
    );
    if (this.config.options) {
      func.addParameter({
        name: this.config.options,
        type: 'AxiosRequestConfig',
        hasQuestionToken: true,
      });
    }
  }

  protected addStatement(
    func: FunctionDeclaration,
    request: Parser.Request,
    url: string,
  ): void {
    const opts = createRequestOptions(request, url, this.config.options);
    const lib = ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier('http'),
      'request',
    );
    func.addStatements(
      printNode(
        ts.factory.createReturnStatement(
          ts.factory.createCallExpression(lib, null, [opts]),
        ),
      ),
    );
  }

  protected *writeTypes(src: SourceFile): Iterable<string> {
    for (const type of this.parser.getTypes()) {
      switch (type.getKind()) {
        case SyntaxKind.EnumDeclaration:
          yield src
            .addEnum(type.asKind(SyntaxKind.EnumDeclaration).getStructure())
            .getName();
          break;
        case SyntaxKind.InterfaceDeclaration:
          yield src
            .addInterface(
              type.asKind(SyntaxKind.InterfaceDeclaration).getStructure(),
            )
            .getName();
          break;
        case SyntaxKind.ClassDeclaration:
          const struct = type
            .asKind(SyntaxKind.ClassDeclaration)
            .getStructure();
          const imps = struct.implements
            ? Array.isArray(struct.implements)
              ? struct.implements
              : [struct.implements]
            : [];
          yield src
            .addInterface({
              name: struct.name,
              isExported: true,
              typeParameters: struct.typeParameters,
              extends: [struct.extends, ...imps],
              properties: struct.properties.map((prop) => ({
                name: prop.name,
                type: prop.type,
                hasQuestionToken: prop.hasQuestionToken,
                docs: prop.docs,
              })),
              docs: struct.docs,
            })
            .getName();
          break;
        case SyntaxKind.TypeAliasDeclaration:
          yield src
            .addTypeAlias(
              type.asKind(SyntaxKind.TypeAliasDeclaration).getStructure(),
            )
            .getName();
          break;
      }
    }
  }

  protected resolveHttpModule(): string {
    // add http module import
    if (!this.config.httpModule) {
      return 'axios';
    }
    return resolveRelativeModule(this.config.httpModule, this.requestsFile);
  }
}

function createRequestOptions(
  request: Parser.Request,
  url: string,
  overwrite?: string,
): ts.ObjectLiteralExpression {
  const props: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment(
      'method',
      ts.factory.createStringLiteral(request.method),
    ),
    ts.factory.createPropertyAssignment(
      'url',
      createUrlStringExpression(request, url),
    ),
  ];
  if (request.query) {
    props.push(
      ts.factory.createPropertyAssignment(
        'params',
        createMergedObjectExpression(request.query),
      ),
    );
  }
  if (request.data) {
    props.push(
      ts.factory.createPropertyAssignment(
        'data',
        createMergedObjectExpression(request.data),
      ),
    );
  }
  if (overwrite) {
    props.push(
      ts.factory.createSpreadAssignment(ts.factory.createIdentifier(overwrite)),
    );
  }
  const options = ts.factory.createObjectLiteralExpression(props);
  return options;
}

function createMergedObjectExpression(
  parameters: ParameterDeclaration | Parser.PartialParameterDeclaration[],
): ts.Expression {
  if (!Array.isArray(parameters)) {
    return ts.factory.createIdentifier(parameters.getName());
  }
  const map = new Map<string, string>();
  for (const { property, parameter } of parameters) {
    map.set(property, parameter.getName());
  }
  return ts.factory.createObjectLiteralExpression(
    Array.from(map).map(([k, v]) =>
      ts.factory.createPropertyAssignment(k, ts.factory.createIdentifier(v)),
    ),
  );
}

function createUrlStringExpression(
  request: Parser.Request,
  url: string,
): ts.Expression {
  if (!request.params) {
    return ts.factory.createStringLiteral(url);
  }
  const [head, ...spans] = url.split(/(?=:)/g);
  return ts.factory.createTemplateExpression(
    ts.factory.createTemplateHead(head),
    spans.map((span, i) => {
      const [exp, literal] = span.split(/\/(.+)/);
      return ts.factory.createTemplateSpan(
        ts.factory.createIdentifier(exp.slice(1)),
        i < spans.length - 1
          ? ts.factory.createTemplateMiddle('/' + literal)
          : ts.factory.createTemplateTail(literal ? '/' + literal : ''),
      );
    }),
  );
}

function resolveRelativeModule(moduleSpecifier: string, from: string): string {
  const relativePath = relative(dirname(from), moduleSpecifier);
  const { dir, name } = parse(relativePath);
  moduleSpecifier = join(dir, name);
  if (!moduleSpecifier.startsWith('/')) {
    moduleSpecifier = './' + moduleSpecifier;
  }
  return moduleSpecifier;
}

function joinPaths(...args: string[]): string {
  return ['', ...args, '']
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/(.+)\/$/, '$1');
}

export default AxiosWriter;
