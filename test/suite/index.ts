import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface RegisteredTest {
  readonly suiteName: string;
  readonly testName: string;
  readonly run: () => void | Promise<void>;
}

const tests: RegisteredTest[] = [];
let currentSuiteName = 'Tests';

(globalThis as { suite?: (name: string, callback: () => void) => void }).suite = (name, callback) => {
  const previousSuiteName = currentSuiteName;
  currentSuiteName = name;
  callback();
  currentSuiteName = previousSuiteName;
};

(globalThis as { test?: (name: string, callback: () => void | Promise<void>) => void }).test = (name, callback) => {
  tests.push({
    suiteName: currentSuiteName,
    testName: name,
    run: callback
  });
};

export async function run(): Promise<void> {
  try {
    const testsRoot = __dirname;
    for (const file of findTestFiles(testsRoot)) {
      await import(file);
    }

    let failures = 0;
    for (const registeredTest of tests) {
      try {
        await registeredTest.run();
        console.log(`ok - ${registeredTest.suiteName}: ${registeredTest.testName}`);
      } catch (error) {
        failures += 1;
        console.error(`not ok - ${registeredTest.suiteName}: ${registeredTest.testName}`);
        console.error(error);
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} tests failed.`);
    }

    writeTestMarker();
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeWindow');
  }
}

function findTestFiles(root: string): string[] {
  const entries = fs.readdirSync(root, {
    withFileTypes: true
  });

  return entries.flatMap(entry => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return findTestFiles(fullPath);
    }

    return entry.isFile() && entry.name.endsWith('.test.js') ? [fullPath] : [];
  });
}

function writeTestMarker(): void {
  const markerPath = process.env.MINIMAX_TTS_TEST_MARKER;
  if (markerPath) {
    fs.writeFileSync(markerPath, 'completed');
  }
}
