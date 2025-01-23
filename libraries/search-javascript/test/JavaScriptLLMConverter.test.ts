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
    });

    it('should update quantity when adding existing items', () => {
        cart.addItem('Apple', 1.99);
        cart.addItem('Apple', 1.99, 3);

    });

    it('should not add items with negative quantity', () => {
        cart.addItem('Pear', 2.49, -1);

    });

    it('should remove items from the cart', () => {
        cart.addItem('Orange', 0.79, 3);
        cart.removeItem('Orange', 1);

    });

    it('should remove items completely when quantity reaches 0', () => {
        cart.addItem('Grapes', 3.49, 1);
        cart.removeItem('Grapes');

    });

    it('should calculate total price of items in the cart', () => {
        cart.addItem('Milk', 2.99, 2);
        cart.addItem('Eggs', 1.49, 6);

    });

    it('should view all items in the cart with total price', () => {
        cart.addItem('Chips', 1.29, 2);
        cart.addItem('Soda', 0.99, 3);
        const cartItems = cart.viewCart();

    });

    it('should check if the cart is empty', () => {
        cart.addItem('Water', 0.49);

    });

    it('should clear all items from the cart', () => {
        cart.addItem('Book', 9.99);
        cart.addItem('Pen', 0.79, 5);
        cart.clearCart();

    });

    // Test scenario combining different methods in sequence
    it('should perform multiple operations correctly', () => {
        cart.addItem('TestItem', 1.0); // Add item
        cart.addItem('TestItem', 1.0, 3); // Update quantity
        cart.removeItem('TestItem', 2); // Remove some items
        cart.addItem('NegativeItem', 2.0, -2); // Add item with negative quantity

        cart.clearCart();

    });

    // Test adding items with 0 quantities
    it('should handle items with 0 quantity', () => {
        cart.addItem('ZeroQuantityItem', 3.0, 0);

    });

    // Test removing items that are not in the cart
    it('should not remove items that are not in the cart', () => {
        cart.removeItem('NonExistingItem');

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
    const path =
      "C:\\Users\\erwin\\syntest-framework\\libraries\\search-javascript\\test\\ShoppingCart.js";
    const code = `
class ShoppingCart {
    constructor(items) {
        this.items = items;
    }

    // Add an item to the cart
    addItem(item, price, quantity = 1) {
        if (quantity <= 0) {
            console.error("Quantity should be positive.");
            return;
        }

        const existingItem = this.items.find(cartItem => cartItem.item === item);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.items.push({ item, price, quantity });
        }
    }

    // Remove an item from the cart
    removeItem(item, quantity = 1) {
        const itemIndex = this.items.findIndex(cartItem => cartItem.item === item);

        if (itemIndex === -1) {
            console.error("Item not found in cart.");
            return;
        }

        if (this.items[itemIndex].quantity > quantity) {
            this.items[itemIndex].quantity -= quantity;
        } else {
            this.items.splice(itemIndex, 1); // Remove item if quantity drops to 0 or below
        }
    }

    // Calculate total price of items in the cart
    calculateTotal() {
        return this.items.reduce((total, cartItem) => {
            return total + cartItem.price * cartItem.quantity;
        }, 0);
    }

    // View all items in the cart
    viewCart() {
        return this.items.map(cartItem => {
            return {
                item: cartItem.item,
                price: cartItem.price,
                quantity: cartItem.quantity,
                total: cartItem.price * cartItem.quantity
            };
        });
    }

    // Check if the cart is empty
    isEmpty() {
        return this.items.length === 0;
    }

    // Clear all items from the cart
    clearCart() {
        this.items = [];
    }
}

module.exports = ShoppingCart;

    `;

    const astFactory = new AbstractSyntaxTreeFactory();
    const result = astFactory.convert(path, code);
    if (isFailure(result)) throw result.error;
    const ast = unwrap(result);

    const targetMapGenerator = new TargetFactory(false);
    const targetResult = targetMapGenerator.extract("", ast);
    if (isFailure(targetResult)) throw targetResult.error;
    const target = unwrap(targetResult);

    const cfpResult = new ControlFlowGraphFactory(false).convert("", ast);
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

    // Step 3: Initialize Constant Pools
    const constantPoolFactory = new ConstantPoolFactory(false);
    const targetConstantPool = constantPoolFactory.extract("", ast);
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
    const set: Set<string> = new Set<string>();
    set.add(path);
    const rootContext = new RootContext(
      "C:\\Users\\erwin\\syntest-framework",
      set,
      set,
      astFactory,
      new ControlFlowGraphFactory(false),
      new TargetFactory(false),
      new DependencyFactory(false),
      new ExportFactory(false),
      new TypeExtractor(false),
      new InferenceTypeModelFactory(),
      new ConstantPoolFactory(false),
    );
    sampler.rootContext = rootContext;
    // Step 5: Run the conversion process
    const testCases = sampler.convertIRToSynTest(testSuite);
    const decoder = new JavaScriptDecoder("");

    // Step 6: Decode the test cases to verify correctness
    console.log(decoder.decode(testCases));
  });
});
