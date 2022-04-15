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
  SymbolFlags,
  SyntaxKind,
  ts,
  Type,
  TypeFormatFlags,
  TypeNode,
} from 'ts-morph';
import { Config } from '../config';
import { Parser, Writer } from '../types';

class OpenAPIWriter extends Writer {
  protected readonly doc: OpenAPIV3.Document;
  protected readonly types: Map<string, Parser.TypeDeclaration> = new Map();

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
      config: { dest },
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

  protected addComponent(type: Parser.TypeDeclaration) {
    const {
      doc: {
        components: { schemas },
      },
    } = this;
    let schema: OpenAPIV3.SchemaObject;
    switch (type.getKind()) {
      case SyntaxKind.EnumDeclaration:
        schema = this.resolveEnumComponent(
          type.asKind(SyntaxKind.EnumDeclaration),
        );
        break;
      case SyntaxKind.InterfaceDeclaration:
        schema = this.resolveInterfaceComponent(
          type.asKind(SyntaxKind.InterfaceDeclaration),
        );
        break;
      case SyntaxKind.ClassDeclaration:
        schema = this.resolveClassComponent(
          type.asKind(SyntaxKind.ClassDeclaration),
        );
        break;
      case SyntaxKind.TypeAliasDeclaration:
        // TODO:
        break;
    }
    if (schema) {
      const typeName = type.getName();
      if (typeName in schemas) {
        console.warn(`Duplicate types found: \`${typeName}\``);
      }
      schemas[typeName] = schema;
      this.types.set(typeName, type);
    }
  }

