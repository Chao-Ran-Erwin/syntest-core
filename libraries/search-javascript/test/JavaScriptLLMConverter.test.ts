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
import { initializePseudoRandomNumberGenerator } from "@syntest/prng";
import {
  ApproachLevelCalculator,
  extractBranchObjectivesFromProgram,
  extractFunctionObjectivesFromProgram,
  extractPathObjectivesFromProgram,
  ObjectiveFunction,
} from "@syntest/search";
import { IRBuilder } from "llmparser/src/parser/IRBuilder";

import { BranchDistanceCalculator } from "../lib/criterion/BranchDistance";
import { JavaScriptSubject } from "../lib/search/JavaScriptSubject";
import { JavaScriptDecoder } from "../lib/testbuilding/JavaScriptDecoder";
import { JavaScriptTestCase } from "../lib/testcase/JavaScriptTestCase";
import { JavaScriptLLMConverter } from "../lib/testcase/sampling/JavaScriptLLMConverter";

describe("JavaScriptLLMConverter Test", () => {
  beforeEach(() => {
    initializePseudoRandomNumberGenerator("0");
  });

  it("should convert LLM-generated test case to SynTest-compatible encoding", () => {
    // LLM-generated test case
    const testCaseCode = `


describe('ShoppingCart', () => {
    let cart;

    beforeEach(() => {
        cart = new ShoppingCart();
    });

    it('should add items to the cart', () => {
        cart.addItem('Apple', 1.99, 2);
        cart.addItem('Banana', 0.99);
        expect(cart.items.length).toBe(2);
    });

    it('should update quantity when adding existing items', () => {
        cart.addItem('Apple', 1.99);
        cart.addItem('Apple', 1.99, 3);

    });

    it('should not add items with negative quantity', () => {
        cart.addItem('Pear', 2.49, -1);
        expect(cart.items.length).toBe(0);
    });

    it('should remove items from the cart', () => {
        cart.addItem('Orange', 0.79, 3);
        cart.removeItem('Orange', 1);

    });

    it('should remove items completely when quantity reaches 0', () => {
        cart.addItem('Grapes', 3.49, 1);
        cart.removeItem('Grapes');
        expect(cart.items.length).toBe(0);
    });

    it('should calculate total price of items in the cart', () => {
        cart.addItem('Milk', 2.99, 2);
        cart.addItem('Eggs', 1.49, 6);
        expect(cart.calculateTotal()).toBeCloseTo(15.39, 2); // Due to floating point precision
    });

    it('should view all items in the cart with total price', () => {
        cart.addItem('Chips', 1.29, 2);
        cart.addItem('Soda', 0.99, 3);
        const cartItems = cart.viewCart();

    });

    it('should check if the cart is empty', () => {
        expect(cart.isEmpty()).toBe(true);
        cart.addItem('Water', 0.49);
        expect(cart.isEmpty()).toBe(false);
    });

    it('should clear all items from the cart', () => {
        cart.addItem('Book', 9.99);
        cart.addItem('Pen', 0.79, 5);
        cart.clearCart();
        expect(cart.items.length).toBe(0);
    });

    // Test scenario combining different methods in sequence
    it('should perform multiple operations correctly', () => {
        cart.addItem('TestItem', 1.0); // Add item
        cart.addItem('TestItem', 1.0, 3); // Update quantity
        cart.removeItem('TestItem', 2); // Remove some items
        cart.addItem('NegativeItem', 2.0, -2); // Add item with negative quantity
        expect(cart.items.length).toBe(1);
        expect(cart.calculateTotal()).toBeCloseTo(2.0, 2); // Total should consider only positive quantities
        expect(cart.isEmpty()).toBe(false); // Cart is not empty
        cart.clearCart();
        expect(cart.isEmpty()).toBe(true); // Cart is empty after clearing
    });

    // Test adding items with 0 quantities
    it('should handle items with 0 quantity', () => {
        cart.addItem('ZeroQuantityItem', 3.0, 0);
        expect(cart.items.length).toBe(0); // Item should not be added to the cart
    });

    // Test removing items that are not in the cart
    it('should not remove items that are not in the cart', () => {
        cart.removeItem('NonExistingItem');
        expect(cart.items.length).toBe(0); // Cart contents should remain the same
    });

    // Test adding items with very large quantities
    it('should handle items with large quantities', () => {
        cart.addItem('LargeQuantityItem', 1.0, Number.MAX_SAFE_INTEGER);


    });
});

       `;

    // Step 1: Convert LLM-generated code to IR
    const testSuiteBefore = IRBuilder.buildIR(testCaseCode);
    const testSuite = IRBuilder.injectBeforeEachIntoTestCases(testSuiteBefore);

    // Step 2: Analyze code for SynTest compatibility
    const rootPath =
      "C:\\Users\\erwin\\PycharmProjects\\syntest-framework\\libraries\\search-javascript\\test\\benchmark";
    const shoppingCartPath = path.resolve(rootPath, "ShoppingCart.js");

    const set: Set<string> = new Set<string>();
    set.add(shoppingCartPath);
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
    const result = rootContext.getAbstractSyntaxTree(shoppingCartPath);
    if (isFailure(result)) throw result.error;
    const ast = unwrap(result);

    const targetMapGenerator = new TargetFactory(false);
    const targetResult = targetMapGenerator.extract(shoppingCartPath, ast);
    if (isFailure(targetResult)) throw targetResult.error;
    const target = unwrap(targetResult);

    const cfpResult = new ControlFlowGraphFactory(false).convert(
      shoppingCartPath,
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
    const targetConstantPool = constantPoolFactory.extract(
      shoppingCartPath,
      ast,
    );
    const contextConstantPool = new ConstantPool();
    const dynamicConstantPool = new ConstantPool();
    const constantPoolManager = new ConstantPoolManager(
      targetConstantPool,
      contextConstantPool,
      dynamicConstantPool,
    );

    // Step 4: Create JavaScriptLLMConverter instance
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
      testSuite,
    );

    sampler.rootContext = rootContext;
    // Step 5: Run the conversion process
    const testCases = sampler.convertIRToSynTest(testSuite);
    const decoder = new JavaScriptDecoder("");

    // Step 6: Decode the test cases to verify correctness
    console.log(decoder.decode(testCases));
  });
});
