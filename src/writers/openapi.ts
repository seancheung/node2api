import { writeFileSync } from 'fs';
import type { OpenAPIV3 } from 'openapi-types';
import {
  FunctionDeclaration,
  JSDocParameterTag,
  JSDocReturnTag,
  Project,
  SyntaxKind,
  ts,
  TypeNode,
} from 'ts-morph';
import { Config } from '../config';
import { Parser, Writer } from '../types';

class OpenAPIWriter extends Writer {
  constructor(protected readonly config: Config.OpenAPIOutput, parser: Parser) {
    super(config, parser);
  }

  write(stream?: boolean): void {
    const { info, dest } = this.config;
    const doc: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: info,
      paths: {},
      components: {},
    };

    const project = new Project();
    doc.tags = [];
    for (const controller of this.parser.getControllers()) {
      doc.tags.push(this.getTag(controller));
      for (const req of controller.requests) {
        const src = project.createSourceFile('temp.ts');
        const func = src.addFunction(req);
        const context = this.getContext(controller, func);
        if (!(context.url in doc.paths)) {
          doc.paths[context.url] = {};
        }
        const path = doc.paths[context.url];
        path[context.method] = this.getPath(context);
        src.deleteImmediatelySync();
      }
    }

    const text = JSON.stringify(doc, null, 2);
    if (stream) {
      process.stdout.write(text);
    }
    writeFileSync(dest, text, 'utf-8');
  }

  getContext(
    controller: Parser.Controller,
    func: FunctionDeclaration,
  ): Context {
    const options = func
      .getBody()
      .asKind(SyntaxKind.Block)
      .getStatementByKindOrThrow(SyntaxKind.ReturnStatement)
      .getExpressionIfKindOrThrow(SyntaxKind.CallExpression)
      .getArguments()[0]
      .asKind(SyntaxKind.ObjectLiteralExpression);
    let url: string;
    let method: string;
    let data: string;
    let params: string;
    for (const prop of options.getProperties()) {
      const assign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!assign) {
        continue;
      }
      const name = assign.getNameNode().asKind(SyntaxKind.Identifier).getText();
      switch (name) {
        case 'method':
          method = assign
            .getInitializerIfKindOrThrow(SyntaxKind.StringLiteral)
            .getLiteralText();
          break;
        case 'url':
          url = assign.getInitializerOrThrow().getText().replace(/[`$"]/g, '');
          break;
        case 'params':
          params = assign
            .getInitializerIfKindOrThrow(SyntaxKind.Identifier)
            .getText();
          break;
        case 'data':
          data = assign
            .getInitializerIfKindOrThrow(SyntaxKind.Identifier)
            .getText();
          break;
      }
    }
    console.log(url, method, data, params);
    return {
      controller,
      func,
      url,
      method,
      data,
      params,
    };
  }

  getTag(controller: Parser.Controller): OpenAPIV3.TagObject {
    const desc = controller.docs?.[0]?.description;
    const tag: OpenAPIV3.TagObject = {
      name: controller.name,
    };
    if (typeof desc === 'string') {
      tag.description = desc.trim();
    }
    return tag;
  }

  getPath(ctx: Context): OpenAPIV3.OperationObject {
    return {
      description: ctx.func.getJsDocs()?.[0]?.getCommentText(),
      parameters: [...this.getParameters(ctx)],
      requestBody: this.getRequestBody(ctx),
      responses: this.getResponses(ctx),
      tags: [ctx.controller.name],
    };
  }

  getResponses(ctx: Context): OpenAPIV3.ResponsesObject | undefined {
    const schema = this.getReturnType(ctx);
    if (!schema) {
      return;
    }
    return {
      '200': {
        description: ctx.func
          .getJsDocs()?.[0]
          ?.getTags()
          ?.find((e) => e instanceof JSDocReturnTag)
          ?.getCommentText(),
        content: {
          'application/json': {
            schema,
          },
        },
      },
    };
  }

  getReturnType(
    ctx: Context,
  ): OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject | undefined {
    const returnType = ctx.func
      .getReturnTypeNode()
      ?.asKind(SyntaxKind.TypeReference);
    if (!returnType) {
      return;
    }
    if (
      returnType.getTypeName().asKind(SyntaxKind.Identifier).getText() !==
      'Promise'
    ) {
      return;
    }
    const args = returnType.getTypeArguments();
    if (!args.length) {
      return;
    }
    return this.getType(args[0]);
  }

  getType(
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
          items: this.getType(
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

  *getParameters(ctx: Context): Iterable<OpenAPIV3.ParameterObject> {
    for (const arg of ctx.func.getParameters()) {
      const name = arg.getName();
      if (ctx.url.includes(`{${name}}`)) {
        yield {
          name,
          in: 'path',
          required: !arg.hasQuestionToken() && !arg.hasInitializer(),
          description: ctx.func
            .getJsDocs()?.[0]
            ?.getTags()
            ?.find(
              (e) => e instanceof JSDocParameterTag && e.getName() === name,
            )
            ?.getCommentText(),
          schema: this.getType(arg.getTypeNode()),
        };
      }
    }
  }

  getRequestBody(
    ctx: Context,
  ): OpenAPIV3.ReferenceObject | OpenAPIV3.RequestBodyObject | undefined {
    if (!ctx.data) {
      return;
    }
    const node = ctx.func.getParameter(ctx.data)?.getTypeNode();
    if (!node) {
      return;
    }
    const schema = this.getType(node);
    if (!schema) {
      return;
    }
    return {
      description: ctx.func
        .getJsDocs()?.[0]
        ?.getTags()
        ?.find(
          (e) => e instanceof JSDocParameterTag && e.getName() === ctx.data,
        )
        ?.getCommentText(),
      content: {
        'application/json': {
          schema,
        },
      },
    };
  }
}

interface Context {
  controller: Parser.Controller;
  func: FunctionDeclaration;
  url: string;
  method: string;
  data?: string;
  params?: string;
}

export default OpenAPIWriter;
