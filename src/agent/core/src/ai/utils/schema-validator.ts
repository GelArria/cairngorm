import { Compile } from "typebox/compile";
import type { Tool } from "../types.js";
import { isRecord, type JsonSchemaObject } from "./json-coercion.js";

export function isValidatorSchema(value: unknown): value is Tool["parameters"] {
  return isRecord(value);
}

export function getSubSchemaValidator(
  schema: JsonSchemaObject,
): ReturnType<typeof Compile> | undefined {
  if (!isValidatorSchema(schema)) {
    return undefined;
  }
  try {
    return getValidator(schema);
  } catch {
    return undefined;
  }
}

export function getValidator(schema: Tool["parameters"]): ReturnType<typeof Compile> {
  const key = schema as object;
  const cached = validatorCache.get(key);
  if (cached) {
    return cached;
  }
  const validator = Compile(schema);
  validatorCache.set(key, validator);
  return validator;
}
const validatorCache = new WeakMap<object, ReturnType<typeof Compile>>();
