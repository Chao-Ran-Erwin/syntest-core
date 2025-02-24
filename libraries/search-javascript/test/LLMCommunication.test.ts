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
import * as path from "node:path";

import {
  AbstractSyntaxTreeFactory,
  ConstantPoolFactory,
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
import { initializePseudoRandomNumberGenerator } from "@syntest/prng";
import {
  ApproachLevelCalculator,
  extractBranchObjectivesFromProgram,
  extractFunctionObjectivesFromProgram,
  extractPathObjectivesFromProgram,
  ObjectiveFunction,
} from "@syntest/search";

import { BranchDistanceCalculator } from "../lib/criterion/BranchDistance";
import { JavaScriptSubject } from "../lib/search/JavaScriptSubject";
import { JavaScriptTestCase } from "../lib/testcase/JavaScriptTestCase";
import { LLMCommunication } from "../lib/testcase/sampling/LLMCommunication";

/**
 * IMPORTANT:
 * - You need OPENAI_API_KEY in your environment for generateTest() to call OpenAI.
 * - This test consumes OpenAI credits, so use it carefully (or skip in CI).
 */

describe("LLMCommunication (Integration Tests)", function () {
  // Increase default Mocha timeout to accommodate multiple network calls
  this.timeout(120_000);

  // Initialize PRNG so results are deterministic if relevant
  initializePseudoRandomNumberGenerator("0");

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

  // 1) Collect file paths to analyze
  const fileSelector = new FileSelector();
  const targetFiles = fileSelector.loadFilePaths(targetFilesPaths, []);

  // 2) Create a RootContext
  const rootContext = new RootContext(
    path.resolve("."),
    targetFiles,
    targetFiles,
    new AbstractSyntaxTreeFactory(),
    new ControlFlowGraphFactory(false),
    new TargetFactory(false),
    new DependencyFactory(false),
    new ExportFactory(false),
    new TypeExtractor(false),
    new InferenceTypeModelFactory(),
    new ConstantPoolFactory(false),
  );

  // 3) Create a TargetSelector and load the actual targets
  const targetSelector = new TargetSelector(rootContext);
  const targets = targetSelector.loadTargets(targetFilesPaths, []);
  if (targets.length === 0) {
    throw new Error(`No targets found for the given file paths`);
  }

  let llmComm: LLMCommunication;

  before(() => {
    // If there's no OPENAI_API_KEY, the test will either fail or just return an error from OpenAI
    if (!process.env["OPENAI_API_KEY"]) {
      console.warn(
        "Warning: No OPENAI_API_KEY set! generateTest() will likely fail or return an error.",
      );
    }
    llmComm = new LLMCommunication();
  });

  describe("generateTest", () => {
    // Loop over each target returned by the TargetSelector
    for (const targetContext of targets) {
      const targetFileName = path.basename(
        targetContext.path,
        path.extname(targetContext.path),
      );

      it(`should generate a refined test suite for: ${targetFileName}`, async function () {
        // Build a new JavaScriptSubject for THIS targetContext

        // 1) Retrieve AST
        const astResult = rootContext.getAbstractSyntaxTree(targetContext.path);
        if (isFailure(astResult)) {
          throw astResult.error;
        }
        const ast = unwrap(astResult);

        // 2) Build a control-flow program
        const cfpResult = new ControlFlowGraphFactory(false).convert(
          targetContext.path,
          ast,
        );
        if (isFailure(cfpResult)) {
          throw cfpResult.error;
        }
        const cfp: ControlFlowProgram = unwrap(cfpResult);

        // 3) Extract objectives
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

        // 4) Create a new JavaScriptSubject
        const subject = new JavaScriptSubject(targetContext, objectives);

        // 5) Now call LLMCommunication.generateTest() with this subject
        const filePath = targetContext.path; // same as above
        const finalSuite = await llmComm.generateTest(filePath, subject);

        console.log(
          `\n=== Final refined test suite for ${targetFileName} ===\n`,
        );
        console.log(finalSuite);

        // Optionally, add an assertion to ensure we got something back
        if (!finalSuite || finalSuite.trim().length === 0) {
          throw new Error(
            `No final test suite returned for ${targetFileName}.`,
          );
        }
      });
    }
  });

  describe("loadTestSuite", () => {
    it("should load the test file content if it exists in the specified folder", () => {
      const testCaseFolder =
        "C:\\Users\\erwin\\PycharmProjects\\syntest-project\\syntest-framework\\libraries\\search-javascript\\test\\LLM-tests";
      const className = "LinkedList";

      const content = llmComm.loadTestSuite(testCaseFolder, className);
      console.log("Loaded test suite content:\n", content);
    });
  });
});
