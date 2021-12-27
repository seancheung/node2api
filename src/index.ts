#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import { Config } from './config';
import { Parser, Writer } from './types';

yargs(hideBin(process.argv))
  .option('config', {
    alias: 'c',
    type: 'string',
    desc: 'Path to config file',
  })
  .option('stream', {
    alias: 's',
    type: 'boolean',
    desc: 'Emit output to stdout instead of to files',
  })
  .command('$0', 'Parse and emit client sdk from nodejs project', () => {}, run)
  .parse();

interface Options {
  config?: string;
  stream?: boolean;
  verbose?: boolean;
}
async function run({ config, stream }: Options) {
  const configPath = config ? config : resolve(process.cwd(), 'node2api.json');
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at path "${configPath}"`);
  }
  const configContent = readFileSync(configPath, 'utf-8');
  let configData: Config;
  try {
    configData = JSON.parse(configContent);
  } catch (error) {
    throw new Error('Invalid config content');
  }
  let writer: Writer;
  let parser: Parser;
  const {
    client: { emitMode = 'single' },
    server: { type = 'nestjs' },
  } = configData;
  switch (type) {
    case 'nestjs':
      parser = new (await import('./parsers/nestjs')).default(configData);
      break;
    default:
      throw new Error('unknown server type');
  }
  switch (emitMode) {
    case 'single':
      writer = new (await import('./writers/single')).default(
        configData,
        parser,
      );
      break;
    default:
      throw new Error('unknown emit mode');
  }
  writer.write(stream);
}
