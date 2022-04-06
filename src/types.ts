import type {
  EnumDeclarationStructure,
  InterfaceDeclarationStructure,
  ModuleDeclarationStructure,
  OptionalKind,
  SourceFile,
  TypeAliasDeclarationStructure,
} from 'ts-morph';
import { Config } from './config';

export abstract class ContextConsumer {
  constructor(protected readonly config: Config) {}
}

export abstract class Parser extends ContextConsumer {
  /**
   * Create modules from source files
   * @param files Controller source files
   */
  abstract createModules(
    files: Iterable<SourceFile>,
  ): Iterable<OptionalKind<ModuleDeclarationStructure>>;
  /**
   * Create interfaces/enums from source files
   * @param files DTO/entity source files
   */
  abstract createTypes(
    files: Iterable<SourceFile>,
  ): Iterable<
    | InterfaceDeclarationStructure
    | EnumDeclarationStructure
    | TypeAliasDeclarationStructure
  >;
}

export abstract class Writer extends ContextConsumer {
  constructor(
    protected readonly config: Config,
    protected readonly parser: Parser,
  ) {
    super(config);
  }
  /**
   * Write source files
   * @param stream Write to stdout instead of filesystem
   */
  abstract write(stream?: boolean): void;
}
