import {
  ClassDeclaration,
  Decorator,
  EnumDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  Node,
  ParameterDeclaration,
  Project,
  SourceFile,
  SyntaxKind,
  ts,
  Type,
  TypeAliasDeclaration,
  TypeFormatFlags,
} from 'ts-morph';
import { Config } from '../config';
import { Parser } from '../types';

const MethodDecoratorNames = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

class NestjsParser extends Parser {
  private readonly controllerSrcFiles: Iterable<SourceFile>;
  private readonly typeSrcFiles: Iterable<SourceFile>;

  constructor(protected readonly config: Config.NestjsInput) {
    super(config);
    const project = new Project();
    this.controllerSrcFiles = project.addSourceFilesAtPaths(config.sources);
    this.typeSrcFiles = project.addSourceFilesAtPaths(config.types);
  }

  *getControllers(): Iterable<Parser.Controller> {
    for (const src of this.controllerSrcFiles) {
      for (const type of src.getClasses()) {
        const deco = type.getDecorator('Controller');
        if (!deco) {
          continue;
        }
        const [name] = src.getBaseNameWithoutExtension().split('.', 1);
        const baseUrl = this.getBaseUrl(deco);
        const docs = type.getJsDocs();
        const requests = this.getRequests(type);
        yield {
          name,
          baseUrl,
          docs,
          requests,
        };
      }
    }
  }

  *getTypes(): Iterable<
    | EnumDeclaration
    | InterfaceDeclaration
    | ClassDeclaration
    | TypeAliasDeclaration
  > {
    for (const src of this.typeSrcFiles) {
      yield* src.getEnums().filter((type) => type.isExported());
      yield* src.getInterfaces().filter((type) => type.isExported());
      yield* src.getClasses().filter((type) => type.isExported());
      yield* src.getTypeAliases().filter((type) => type.isExported());
    }
  }

  protected *getRequests(type: ClassDeclaration): Iterable<Parser.Request> {
    for (const method of type.getMethods()) {
      const verb = this.getVerb(method);
      if (!verb) {
        continue;
      }
      const url = this.getUrl(verb);
      const params = this.getParams(method);
      const query = this.getQuery(method);
      const data = this.getData(method);
      const res = this.getReturnType(method);
      yield {
        url,
        method: verb.getName().toLowerCase(),
        params,
        query,
        data,
        res,
        func: method,
      };
    }
  }

  protected getReturnType(method: MethodDeclaration): Type<ts.Type> {
    const type = method.getReturnType();
    const targetType = type.getTargetType();
    if (targetType) {
      if (targetType.getText(null, TypeFormatFlags.None) === 'Promise<T>') {
        return type.getTypeArguments()[0];
      }
    }
    return type;
  }

  protected getData(
    method: MethodDeclaration,
  ): ParameterDeclaration | Parser.PartialParameterDeclaration[] | undefined {
    const pairs = method
      .getParameters()
      .map((p) => ({ p, d: p.getDecorator('Body') }))
      .filter((p) => p.d);
    if (!pairs.length) {
      return;
    }
    const partials: Parser.PartialParameterDeclaration[] = [];
    for (const pair of pairs) {
      const property = pair.d
        .getArguments()[0]
        ?.asKind(SyntaxKind.StringLiteral)
        ?.getLiteralText();
      if (!property) {
        // if an injection without property name occurs(e.g. `@Body()`, `@Body(new ValidationPipe())`), return it immediately
        return pair.p;
      }
      partials.push({ property, parameter: pair.p });
    }
    if (partials.length) {
      return partials;
    }
  }

  protected getQuery(
    method: MethodDeclaration,
  ): ParameterDeclaration | Parser.PartialParameterDeclaration[] | undefined {
    const pairs = method
      .getParameters()
      .map((p) => ({ p, d: p.getDecorator('Query') }))
      .filter((p) => p.d);
    if (!pairs.length) {
      return;
    }
    const partials: Parser.PartialParameterDeclaration[] = [];
    for (const pair of pairs) {
      const property = pair.d
        .getArguments()[0]
        ?.asKind(SyntaxKind.StringLiteral)
        ?.getLiteralText();
      if (!property) {
        // if an injection without property name occurs(e.g. `@Query()`, `@Query(new ValidationPipe())`), return it immediately
        return pair.p;
      }
      partials.push({ property, parameter: pair.p });
    }
    if (partials.length) {
      return partials;
    }
  }

  protected getParams(
    method: MethodDeclaration,
  ): Parser.PartialParameterDeclaration[] | undefined {
    const pairs = method
      .getParameters()
      .map((p) => ({ p, d: p.getDecorator('Param') }))
      .filter((p) => p.d);
    if (!pairs.length) {
      return;
    }
    const partials: Parser.PartialParameterDeclaration[] = [];
    for (const pair of pairs) {
      const property = pair.d
        .getArguments()[0]
        ?.asKind(SyntaxKind.StringLiteral)
        ?.getLiteralText();
      if (!property) {
        // if an injection without property name occurs(e.g. `@Param()`, `@Param(new ValidationPipe())`), throw an exception
        throw new Error('`@Param()` without property name is not supported');
      }
      partials.push({ property, parameter: pair.p });
    }
    if (partials.length) {
      return partials;
    }
  }

  protected getUrl(deco: Decorator): string {
    const args = deco.getArguments();
    if (!args.length) {
      return '';
    }
    return getLiteralPath(args[0]);
  }

  protected getVerb(method: MethodDeclaration): Decorator {
    return method.getDecorator((e) =>
      MethodDecoratorNames.includes(e.getName()),
    );
  }

  protected getBaseUrl(deco: Decorator): string {
    const args = deco.getArguments();
    if (!args.length) {
      return '';
    }
    return getLiteralPath(args[0], true);
  }
}

function getLiteralPath(node: Node<ts.Node>, allowObject?: boolean) {
  switch (node.getKind()) {
    case SyntaxKind.StringLiteral:
      return node.asKind(SyntaxKind.StringLiteral).getLiteralText();
    case SyntaxKind.ArrayLiteralExpression:
      return node
        .asKind(SyntaxKind.ArrayLiteralExpression)
        .getElements()
        .map((e) => e.asKind(SyntaxKind.StringLiteral).getLiteralText())
        .join('/');
    case SyntaxKind.ObjectLiteralExpression:
      if (!allowObject) {
        throw new Error('unknown argument type');
      }
      return getLiteralPath(
        node.asKind(SyntaxKind.ObjectLiteralExpression).getProperty('path'),
      );
    case SyntaxKind.PropertyAssignment:
      return getLiteralPath(
        node.asKind(SyntaxKind.PropertyAssignment).getInitializer(),
      );
    default:
      throw new Error('unknown argument type');
  }
}

export default NestjsParser;
