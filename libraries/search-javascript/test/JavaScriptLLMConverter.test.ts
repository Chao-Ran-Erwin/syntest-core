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
 * Unless required by applicable law or agreed to in writing,
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
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
// import { initializePseudoRandomNumberGenerator } from "@syntest/prng";
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

// initializePseudoRandomNumberGenerator("0")
const expect = chai.expect;

// Helper function to load the LLM-generated test case file
const llmTestCaseFolder = "LLM-tests";
function findTestCase(rootPath: string, className: string): string {
  const testCaseDirectory = path.join(rootPath, "..", llmTestCaseFolder);
  const files = fs.readdirSync(testCaseDirectory);
  const testCaseFile = files.find((file) =>
    file.endsWith(`${className}.test.js`),
  );

  if (!testCaseFile) {
    throw new Error(`Test case for ${className} not found`);
  }

  return fs.readFileSync(path.join(testCaseDirectory, testCaseFile), "utf8");
}

// Define the file paths to use as “include” patterns for target files
const targetFilesPaths: string[] = [
  // "./test/benchmark/javascript-algorithms/src/algorithms/graph/travelling-salesman/bfTravellingSalesman.js",
  // "./test/benchmark/javascript-algorithms/src/algorithms/cryptography/hill-cipher/hillCipher.js",
  // "./test/benchmark/javascript-algorithms/src/algorithms/math/liu-hui/liuHui.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/linked-list/LinkedList.js",
  // "./test/benchmark/javascript-algorithms/src/data-structures/disjoint-set/DisjointSet.js",
  // "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/Knapsack.js",
  // "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/KnapsackItem.js",
  // "./test/benchmark/javascript-algorithms/src/data-structures/hash-table/HashTable.js",
  // "./test/benchmark/javascript-algorithms/src/algorithms/graph/strongly-connected-components/stronglyConnectedComponents.js",
  // "./test/benchmark/javascript-algorithms/src/data-structures/tree/fenwick-tree/FenwickTree.js",
  // "./test/benchmark/javascript-algorithms/src/data-structures/trie/TrieNode.js",
  // "./test/ShoppingCart.js",
  // "./test/benchmark/express/lib/view.js",
  // "./test/benchmark/express/lib/router/layer.js",
  // "./test/benchmark/moment/src/lib/create/from-anything.js",
  // "./test/benchmark/moment/src/lib/moment/compare.js",
  // "./test/benchmark/moment/src/lib/duration/create.js",
  // "./test/benchmark/moment/src/lib/duration/bubble.js",
  // "./test/benchmark/moment/src/lib/moment/min-max.js",
];

// In this example we use the same file list for analysis files
const analysisFilesPaths: string[] = [
  ...targetFilesPaths,
  "./benchmark/javascript-algorithms/src/**/*.js",
];

// (Optional) Create a FileSelector instance to load file paths that will be passed into the RootContext
const fileSelector = new FileSelector();
const targetFiles = fileSelector.loadFilePaths(targetFilesPaths, []);
const analysisFiles = fileSelector.loadFilePaths(analysisFilesPaths, []);

// Define the root path for the test benchmark
const rootPath = "./test/benchmark";

// Create the root context (using the arrays of file paths)
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

// --- New Code Using TargetSelector ---
// Create a TargetSelector instance with the root context.
const targetSelector = new TargetSelector(rootContext);
// Load targets by passing the include patterns (your target file paths) and an empty exclude list.
const targets = targetSelector.loadTargets(targetFilesPaths, []);
describe("JavaScriptLLMConverter Test", () => {
  // Iterate over each target returned by the TargetSelector.
  for (const targetContext of targets) {
    // Use the target's file path and name (extracted via path.basename)
    const className = path.basename(
      targetContext.path,
      path.extname(targetContext.path),
    );

    it(`should convert ${className} LLM-generated test cases to Syntest-encoding`, () => {
      // Load the LLM-generated test case code
      const testCaseCode = findTestCase(rootPath, className);

      // Step 1: Convert LLM-generated code to IR
      const irBuilder = new IRBuilder();
      const testSuite = irBuilder.buildIR(testCaseCode);

      // Post-process the test suite
      const temporaryTestSuite =
        irBuilder.injectBeforeEachIntoTestCases(testSuite);
      const finalTestSuite =
        irBuilder.postProcessFlattenChainedMemberExpressions(
          temporaryTestSuite,
        );

      // Retrieve the AST from the target file
      const result = rootContext.getAbstractSyntaxTree(targetContext.path);
      if (isFailure(result)) throw result.error;
      const ast = unwrap(result);

      // Create the control flow graph from the AST
      const cfpResult = new ControlFlowGraphFactory(false).convert(
        targetContext.path,
        ast,
      );
      if (isFailure(cfpResult)) throw cfpResult.error;
      const cfp: ControlFlowProgram = unwrap(cfpResult);

      // Extract the objectives from the program (functions, branches, and paths)
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

      const objectives: ObjectiveFunction<JavaScriptTestCase>[] = [];
      objectives.push(
        ...functionObjectives,
        ...branchObjectives,
        ...pathObjectives,
      );

      // Create the JavaScriptSubject instance with the target and objectives
      const subject = new JavaScriptSubject(targetContext, objectives);

      // Manage the constant pools required by the converter
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

      // Step 4: Create the JavaScriptLLMConverter instance using the subject and constant pool manager
      const sampler = new JavaScriptLLMConverter(
        subject,
        constantPoolManager,
        false,
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

      // Set the root context for the sampler
      sampler.rootContext = rootContext;

      // Step 5: Run the conversion process from IR to SynTest encoding

      const testCases = sampler.convertIRToSynTest(finalTestSuite);
      const decoder = new JavaScriptDecoder("");

      // Step 6: Decode the test cases to verify correctness (here, we log them)

      console.log(decoder.decode(testCases));
      expect(testCases.length).to.be.greaterThan(0);
    });
  }
});
