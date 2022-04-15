import type {
  ClassDeclaration,
  EnumDeclaration,
  InterfaceDeclaration,
  JSDoc,
  MethodDeclaration,
  ParameterDeclaration,
  ts,
  Type,
  TypeAliasDeclaration,
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
  abstract getTypes(): Iterable<Parser.TypeDeclaration>;
}

export namespace Parser {
  export interface Controller {
    name: string;
    baseUrl: string;
    docs: JSDoc[];
    requests: Iterable<Request>;
  }
  export interface Request {
    url: string;
    method: string;
    params?: PartialParameterDeclaration[];
    query?: ParameterDeclaration | PartialParameterDeclaration[];
    data?: ParameterDeclaration | PartialParameterDeclaration[];
    res: Type<ts.Type>;
    func: MethodDeclaration;
  }
  export interface PartialParameterDeclaration {
    property: string;
    parameter: ParameterDeclaration;
  }
  export type TypeDeclaration =
    | EnumDeclaration
    | InterfaceDeclaration
    | ClassDeclaration
    | TypeAliasDeclaration;
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
