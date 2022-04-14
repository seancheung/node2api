import { writeFileSync } from 'fs';
import type { OpenAPIV3 } from 'openapi-types';
import {
  ClassDeclaration,
  ClassLikeDeclarationBase,
  EnumDeclaration,
  InterfaceDeclaration,
  JSDocParameterTag,
  JSDocReturnTag,
  ParameterDeclaration,
  PropertyDeclaration,
  PropertySignature,
  SyntaxKind,
  ts,
  Type,
  TypeAliasDeclaration,
  TypeFormatFlags,
  TypeNode,
} from 'ts-morph';
import { Config } from '../config';
import { Parser, Writer } from '../types';

class OpenAPIWriter extends Writer {
  protected readonly doc: OpenAPIV3.Document;

  constructor(protected readonly config: Config.OpenAPIOutput, parser: Parser) {
    super(config, parser);
    this.doc = {
      openapi: '3.0.0',
      info: config.info,
      paths: {},
      components: {
        schemas: {},
      },
      tags: [],
    };
  }

  write(stream?: boolean): void {
    const {
      config: { info, dest },
      parser,
    } = this;

    for (const type of parser.getTypes()) {
      this.addComponent(type);
    }

    for (const controller of parser.getControllers()) {
      this.addTag(controller);
      for (const request of controller.requests) {
        this.addPath(request, controller);
      }
    }

    const text = JSON.stringify(this.doc, null, 2);
    if (stream) {
      process.stdout.write(text);
    }
    writeFileSync(dest, text, 'utf-8');
  }

  protected addComponent(
    type:
      | EnumDeclaration
      | InterfaceDeclaration
      | ClassDeclaration
      | TypeAliasDeclaration,
  ) {
    const {
      doc: {
        components: { schemas },
      },
    } = this;
    switch (type.getKind()) {
      case SyntaxKind.EnumDeclaration:
        schemas[type.getName()] = resolveEnumComponent(
          type.asKind(SyntaxKind.EnumDeclaration),
        );
        break;
      case SyntaxKind.InterfaceDeclaration:
        schemas[type.getName()] = resolveInterfaceComponent(
          type.asKind(SyntaxKind.InterfaceDeclaration),
        );
        break;
      case SyntaxKind.ClassDeclaration:
        schemas[type.getName()] = resolveClassComponent(
          type.asKind(SyntaxKind.ClassDeclaration),
        );
        break;
      case SyntaxKind.TypeAliasDeclaration:
        // TODO:
        break;
      default:
        break;
    }
  }

  protected addPath(
    request: Parser.Request,
    controller: Parser.Controller,
  ): void {
    const { doc } = this;
    const path: OpenAPIV3.OperationObject = {
      description: request.func.getJsDocs()[0]?.getCommentText(),
      parameters: resolveParameters(request),
      responses: resolveResponses(request),
      requestBody: resolveBody(request),
      tags: [controller.name],
    };
    const url = resolveUrl(request.url, controller.baseUrl);
    if (!(url in doc.paths)) {
      doc.paths[url] = {};
    }
    doc.paths[url][request.method.toLowerCase()] = path;
  }

  protected addTag(controller: Parser.Controller) {
    const { doc } = this;
    const description = controller.docs[0]?.getCommentText();
    if (description) {
      doc.tags.push({
        name: controller.name,
        description,
      });
    }
  }
}

function resolveClassComponent(type: ClassDeclaration): OpenAPIV3.SchemaObject {
  const supertypes = [...type.getImplements()];
  const ex = type.getExtends();
  if (ex) {
    supertypes.unshift(ex);
  }
  const self = resolveObjectSchema(type);
  if (supertypes.length) {
    return {
      allOf: [
        ...supertypes.map((t) => ({
          $ref: `#/components/schemas/${t.getText()}`,
        })),
        self,
      ],
    };
  }
  return self;
}

function resolveInterfaceComponent(
  type: InterfaceDeclaration,
): OpenAPIV3.SchemaObject {
  const supertypes = type.getExtends();
  const self = resolveObjectSchema(type);
  if (supertypes.length) {
    return {
      allOf: [
        ...supertypes.map((t) => ({
          $ref: `#/components/schemas/${t.getText()}`,
        })),
        self,
      ],
    };
  }
  return self;
}

function resolveObjectSchema(
  type: InterfaceDeclaration | ClassLikeDeclarationBase,
): OpenAPIV3.NonArraySchemaObject {
  return {
    type: 'object',
    description: type.getJsDocs()[0]?.getCommentText(),
    properties: (type.getProperties() as any[]).reduce(
      (acc, prop: PropertyDeclaration | PropertySignature) => {
        const schema = resolveNodeSchema(prop.getTypeNode());
        acc[prop.getName()] = {
          ...schema,
          description: prop.getJsDocs()[0]?.getCommentText(),
        };
        return acc;
      },
      {} as Record<string, OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject>,
    ),
  };
}

function resolveEnumComponent(type: EnumDeclaration): OpenAPIV3.SchemaObject {
  const values = type
    .asKind(SyntaxKind.EnumDeclaration)
    .getMembers()
    .map((member) => member.getValue());
  return {
    type: typeof values[0] === 'string' ? 'string' : 'number',
    description: type.getJsDocs()[0]?.getCommentText(),
    enum: values,
  };
}

