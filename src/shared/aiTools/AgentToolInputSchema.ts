/** 工具参数只有一个校验 owner；外部 MCP schema 与内置工具复用同一 JSON Schema 实现。 */
import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import type { AnySchema, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JsonSchema } from './AgentToolContracts';

const options = {
  strict: false,
  strictNumbers: true,
  addUsedSchema: true,
  // 只判断参数，不为模型补默认值、转换类型或删除字段。
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  code: { es5: true },
} as const;
const validators = {
  draft7: addFormats(new Ajv(options)),
  draft2019: addFormats(new Ajv2019(options)),
  draft2020: addFormats(new Ajv2020(options)),
};
const compiledSchemas = new WeakMap<JsonSchema, ValidateFunction>();

/** 发现/SQLite 快照边界提前拒绝非法或无法解析的 schema；内部执行信任已冻结的定义。 */
export function assertAgentToolInputSchema(schema: JsonSchema): void {
  compileSchema(schema);
}

export function matchesAgentToolInputSchema(value: unknown, schema: JsonSchema): boolean {
  return compileSchema(schema)(value) as boolean;
}

function compileSchema(schema: JsonSchema): ValidateFunction {
  const cached = compiledSchemas.get(schema);
  if (cached) return cached;
  if (schema.$async === true) throw new Error('工具参数不支持异步 JSON Schema');
  const dialect = schema.$schema;
  let validator: Ajv;
  switch (dialect) {
    case undefined:
    case 'https://json-schema.org/draft/2020-12/schema':
      validator = validators.draft2020;
      break;
    case 'https://json-schema.org/draft/2019-09/schema':
      validator = validators.draft2019;
      break;
    case 'http://json-schema.org/draft-07/schema#':
    case 'https://json-schema.org/draft-07/schema':
      validator = validators.draft7;
      break;
    default:
      throw new Error(`不支持的工具 JSON Schema 方言：${String(dialect)}`);
  }
  // 同步编译只允许 schema 自身可解析的引用，不联网获取远端 $ref。
  // Ajv 的强引用缓存在编译后释放，run 结束后 WeakMap 不持有旧发现快照。
  try {
    const compiled = validator.compile(schema as AnySchema);
    compiledSchemas.set(schema, compiled);
    return compiled;
  } finally {
    validator.removeSchema(schema as AnySchema);
  }
}
