import { test as jestTest } from "@jest/globals";

type TestOptions = Readonly<{
  skip?: boolean | string;
  timeout?: number;
}>;

type TestContext = Readonly<{
  after: (callback: () => void | Promise<void>) => void;
}>;

type TestCallback = (context: TestContext) => void | Promise<void>;
type TestDefinition = Readonly<{
  name: string;
  options: TestOptions;
  callback: TestCallback;
}>;

let activeChildren: TestDefinition[] | null = null;

const executeTest = async (definition: TestDefinition): Promise<void> => {
  const cleanups: (() => void | Promise<void>)[] = [];
  const children: TestDefinition[] = [];
  const parentChildren = activeChildren;
  activeChildren = children;

  try {
    await definition.callback(Object.freeze({
      after: (callback) => { cleanups.push(callback); }
    }));
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child) await executeTest(child);
    }
  } finally {
    activeChildren = parentChildren;
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
};

function test(name: string, callback: TestCallback): void;
function test(name: string, options: TestOptions, callback: TestCallback): void;
function test(
  name: string,
  optionsOrCallback: TestOptions | TestCallback,
  optionalCallback?: TestCallback
): void {
  const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : optionalCallback;
  if (!callback) throw new TypeError("A test callback is required.");

  const definition: TestDefinition = Object.freeze({ name, options, callback });
  if (activeChildren) {
    activeChildren.push(definition);
    return;
  }

  const register = options.skip ? jestTest.skip : jestTest;
  register(name, () => executeTest(definition), options.timeout);
}

export default test;
