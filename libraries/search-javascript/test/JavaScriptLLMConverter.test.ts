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
function writeToFile(
  code: string,
  className: string,
  index: number,
  folderNumber: number,
) {
  const outputDirectory = path.join(
    process.cwd(),
    "test",
    `final-evaluation/parsed-LLM-tests/${folderNumber}`,
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
function findAllTestCases(
  rootPath: string,
  className: string,
  folderNumber: number,
): string[] {
  const llmTestCaseFolder = `final-evaluation/LLM-tests/${folderNumber}`;
  const testCaseDirectory = path.join(rootPath, "..", llmTestCaseFolder);
  const normalizedClassName = className.replaceAll("-", "_");

  const files = fs
    .readdirSync(testCaseDirectory)
    .filter((file) => file.includes(`_${normalizedClassName}`));

  if (files.length === 0) {
    throw new Error(
      `No test files found for ${className} in folder ${folderNumber}`,
    );
  }

  return files.map((fileName) => path.join(testCaseDirectory, fileName));
}

// ---------- SETUP ROOT CONTEXT & TARGETS ----------

// List your target files
// File paths to include for targets
const targetFilesPaths: string[] = [
  "./test/benchmark/javascript-algorithms/src/algorithms/graph/travelling-salesman/bfTravellingSalesman.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/cryptography/hill-cipher/hillCipher.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/cryptography/rail-fence-cipher/railFenceCipher.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/math/liu-hui/liuHui.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/linked-list/LinkedList.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/doubly-linked-list/DoublyLinkedList.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/disjoint-set/DisjointSet.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/graph/GraphEdge.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/Knapsack.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/sets/knapsack-problem/KnapsackItem.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/hash-table/HashTable.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/queue/Queue.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/stack/Stack.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/graph/strongly-connected-components/stronglyConnectedComponents.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/fenwick-tree/FenwickTree.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/trie/TrieNode.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/avl-tree/AvlTree.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/binary-search-tree/BinarySearchTree.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/binary-search-tree/BinarySearchTreeNode.js",
  "./test/benchmark/javascript-algorithms/src/data-structures/tree/red-black-tree/RedBlackTree.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/graph/depth-first-search/depthFirstSearch.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/math/binary-floating-point/bitsToFloat.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/math/binary-floating-point/floatAsBinaryString.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/uncategorized/n-queens/nQueens.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/uncategorized/n-queens/QueenPosition.js",
  "./test/benchmark/javascript-algorithms/src/algorithms/image-processing/seam-carving/resizeImageWidth.js",
  "./test/benchmark/express/lib/view.js",
  "./test/benchmark/express/lib/router/layer.js",
  "./test/benchmark/moment/src/lib/create/from-anything.js",
  "./test/benchmark/moment/src/lib/duration/add-subtract.js",
  "./test/benchmark/moment/src/lib/locale/lists.js",
  "./test/benchmark/moment/src/lib/moment/compare.js",
  "./test/benchmark/moment/src/lib/duration/create.js",
  "./test/benchmark/moment/src/lib/duration/bubble.js",
  "./test/benchmark/moment/src/lib/moment/min-max.js",
  "./test/benchmark/moment/src/lib/parse/token.js",
  "./test/benchmark/moment/src/lib/units/week-calendar-utils.js",
  "./test/benchmark/moment/src/lib/utils/is-moment-input.js",
];

// In this example, we use the same file list for analysis
const analysisFilesPaths: string[] = [
  ...targetFilesPaths,
  "./benchmark/javascript-algorithms/src/**/*.js",
  "./benchmark/moment/src/**/*.js",
  "./benchmark/express/lib/**/*.js",
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
  new ControlFlowGraphFactory(true),
  new TargetFactory(true),
  new DependencyFactory(true),
  new ExportFactory(true),
  new TypeExtractor(true),
  new InferenceTypeModelFactory(),
  new ConstantPoolFactory(true),
);

// Create a TargetSelector instance with the root context
const targetSelector = new TargetSelector(rootContext);
const targets = targetSelector.loadTargets(targetFilesPaths, []);

// ---------- MAIN TEST SUITE ----------

describe("JavaScriptLLMConverter Test (Multiple LLM Files Per Class)", () => {
  for (let folderNumber = 1; folderNumber <= 10; folderNumber++) {
    for (const targetContext of targets) {
      const className = path.basename(
        targetContext.path,
        path.extname(targetContext.path),
      );

      it(`should convert LLM-generated test cases for ${className} (folder ${folderNumber})`, () => {
        const testCaseFilePaths = findAllTestCases(
          rootPath,
          className,
          folderNumber,
        );

        for (const [index, testCaseFilePath] of testCaseFilePaths.entries()) {
          const testCaseCode = fs.readFileSync(testCaseFilePath, "utf8");

          const irBuilder = new IRBuilder();
          const rawTestSuite = irBuilder.buildIR(testCaseCode);

          const withBeforeEach =
            irBuilder.injectBeforeEachIntoTestCases(rawTestSuite);
          const finalTestSuite =
            irBuilder.postProcessFlattenChainedMemberExpressions(
              withBeforeEach,
            );

          const astResult = rootContext.getAbstractSyntaxTree(
            targetContext.path,
          );
          if (isFailure(astResult)) throw astResult.error;
          const ast = unwrap(astResult);

          const cfpResult = new ControlFlowGraphFactory(false).convert(
            targetContext.path,
            ast,
          );
          if (isFailure(cfpResult)) throw cfpResult.error;
          const cfp: ControlFlowProgram = unwrap(cfpResult);

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

          const subject = new JavaScriptSubject(targetContext, objectives);

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
          sampler.rootContext = rootContext;

          const testCases = sampler.convertIRToSynTest(finalTestSuite);
          expect(testCases.length).to.be.greaterThan(0);

          const decoder = new JavaScriptDecoder("");
          const convertedCode = decoder.decode(testCases);

          console.log(
            `\n=== Converted code for ${className} (file #${index}, folder ${folderNumber}) ===\n`,
          );
          console.log(convertedCode);

          writeToFile(convertedCode, className, index, folderNumber);
        }
      });
    }
  }
});
