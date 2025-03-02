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
import { ControlFlowProgram } from "@syntest/cfg";
import { isFailure, unwrap } from "@syntest/diagnostics";
// import { initializePseudoRandomNumberGenerator } from "@syntest/prng";
import {
  ApproachLevelCalculator,
  extractBranchObjectivesFromProgram,
  extractFunctionObjectivesFromProgram,
  extractPathObjectivesFromProgram,
  ObjectiveFunction,
} from "@syntest/search";

import { BranchDistanceCalculator } from "../lib/criterion/BranchDistance";
import { JavaScriptSubject } from "../lib/search/JavaScriptSubject";
import { JavaScriptDecoder } from "../lib/testbuilding/JavaScriptDecoder";
import { JavaScriptTestCase } from "../lib/testcase/JavaScriptTestCase";
import { JavaScriptRandomSampler } from "../lib/testcase/sampling/JavaScriptRandomSampler";

describe("sampler info", () => {
  // beforeEach(() => {
  //   initializePseudoRandomNumberGenerator("0");
  // });
  it("run sampler", () => {
    const rootPath = "./test/benchmark";
    const testPath = path.resolve(
      rootPath,
      "" +
        "javascript-algorithms/src/algorithms/graph/travelling-salesman/bfTravellingSalesman.js",
      // "moment/src/lib/duration/create.js"
    );

    const set: Set<string> = new Set<string>();
    set.add(testPath);
    const rootContext = new RootContext(
      rootPath,
      set,
      set,
      new AbstractSyntaxTreeFactory(),
      new ControlFlowGraphFactory(false),
      new TargetFactory(false),
      new DependencyFactory(false),
      new ExportFactory(false),
      new TypeExtractor(false),
      new InferenceTypeModelFactory(),
      new ConstantPoolFactory(false),
    );
    const result = rootContext.getAbstractSyntaxTree(testPath);
    if (isFailure(result)) throw result.error;
    const ast = unwrap(result);

    const targetMapGenerator = new TargetFactory(false);
    const targetResult = targetMapGenerator.extract(testPath, ast);
    if (isFailure(targetResult)) throw targetResult.error;
    const target = unwrap(targetResult);

    const cfpResult = new ControlFlowGraphFactory(false).convert(testPath, ast);
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
    const pathObjectives = extractPathObjectivesFromProgram<JavaScriptTestCase>(
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
    const subject = new JavaScriptSubject(target, objectives);

    const constantPoolFactory = new ConstantPoolFactory(false);
    const targetConstantPool = constantPoolFactory.extract(testPath, ast);
    const contextConstantPool = new ConstantPool();
    const dynamicConstantPool = new ConstantPool();
    const constantPoolManager = new ConstantPoolManager(
      targetConstantPool,
      contextConstantPool,
      dynamicConstantPool,
    );
    const sampler = new JavaScriptRandomSampler(
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
    );

    sampler.rootContext = rootContext;

    const testCase = sampler.sample();
    const decoder = new JavaScriptDecoder(rootPath);
    console.log(JSON.stringify(testCase));
    console.log(decoder.decode(testCase));
  });
});
