/*
 * Copyright 2020-2025 SynTest contributors
 *
 * This file is part of SynTest Framework.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  AbstractSyntaxTreeFactory,
  ConstantPool,
  ConstantPoolFactory,
  ConstantPoolManager,
  ControlFlowGraphFactory,
  DependencyFactory,
  ExportFactory,
  InferenceTypeModelFactory,
  RootContext,
  TargetFactory,
  TypeExtractor,
} from "@syntest/analysis-javascript";
import { FileSelector, TargetSelector } from "@syntest/base-language";
import { ControlFlowProgram } from "@syntest/cfg";
import { isFailure, unwrap } from "@syntest/diagnostics";
import { IRBuilder } from "@syntest/llmparser/src/parser/IRBuilder";
import {
  ApproachLevelCalculator,
  extractBranchObjectivesFromProgram,
  extractFunctionObjectivesFromProgram,
  extractPathObjectivesFromProgram,
  ObjectiveFunction,
} from "@syntest/search";
import * as chai from "chai";

import { BranchDistanceCalculator } from "../lib/criterion/BranchDistance";
import { JavaScriptSubject } from "../lib/search/JavaScriptSubject";
import { JavaScriptDecoder } from "../lib/testbuilding/JavaScriptDecoder";
import { JavaScriptTestCase } from "../lib/testcase/JavaScriptTestCase";
import { JavaScriptLLMConverter } from "../lib/testcase/sampling/JavaScriptLLMConverter";

const expect = chai.expect;

/**
 * Writes `code` to `test/converted-tests/converted-<className>_<index>.test.js`.
 */
function writeToFile(code: string, className: string, index: number) {
  const outputDirectory = path.join(
    process.cwd(),
    "test",
    "converted-tests/LLM-50/3",
  );
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  const fileName = `converted-${className}_${index}.test.js`;
  const filePath = path.join(outputDirectory, fileName);

  fs.writeFileSync(filePath, code, "utf8");
  return filePath;
}

/**
 * Finds *all* LLM test files for a given className.
 * E.g., LLM-test-hillCipher.js0.spec.js, LLM-test-hillCipher.js1.spec.js, ...
 */
function findAllTestCases(rootPath: string, className: string): string[] {
  const llmTestCaseFolder = "LLM-tests/LLM-50/3";
  const testCaseDirectory = path.join(rootPath, "..", llmTestCaseFolder);

  // Find all matching files that contain `LLM-test-<className>`.
  const files = fs
    .readdirSync(testCaseDirectory)
    .filter((file) => file.includes(`LLM-test-${className}`));

  if (files.length === 0) {
    throw new Error(`No test files found for ${className}`);
  }

  // Return the full paths to each matching file
  return files.map((fileName) => path.join(testCaseDirectory, fileName));
}

// ---------- SETUP ROOT CONTEXT & TARGETS ----------

// List your target files
// File paths to include for targets
const targetFilesPaths: string[] = [
  "./test/benchmark/javascript-algorithms/src/algorithms/graph/travelling-salesman/bfTravellingSalesman.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/cryptography/hill-cipher/hillCipher.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/math/liu-hui/liuHui.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/linked-list/LinkedList.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/disjoint-set/DisjointSet.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/Knapsack.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/KnapsackItem.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/hash-table/HashTable.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/graph/strongly-connected-components/stronglyConnectedComponents.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/fenwick-tree/FenwickTree.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/trie/TrieNode.js",
  "./test/benchmark/express/lib/view.js",
  "./test/benchmark/express/lib/router/layer.js",
  "./test/benchmark/moment/src/lib/create/from-anything.js",
  "./test/benchmark/moment/src/lib/moment/compare.js",
  "./test/benchmark/moment/src/lib/duration/create.js",
  "./test/benchmark/moment/src/lib/duration/bubble.js",
  "./test/benchmark/moment/src/lib/moment/min-max.js",
];

// In this example, we use the same file list for analysis
const analysisFilesPaths: string[] = [
  ...targetFilesPaths,
  "./benchmark/javascript-algorithms/src/**/*.js",
];

// Create a FileSelector instance to load file paths
const fileSelector = new FileSelector();
const targetFiles = fileSelector.loadFilePaths(targetFilesPaths, []);
const analysisFiles = fileSelector.loadFilePaths(analysisFilesPaths, []);

// Define the root path for the test benchmark
const rootPath = "./test/benchmark";

// Create the root context
const rootContext = new RootContext(
  rootPath,
  targetFiles,
  analysisFiles,
  new AbstractSyntaxTreeFactory(),
  new ControlFlowGraphFactory(false),
  new TargetFactory(false),
  new DependencyFactory(false),
  new ExportFactory(false),
  new TypeExtractor(false),
  new InferenceTypeModelFactory(),
  new ConstantPoolFactory(false),
);