function resolveResponses(request: Parser.Request): OpenAPIV3.ResponsesObject {
  const schema = resolveTypeSchema(request.res);
  if (!schema) {
    return;
  }
  const description = request.func
    .getJsDocs()[0]
    ?.getTags()
    .find((tag) => tag instanceof JSDocReturnTag)
    ?.getCommentText();
  return {
    '200': {
      description,
      content: {
        'application/json': {
          schema,
        },
      },
    },
  };
}

function resolveBody(
  request: Parser.Request,
): OpenAPIV3.RequestBodyObject | undefined {
  if (!request.data) {
    return;
  }
  const parameter = request.data;
  if (!Array.isArray(parameter)) {
    return {
      description: request.func
        .getJsDocs()[0]
        ?.getTags()
        .find(
          (tag) =>
            tag instanceof JSDocParameterTag &&
            tag.getName() === parameter.getName(),
        )
        ?.getCommentText(),
      content: {
        'application/json': {
          schema: resolveNodeSchema(parameter.getTypeNode()),
        },
      },
    };
  }
}

function resolveParameters(
  request: Parser.Request,
): OpenAPIV3.ParameterObject[] | undefined {
  const paramters: OpenAPIV3.ParameterObject[] = [];
  if (request.params) {
    paramters.push(...createParamters('path', request, request.params));
  }
  if (request.query) {
    paramters.push(...createParamters('query', request, request.query));
  }
  if (paramters.length) {
    return paramters;
  }
}

function* createParamters(
  type: 'path' | 'query',
  request: Parser.Request,
  parameters: ParameterDeclaration | Parser.PartialParameterDeclaration[],
): Iterable<OpenAPIV3.ParameterObject> {
  if (Array.isArray(parameters)) {
    for (const { property, parameter } of parameters) {
      yield {
        name: property,
        in: type,
        required: !parameter.isOptional(),
        description: request.func
          .getJsDocs()[0]
          ?.getTags()
          .find(
            (tag) =>
              tag instanceof JSDocParameterTag &&
              tag.getName() === parameter.getName(),
          )
          ?.getCommentText(),
        schema: resolveNodeSchema(parameter.getTypeNode()),
      };
    }
  } else {
    // TODO:
  }
}

function resolveTypeSchema(
  type: Type<ts.Type>,
): OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject | undefined {
  if (type.isUndefined() || type.isNull()) {
    return;
  }
  if (type.isString() || type.isStringLiteral()) {
    return {
      type: 'string',
    };
  }
  if (type.isNumber() || type.isNumberLiteral()) {
    return {
      type: 'number',
    };
  }
  if (type.isBoolean() || type.isBooleanLiteral()) {
    return {
      type: 'boolean',
    };
  }
  if (type.isArray()) {
    return {
      type: 'array',
      items: resolveTypeSchema(type.getArrayElementType()),
    };
  }
  if (type.isInterface() || type.isClass() || type.isEnum()) {
    return {
      $ref: type.getText(null, TypeFormatFlags.None),
    };
  }
  if (type.isUnion()) {
    return {
      anyOf: type.getUnionTypes().map(resolveTypeSchema),
    };
  }
  if (type.getTargetType()) {
    // TODO: generic type
  }
  if (type.isIntersection()) {
    return {
      allOf: type.getIntersectionTypes().map(resolveTypeSchema),
    };
  }
  if (type.isObject()) {
    return {
      type: 'object',
    };
  }
}

function resolveNodeSchema(
  node: TypeNode<ts.TypeNode>,
): OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject {
  switch (node.getKind()) {
    case SyntaxKind.NumberKeyword:
    case SyntaxKind.BigIntKeyword:
    case SyntaxKind.NumericLiteral:
      return {
        type: 'number',
      };
    case SyntaxKind.StringKeyword:
    case SyntaxKind.StringLiteral:
      return {
        type: 'string',
      };
    case SyntaxKind.BooleanKeyword:
    case SyntaxKind.TrueKeyword:
    case SyntaxKind.FalseKeyword:
      return {
        type: 'boolean',
      };
    case SyntaxKind.ArrayType:
      return {
        type: 'array',
        items: resolveNodeSchema(
          node.asKind(SyntaxKind.ArrayType).getElementTypeNode(),
        ),
      };
    case SyntaxKind.TypeReference:
      const ref = node.asKind(SyntaxKind.TypeReference);
      const args = ref.getTypeArguments();
      if (!args.length) {
        return {
          $ref: `#/components/schemas/${ref
            .getTypeName()
            .asKind(SyntaxKind.Identifier)
            .getText()}`,
        };
      }
      // TODO: generic
      return {
        type: 'object',
      };
    case SyntaxKind.ObjectLiteralExpression:
    case SyntaxKind.AnyKeyword:
    case SyntaxKind.NullKeyword:
    case SyntaxKind.UndefinedKeyword:
    case SyntaxKind.VoidKeyword:
    default:
      return;
  }
}

function resolveUrl(url: string, baseUrl: string): string {
  return ['', baseUrl, url, '']
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/(.+)\/$/, '$1')
    .replace(/\:(\w+)/g, (_, cap) => `{${cap}}`);
}

export default OpenAPIWriter;
