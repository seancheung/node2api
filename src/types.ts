import type {
  EnumDeclarationStructure,
  FunctionDeclarationStructure,
  InterfaceDeclarationStructure,
  JSDocStructure,
  OptionalKind,
  TypeAliasDeclarationStructure,
} from 'ts-morph';
import { Config } from './config';

export abstract class Parser {
  constructor(protected readonly config: Config.Input) {}

  /**
   * Get requests grouped by controllers
   */
  abstract getControllers(): Iterable<Parser.Controller>;

  /**
   * Create interfaces/enums from source files
   */
  abstract getTypes(): Iterable<
    | InterfaceDeclarationStructure
    | EnumDeclarationStructure
    | TypeAliasDeclarationStructure
  >;
}

export namespace Parser {
  export interface Controller {
    name: string;
    requests: Iterable<OptionalKind<FunctionDeclarationStructure>>;
    docs?: Array<OptionalKind<JSDocStructure>>;
  }
}

export abstract class Writer {
  constructor(
    protected readonly config: Config.Output,
    protected readonly parser: Parser,
  ) {}

  /**
   * Write source files
   * @param stream Write to stdout instead of filesystem
   */
  abstract write(stream?: boolean): void;
}
