import { writeFileSync } from 'fs';
import type { OpenAPIV3 } from 'openapi-types';
import {
  FunctionDeclaration,
  JSDocParameterTag,
  JSDocReturnTag,
  Project,
  SyntaxKind,
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
    for (const controller of this.parser.getControllers()) {
      for (const req of controller.requests) {
        const src = project.createSourceFile('temp.ts');
        const func = src.addFunction(req);
        const { url, method } = this.getBasicInfo(func);
        if (!(url in doc.paths)) {
          doc.paths[url] = {};
        }
        const path = doc.paths[url];
        const jsDoc = func.getJsDocs()?.[0];
        path[method] = {
          description: jsDoc?.getCommentText(),
          parameters: [...this.getParameters(url, func)],
          requestBody: {},
          responses: {
            '200': {
              description: jsDoc
                ?.getTags()
                ?.find((e) => e instanceof JSDocReturnTag)
                ?.getCommentText(),
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                  },
                },
              },
            },
          },
        };
        src.deleteImmediatelySync();
      }
    }

    const text = JSON.stringify(doc, null, 2);
    if (stream) {
      process.stdout.write(text);
    }
    writeFileSync(dest, text, 'utf-8');
  }

  getBasicInfo(func: FunctionDeclaration): RequestBasicInfo {
    const options = func
      .getBody()
      .asKind(SyntaxKind.Block)
      .getStatementByKindOrThrow(SyntaxKind.ReturnStatement)
      .getExpressionIfKindOrThrow(SyntaxKind.CallExpression)
      .getArguments()[0]
      .asKind(SyntaxKind.ObjectLiteralExpression);
    const args = func.getParameters();
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
          const paramsName = assign
            .getInitializerIfKindOrThrow(SyntaxKind.Identifier)
            .getText();
          params = args
            .find((e) => e.getName() === paramsName)
            ?.getTypeNode()
            .getText();
          break;
        case 'data':
          const dataName = assign
            .getInitializerIfKindOrThrow(SyntaxKind.Identifier)
            .getText();
          data = args
            .find((e) => e.getName() === dataName)
            ?.getTypeNode()
            .getText();
          break;
      }
    }
    console.log(url, method, data, params);
    return {
      url,
      method,
      data,
      params,
    };
  }

  *getParameters(
    url: string,
    func: FunctionDeclaration,
  ): Iterable<OpenAPIV3.ParameterObject> {
    const jsDoc = func.getJsDocs()?.[0];
    for (const arg of func.getParameters()) {
      const name = arg.getName();
      if (url.includes(`{${name}}`)) {
        yield {
          name,
          in: 'path',
          required: !arg.hasQuestionToken() && !arg.hasInitializer(),
          description: jsDoc
            ?.getTags()
            ?.find(
              (e) => e instanceof JSDocParameterTag && e.getName() === name,
            )
            ?.getCommentText(),
          schema: {
            type: arg
              .getTypeNode()
              .getText() as OpenAPIV3.NonArraySchemaObjectType,
          },
        };
      }
    }
  }
}

interface RequestBasicInfo {
  url: string;
  method: string;
  data?: string;
  params?: string;
}

export default OpenAPIWriter;