// Create a TargetSelector instance with the root context
const targetSelector = new TargetSelector(rootContext);
const targets = targetSelector.loadTargets(targetFilesPaths, []);

// ---------- MAIN TEST SUITE (NO COVERAGE) ----------

describe("JavaScriptLLMConverter Test (Multiple LLM Files Per Class)", () => {
  for (const targetContext of targets) {
    // Extract the className from the target file
    const className = path.basename(
      targetContext.path,
      path.extname(targetContext.path),
    );

    it(`should convert LLM-generated test cases for ${className}`, () => {
      // 1) Find all LLM test files for this class
      const testCaseFilePaths = findAllTestCases(rootPath, className);

      // For each LLM test file (e.g. LLM-test-hillCipher.js0.spec.js, LLM-test-hillCipher.js1.spec.js, etc.)
      for (const [index, testCaseFilePath] of testCaseFilePaths.entries()) {
        // 2) Load the LLM-generated test code
        const testCaseCode = fs.readFileSync(testCaseFilePath, "utf8");

        // 3) Convert to IR
        const irBuilder = new IRBuilder();
        const rawTestSuite = irBuilder.buildIR(testCaseCode);

        // 4) Post-process IR
        const withBeforeEach =
          irBuilder.injectBeforeEachIntoTestCases(rawTestSuite);
        const finalTestSuite =
          irBuilder.postProcessFlattenChainedMemberExpressions(withBeforeEach);

        // 5) Retrieve AST from the target file
        const astResult = rootContext.getAbstractSyntaxTree(targetContext.path);
        if (isFailure(astResult)) throw astResult.error;
        const ast = unwrap(astResult);

        // 6) Create the control flow graph
        const cfpResult = new ControlFlowGraphFactory(false).convert(
          targetContext.path,
          ast,
        );
        if (isFailure(cfpResult)) throw cfpResult.error;
        const cfp: ControlFlowProgram = unwrap(cfpResult);

        // 7) Extract objectives
        const functionObjectives =
          extractFunctionObjectivesFromProgram<JavaScriptTestCase>(cfp);
        const branchObjectives =
          extractBranchObjectivesFromProgram<JavaScriptTestCase>(
            cfp,
            new ApproachLevelCalculator(),
            new BranchDistanceCalculator(
              false,
              "abcdefghijklmnopqrstuvwxyz1234567890",
            ),
            functionObjectives,
          );
        const pathObjectives =
          extractPathObjectivesFromProgram<JavaScriptTestCase>(
            cfp,
            new ApproachLevelCalculator(),
            new BranchDistanceCalculator(
              false,
              "abcdefghijklmnopqrstuvwxyz1234567890",
            ),
            functionObjectives,
          );

        const objectives: ObjectiveFunction<JavaScriptTestCase>[] = [
          ...functionObjectives,
          ...branchObjectives,
          ...pathObjectives,
        ];

        // 8) Create a JavaScriptSubject
        const subject = new JavaScriptSubject(targetContext, objectives);

        // 9) Manage constant pools
        const constantPoolFactory = new ConstantPoolFactory(false);
        const targetConstantPool = constantPoolFactory.extract(
          targetContext.path,
          ast,
        );
        const contextConstantPool = new ConstantPool();
        const dynamicConstantPool = new ConstantPool();
        const constantPoolManager = new ConstantPoolManager(
          targetConstantPool,
          contextConstantPool,
          dynamicConstantPool,
        );

        // 10) Create the JavaScriptLLMConverter
        const sampler = new JavaScriptLLMConverter(
          subject,
          constantPoolManager,
          false, // booleans controlling other parameters...
          0,
          false,
          0,
          false,
          0,
          "none",
          0.5,
          false,
          3,
          "abcdef",
          5,
          0.1,
          false,
          0.2,
          0.2,
          0.2,
          finalTestSuite,
        );
        sampler.rootContext = rootContext;
        // 11) Convert IR to SynTest encoding
        const testCases = sampler.convertIRToSynTest(finalTestSuite);
        expect(testCases.length).to.be.greaterThan(0);

        // 12) Decode to JS code
        const decoder = new JavaScriptDecoder("");
        const convertedCode = decoder.decode(testCases);

        // 13) Log & save the code
        console.log(
          `\n=== Converted code for ${className} (file #${index}) ===\n`,
        );
        console.log(convertedCode);

        // 14) Save as multiple files per class
        writeToFile(convertedCode, className, index);
      }
    });
  }
});