  protected addPath(
    request: Parser.Request,
    controller: Parser.Controller,
  ): void {
    const { doc } = this;
    const path: OpenAPIV3.OperationObject = {
      description: request.func.getJsDocs()[0]?.getCommentText(),
      parameters: this.resolveParameters(request),
      responses: this.resolveResponses(request),
      requestBody: this.resolveBody(request),
      tags: [controller.name],
    };
    const url = this.resolveUrl(request.url, controller.baseUrl);
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

  protected resolveParameters(
    request: Parser.Request,
  ): OpenAPIV3.ParameterObject[] | undefined {
    const paramters: OpenAPIV3.ParameterObject[] = [];
    if (request.params) {
      paramters.push(...this.createParamters('path', request, request.params));
    }
    if (request.query) {
      paramters.push(...this.createParamters('query', request, request.query));
    }
    if (paramters.length) {
      return paramters;
    }
  }

  private *createParamters(
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
          schema: this.resolveNodeSchema(parameter.getTypeNode()),
        };
      }
    } else {
      const typeName = parameters
        .getTypeNode()
        .asKind(SyntaxKind.TypeReference)
        ?.getTypeName()
        .asKind(SyntaxKind.Identifier)
        ?.getText();
      if (typeName) {
        const targetType = this.types.get(typeName);
        for (const prop of this.resolvePropertiesRecursively(targetType)) {
          yield {
            name: prop.getName(),
            in: type,
            required: !prop.hasQuestionToken(),
            description: prop.getJsDocs()[0]?.getCommentText(),
            schema: this.resolveNodeSchema(prop.getTypeNode()),
          };
        }
      }
    }
  }

  private *resolvePropertiesRecursively(
    type: Parser.TypeDeclaration,
  ): Iterable<PropertySignature | PropertyDeclaration> {
    switch (type.getKind()) {
      case SyntaxKind.InterfaceDeclaration:
      case SyntaxKind.ClassDeclaration:
        const it = type as InterfaceDeclaration | ClassDeclaration;
        yield* it.getProperties();
        for (const superType of this.resolveProtoChain(it)) {
          yield* this.resolvePropertiesRecursively(superType);
        }
        break;
    }
  }

  protected resolveResponses(
    request: Parser.Request,
  ): OpenAPIV3.ResponsesObject {
    const schema = this.resolveTypeSchema(request.res);
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

  protected resolveBody(
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
            schema: this.resolveNodeSchema(parameter.getTypeNode()),
          },
        },
      };
    }
  }

  protected resolveUrl(url: string, baseUrl: string): string {
    return ['', baseUrl, url, '']
      .join('/')
      .replace(/\/{2,}/g, '/')
      .replace(/(.+)\/$/, '$1')
      .replace(/\:(\w+)/g, (_, cap) => `{${cap}}`);
  }

  protected resolveClassComponent(
    type: ClassDeclaration,
  ): OpenAPIV3.SchemaObject {
    const supertypes = [...type.getImplements()];
    const ex = type.getExtends();
    if (ex) {
      supertypes.unshift(ex);
    }
    const self = this.resolveObjectSchema(type);
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

  protected resolveInterfaceComponent(
    type: InterfaceDeclaration,
  ): OpenAPIV3.SchemaObject {
    const supertypes = type.getExtends();
    const self = this.resolveObjectSchema(type);
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

  protected resolveObjectSchema(
    type: InterfaceDeclaration | ClassLikeDeclarationBase,
  ): OpenAPIV3.NonArraySchemaObject {
    const typeArgs = type.getTypeParameters();
    return {
      type: 'object',
      description: type.getJsDocs()[0]?.getCommentText(),
      properties: (type.getProperties() as any[]).reduce(
        (acc, prop: PropertyDeclaration | PropertySignature) => {
          const schema = this.resolveNodeSchema(prop.getTypeNode());
          acc[prop.getName()] = {
            ...schema,
            description: prop.getJsDocs()[0]?.getCommentText(),
          };
          return acc;
        },
        {} as Record<
          string,
          OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject
        >,
      ),
    };
  }

  protected resolveEnumComponent(
    type: EnumDeclaration,
  ): OpenAPIV3.SchemaObject {
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

  protected resolveTypeSchema(
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
        items: this.resolveTypeSchema(type.getArrayElementType()),
      };
    }
    if (type.isClassOrInterface() || type.isEnum()) {
      return this.resolveRefType(type.getText(null, TypeFormatFlags.None));
    }
    if (type.isUnion()) {
      return {
        anyOf: type.getUnionTypes().map((e) => this.resolveTypeSchema(e)),
      };
    }
    const genericType = type.getTargetType();
    if (genericType) {
      // TODO: generic type
      console.warn(
        `Generic type \`${type.getText(
          null,
          TypeFormatFlags.None,
        )}\` is not supported yet`,
      );
    }
    if (type.isIntersection()) {
      return {
        allOf: type
          .getIntersectionTypes()
          .map((e) => this.resolveTypeSchema(e)),
      };
    }
    if (type.isObject()) {
      return {
        type: 'object',
      };
    }
    return {};
  }

  private *resolveProtoChain(
    type: ClassDeclaration | InterfaceDeclaration,
  ): Iterable<ClassDeclaration | InterfaceDeclaration> {
    switch (type.getKind()) {
      case SyntaxKind.ClassDeclaration:
      case SyntaxKind.InterfaceDeclaration:
        {
          let exts = type.getExtends();
          if (!exts) {
            return;
          }
          if (!Array.isArray(exts)) {
            exts = [exts];
          }
          for (const ext of exts) {
            const superName = ext
              .getExpressionIfKind(SyntaxKind.Identifier)
              ?.getText();
            if (!superName) {
              continue;
            }
            const superType = this.types.get(superName);
            const superTypeKind = superType?.getKind();
            if (
              superTypeKind === SyntaxKind.InterfaceDeclaration ||
              superTypeKind === SyntaxKind.ClassDeclaration
            ) {
              yield superType as InterfaceDeclaration | ClassDeclaration;
              yield* this.resolveProtoChain(
                superType as InterfaceDeclaration | ClassDeclaration,
              );
            }
          }
        }
        break;
    }
  }

  protected resolveNodeSchema(
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
          items: this.resolveNodeSchema(
            node.asKind(SyntaxKind.ArrayType).getElementTypeNode(),
          ),
        };
      case SyntaxKind.TemplateLiteralType:
        return {
          type: 'string',
          // TODO: enum
        };
      case SyntaxKind.UnionType:
        return {
          anyOf: node
            .asKind(SyntaxKind.UnionType)
            .getTypeNodes()
            .map((e) => this.resolveNodeSchema(e)),
        };
      case SyntaxKind.TypeReference:
        const typeRef = node.asKind(SyntaxKind.TypeReference);
        const typeRefName = typeRef
          .getTypeName()
          .asKind(SyntaxKind.Identifier)
          .getText();
        const args = typeRef.getTypeArguments();
        if (!args.length) {
          const symbols = node
            .getSymbolsInScope(SymbolFlags.TypeParameter)
            .map((e) => e.getName());
          if (symbols.includes(typeRefName)) {
            // NOTE: treat generic parameter types(e.g. `T`) as `any`
            return {};
          }
          return this.resolveRefType(typeRefName);
        }
      // TODO: generic
      case SyntaxKind.ObjectLiteralExpression:
        // TODO: literal
        break;
    }
    console.warn(
      `Unknown node found \`${node.getText()}\` with type \`${node.getKind()}\``,
    );
    return {};
  }

  private resolveRefType(
    typeName: string,
  ): OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject {
    switch (typeName) {
      case 'Date':
        return {
          type: 'string',
          format: 'date-time',
        };
      // TODO:
    }
    return {
      $ref: `#/components/schemas/${typeName}`,
    };
  }
}

export default OpenAPIWriter;
