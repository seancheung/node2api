export interface Config<
  T extends Config.Input = Config.Input,
  U extends Config.Output = Config.Output,
> {
  /**
   * Input config
   */
  input: T;
  /**
   * Output config
   */
  output: U;
}
export namespace Config {
  export type Input = NestjsInput;
  export interface NestjsInput {
    /**
     * Input parser type
     */
    parser: 'nestjs';
    /**
     * Source files including controllers. Globs are allowed
     */
    sources: string | string[];
    /**
     * Source files including dto/entity or any classes/interfaces/enums used in controllers
     */
    types?: string | string[];
  }
  export type Output = AxiosOutput;
  export interface AxiosOutput {
    /**
     * Output writer type
     */
    writer: 'axios';
    /**
     * Output file path. If a single string is provided, requests and types will be written to the same file.
     */
    dest: AxiosOutput.Destination | string;
    /**
     * Http module file path. This module must export a default http client(e.g. `export default axios.create()`).
     * If omitted, `import axios from 'axios'` will be used instead.
     */
    httpModule?: string;
    /**
     * Add an extra options parameter with the given name to each request function if specified
     */
    options?: string;
    /**
     * Comment prepended to the output file
     */
    comment?: string;
    /**
     * Code formatting settings
     */
    formatSettings?: AxiosOutput.FormatSettings;
  }
  export namespace AxiosOutput {
    export interface FormatSettings {
      indentSize?: number;
      semicolons?: 'ignore' | 'insert' | 'remove';
    }
    export interface Destination {
      /**
       * Requests output file path
       */
      requestFile: string;
      /**
       * Types output file path
       */
      typesFile: string;
    }
  }
}
