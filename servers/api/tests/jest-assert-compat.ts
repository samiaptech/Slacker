import nodeAssert from "node:assert";

// Plain data is recreated in this realm so Node's strict comparator can verify it.
const normalizeForStrictEquality = (
  value: unknown,
  seen = new WeakMap<object, unknown>()
): unknown => {
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known) return known;

  if (Array.isArray(value)) {
    const normalized: unknown[] = [];
    normalized.length = value.length;
    seen.set(value, normalized);
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if ("value" in descriptor) {
        const descriptorValue: unknown = descriptor.value as unknown;
        descriptor.value = normalizeForStrictEquality(descriptorValue, seen);
      }
      Object.defineProperty(normalized, key, descriptor);
    }
    return normalized;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  const constructorValue: unknown = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value as unknown
    : undefined;
  const isPlainObject = prototype === null || (
    Object.getPrototypeOf(prototype) === null &&
    typeof constructorValue === "function" &&
    constructorValue.name === "Object"
  );
  if (!isPlainObject) return value;

  const normalized: Record<PropertyKey, unknown> = prototype === null
    ? Object.create(null) as Record<PropertyKey, unknown>
    : {};
  seen.set(value, normalized);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      const descriptorValue: unknown = descriptor.value as unknown;
      descriptor.value = normalizeForStrictEquality(descriptorValue, seen);
    }
    Object.defineProperty(normalized, key, descriptor);
  }
  return normalized;
};

const jestAssert = Object.assign(nodeAssert, {
  deepEqual: (actual: unknown, expected: unknown): void => {
    nodeAssert.deepStrictEqual(
      normalizeForStrictEquality(actual),
      normalizeForStrictEquality(expected)
    );
  },
  equal: nodeAssert.strictEqual,
  notEqual: nodeAssert.notStrictEqual
});

export default jestAssert;
