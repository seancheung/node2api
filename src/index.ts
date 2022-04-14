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
  let configData: Config | Config[];
  try {
    configData = JSON.parse(configContent);
  } catch (error) {
    throw new Error('Invalid config content');
  }
  if (Array.isArray(configData)) {
    await Promise.all(configData.map((e) => runTask(e, stream)));
  } else {
    runTask(configData, stream);
  }
}

async function runTask(config: Config, stream?: boolean) {
  let parser: Parser;
  let writer: Writer;
  const { input, output } = config;
  switch (input.parser) {
    case 'nestjs':
      parser = new (await import('./parsers/nestjs')).default(input);
      break;
    default:
      throw new Error('unknown server type');
  }
  switch (output.writer) {
    case 'axios':
      writer = new (await import('./writers/axios')).default(output, parser);
      break;
    default:
      throw new Error('unknown emit mode');
  }
  writer.write(stream);
}
