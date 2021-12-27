export interface Config {
  /**
   * Nodejs server config
   */
  server: Config.Server;
  /**
   * Http client sdk config
   */
  client: Config.Client;
}
export namespace Config {
  export interface Server {
    /**
     * Type of server framework. Default is `nestjs`
     * @default 'nestjs''
     */
    type?: Server.Type;
    /**
     * Source files including controllers. Globs are allowed
     */
    sources: string | string[];
    /**
     * Source files including dto/entity or any classes/interfaces used by client
     */
    types?: string[];
  }
  export interface Client {
    /**
     * Type of http lib used by client. Default is `axios`
     * @default 'axios''
     */
    type?: Client.Type;
    /**
     * Output file path
     */
    target: string;
    /**
     * Http module file path. This module must export a default http client(e.g. `export default axios.create()`).
     * If omitted, module set with `type` will be used instead.
     */
    httpModule?: string;
    /**
     * Output mode. Default is `single`
     * @default 'single'
     */
    emitMode?: Client.Mode;
    /**
     * Comment prepended to the output file
     */
    comment?: string;
    /**
     * Code formatting settings
     */
    formatSettings?: Client.FormatSettings;
  }
  export namespace Server {
    export type Type = 'nestjs';
  }
  export namespace Client {
    export type Type = 'axios';
    export type Mode = 'single';
    export interface FormatSettings {
      indentSize?: number;
      semicolons?: 'ignore' | 'insert' | 'remove';
    }
  }
}
