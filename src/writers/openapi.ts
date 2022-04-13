import { writeFileSync } from 'fs';
import type { OpenAPIV3 } from 'openapi-types';
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
    };

    const text = JSON.stringify(doc, null, 2);
    if (stream) {
      process.stdout.write(text);
    }
    writeFileSync(dest, text, 'utf-8');
  }
}

export default OpenAPIWriter;
