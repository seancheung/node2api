import {
  Decorator,
  EnumDeclarationStructure,
  FunctionDeclarationStructure,
  InterfaceDeclarationStructure,
  MethodDeclaration,
  ModuleDeclarationStructure,
  Node,
  OptionalKind,
  ParameterDeclaration,
  printNode,
  SourceFile,
  StructureKind,
  SyntaxKind,
  ts,
  TypeFormatFlags,
} from 'ts-morph';
import { Parser } from '../types';

const ControllerDecoratorName = 'Controller';
const MethodDecoratorNames = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
const ParameterDecoratorsNames = ['Param', 'Body', 'Query', 'Headers'];
interface DecoratedParameter {
  parameter: ParameterDeclaration;
  decorator: Decorator;
}

class NestjsParser extends Parser {
  *createModules(
    files: Iterable<SourceFile>,
  ): Iterable<OptionalKind<ModuleDeclarationStructure>> {
    for (const file of files) {
      for (const decl of file.getClasses()) {
        const ctrl = decl.getDecorator(ControllerDecoratorName);
        if (!ctrl) {
          continue;
        }
        const basePath = getControllerPath(ctrl);
        const [name] = file.getBaseNameWithoutExtension().split('.', 1);
        const functions = createFunctions(decl.getMethods(), basePath);
        yield {
          name: name.toUpperCase(),
          isExported: true,
          statements: Array.from(functions),
        };
      }
    }
  }
  *createTypes(
    files: Iterable<SourceFile>,
  ): Iterable<InterfaceDeclarationStructure | EnumDeclarationStructure> {
    for (const file of files) {
      for (const decl of file.getEnums()) {
        if (decl.isExported()) {
          yield decl.getStructure();
        }
      }
      for (const decl of file.getInterfaces()) {
        if (decl.isExported()) {
          yield decl.getStructure();
        }
      }
      for (const decl of file.getClasses()) {
        if (decl.isExported()) {
          const struct = decl.getStructure();
          yield {
            kind: StructureKind.Interface,
            name: struct.name,
            isExported: true,
            typeParameters: struct.typeParameters,
            extends: [struct.extends],
            properties: struct.properties.map((prop) => ({
              name: prop.name,
              type: prop.type,
              hasQuestionToken: prop.hasQuestionToken,
              docs: prop.docs,
            })),
            docs: struct.docs,
          };
        }
      }
    }
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
function getControllerPath(decorator: Decorator) {
  const args = decorator.getArguments();
  if (!args.length) {
    return '';
  }
  return getLiteralPath(args[0], true);
}
/**
 * Create requestion functions(e.g. `function findUser(id: number): Promise<User> {}`)
 * @param methods Controller methods
 * @param basePath Request url base path
 */
function* createFunctions(
  methods: MethodDeclaration[],
  basePath: string,
): Iterable<FunctionDeclarationStructure> {
  for (const method of methods) {
    const verb = method
      .getDecorators()
      .find((e) => MethodDecoratorNames.includes(e.getName()));
    if (!verb) {
      continue;
    }
    const localPath = getMethodPath(verb);
    const fullPath = joinPaths(basePath, localPath);
    const parameters = getMethodDecoratedParameters(method);
    const returnTypeNode = method.getReturnType();
    let returnType = returnTypeNode.getText(null, TypeFormatFlags.None);
    if (returnTypeNode.getTargetType() === undefined) {
      // in case of a non-async controller function
      returnType = `Promise<${returnType}>`;
    }
    yield {
      kind: StructureKind.Function,
      name: method.getName(),
      isExported: true,
      returnType,
      parameters: parameters.map(({ parameter }) => ({
        name: parameter.getName(),
        type: parameter.getType().getText(null, TypeFormatFlags.None),
        hasQuestionToken: parameter.isOptional(),
      })),
      statements: printNode(
        createRequestStatement(
          verb.getName().toLowerCase(),
          fullPath,
          parameters,
        ),
      ),
      docs: method.getJsDocs()?.map((e) => e.getStructure()),
    };
  }
}
function getMethodPath(decorator: Decorator): string {
  const args = decorator.getArguments();
  if (!args.length) {
    return '';
  }
  return getLiteralPath(args[0]);
}
function joinPaths(...args: string[]): string {
  return ['', ...args, '']
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/(.+)\/$/, '$1');
}
function getMethodDecoratedParameters(
  method: MethodDeclaration,
): DecoratedParameter[] {
  return method
    .getParameters()
    .map((p) => ({
      parameter: p,
      decorator: p
        .getDecorators()
        .find((e) => ParameterDecoratorsNames.includes(e.getName())),
    }))
    .filter((e) => e.decorator != null);
}
/**
 * Create a request expression(e.g. `http.request({url: '/users/${id}', method: 'get'})`)
 * @param verb Http request method
 * @param url Request url
 * @param parameters Mixed parameters to interpolate with
 */
function createRequestStatement(
  verb: string,
  url: string,
  parameters: DecoratedParameter[],
): ts.Node {
  const opts = createRequestOptions(verb, url, parameters);
  const request = ts.factory.createPropertyAccessExpression(
    ts.factory.createIdentifier('http'),
    'request',
  );
  return ts.factory.createReturnStatement(
    ts.factory.createCallExpression(request, null, [
      ts.factory.createObjectLiteralExpression(Array.from(opts)),
    ]),
  );
}
/**
 * Create request options expression(e.g. `{url: '/users/${id}', method: 'get'}`)
 * @param verb Http request method
 * @param url Request url
 * @param parameters Mixed parameters to interpolate with
 */
function* createRequestOptions(
  verb: string,
  url: string,
  parameters: DecoratedParameter[],
): Iterable<ts.ObjectLiteralElementLike> {
  yield ts.factory.createPropertyAssignment(
    'method',
    ts.factory.createStringLiteral(verb),
  );
  yield ts.factory.createPropertyAssignment(
    'url',
    createUrlStringExpression(url, parameters),
  );
  const query = parameters.filter((e) => e.decorator.getName() === 'Query');
  if (query.length) {
    yield ts.factory.createPropertyAssignment(
      'params',
      createMergedObjectExpression(query),
    );
  }
  /*
  // usually headers are not passed per-method
  const headers = parameters.filter((e) => e.decorator.getName() === 'Headers');
  if (headers.length) {
    yield ts.factory.createPropertyAssignment(
      'headers',
      createMergedObjectExpression(headers),
    );
  }
  */
  const body = parameters.filter((e) => e.decorator.getName() === 'Body');
  if (body.length) {
    yield ts.factory.createPropertyAssignment(
      'data',
      createMergedObjectExpression(body),
    );
  }
}

/**
 * Interpolate url path with parameters(e.g. `'/users/:id'` to `/users/${id}`)
 * @param url Original url with path parameters
 * @param parameters parameters to interpolate with
 * @returns Literal string or template string expression
 */
function createUrlStringExpression(
  url: string,
  parameters: DecoratedParameter[],
): ts.Expression {
  const params = parameters.filter((e) => e.decorator.getName() === 'Param');
  if (!params.length) {
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
/**
 * Merge scattered params. e.g. `@Body('name')` and `@Body('id')` to `{ name, id }`
 * @param parameters Legal parameters
 * @returns Merged object literal expression
 */
function createMergedObjectExpression(
  parameters: DecoratedParameter[],
): ts.Expression {
  const map = new Map<string, string>();
  for (const param of parameters) {
    const args = param.decorator.getArguments();
    if (!args.length || args[0].getKind() !== SyntaxKind.StringLiteral) {
      // if an injection without property name occurs(e.g. `@Body()`, `@Body(new ValidationPipe())`), return it immediately
      return ts.factory.createIdentifier(param.parameter.getName());
    }
    const name = args[0].asKind(SyntaxKind.StringLiteral).getLiteralText();
    map.set(name, param.parameter.getName());
  }
  return ts.factory.createObjectLiteralExpression(
    Array.from(map).map(([k, v]) =>
      ts.factory.createPropertyAssignment(k, ts.factory.createIdentifier(v)),
    ),
  );
}

export default NestjsParser;
