# node2api

A CLI plugin to generate client request SDK from nodejs server projects

## Installation

```bash
$ npm i -g node2api
```

> You may also install locally

## Usage

```bash
$ node2api [--config file] [--stream] [--help]
```

Local usage

```bash
$ npm i -D node2api
```

package.json

```json
{
  "scripts": {
    "sync": "node2api"
  }
}
```

```bash
$ npm run sync
```

## Config

Add `node2api.json` file to your project root.

Here is an example

```json
{
  "input": {
    "parser": "nestjs",
    "sources": [
      "./server/src/**/*.controller.ts",
      "!./server/src/health/**/*.ts"
    ],
    "types": [
      "./server/src/**/*.{dto,entity}.ts",
      "./server/types/**/*.d.ts",
      "!./server/types/config.d.ts"
    ]
  },
  "output": {
    "writer": "axios",
    "dest": "./client/src/api/index.ts",
    "httpModule": "./client/src/api/http.ts",
    "options": "opts",
    "comment": "/* eslint-disable */\n/* AUTO GENERATED. DO NOT CHANGE */",
    "formatSettings": {
      "indentSize": 2
    }
  }
}
```

Check [src/config.d.ts](./src/config.d.ts) for full definition.

### Batch mode

Config can be an array to enable batch mode
