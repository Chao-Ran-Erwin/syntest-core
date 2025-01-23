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
import { DescribeBlock } from "../../src/models/DescribeBlock";
import { IRStatement } from "../../src/models/IRStatement";
import { TestCase } from "../../src/models/TestCase";
import { TestSuite } from "../../src/models/TestSuite";
import { ASTParser } from "../../src/parser/ASTParser";
import { IRBuilder } from "../../src/parser/IRBuilder";

describe("IRBuilder", () => {
  describe("IRBuilder Integration Test", () => {
    it("should correctly parse a complete test suite", () => {
      const code = `
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

      // Step 1: Build the IR
      const testSuite = IRBuilder.buildIR(code);
      console.log(JSON.stringify(testSuite));
      // Step 2: Assertions on TestSuite
      expect(testSuite).toBeInstanceOf(TestSuite);
      expect(testSuite.describeBlocks).toHaveLength(1);

      const describeBlock = testSuite.describeBlocks[0];
      expect(describeBlock).toBeInstanceOf(DescribeBlock);
      expect(describeBlock.name).toBe("ShoppingCart");

      // Step 3: Assertions on beforeEachBodies
      expect(describeBlock.beforeEachBodies).toHaveLength(1);
      const beforeEachStatement = describeBlock.beforeEachBodies[0];
      expect(beforeEachStatement).toBeInstanceOf(IRStatement);
      expect(beforeEachStatement.type).toBe("AssignmentExpression");
      expect(beforeEachStatement.data).toMatchObject({
        operator: "=",
        left: { type: "Identifier", data: { name: "cart" } },
        right: {
          type: "ConstructorCall",
          data: {
            callee: "ShoppingCart",
            args: [],
          },
        },
      });

      // Step 4: Assertions on TestCases
      expect(describeBlock.testCases).toHaveLength(1);
      const testCase = describeBlock.testCases[0];
      expect(testCase).toBeInstanceOf(TestCase);
      expect(testCase.name).toBe("should add items to the cart");

      // Step 5: Assertions on TestCase Statements
      expect(testCase.statements).toHaveLength(3);

      const [stmt1, stmt2, stmt3] = testCase.statements;

      // cart.addItem('Apple', 1.99, 2);
      // cart.addItem('Apple', 1.99, 2);
      expect(stmt1).toBeInstanceOf(IRStatement);
      expect(stmt1.type).toBe("CallExpression");
      expect(stmt1.data).toMatchObject({
        callee: {
          type: "MemberExpression",
          data: {
            object: {
              type: "Identifier",
              data: { name: "cart" },
            },
            property: "addItem",
            computed: false,
          },
        },
        args: [
          { type: "String", data: { value: "Apple" } },
          { type: "Numeric", data: { value: 1.99 } },
          { type: "Numeric", data: { value: 2 } },
        ],
      });

      // cart.addItem('Banana', 0.99);
      expect(stmt2).toBeInstanceOf(IRStatement);
      expect(stmt2.type).toBe("CallExpression");
      expect(stmt2.data).toMatchObject({
        callee: {
          type: "MemberExpression",
          data: {
            object: {
              type: "Identifier",
              data: { name: "cart" },
            },
            property: "addItem",
            computed: false,
          },
        },
        args: [
          { type: "String", data: { value: "Banana" } },
          { type: "Numeric", data: { value: 0.99 } },
        ],
      });

      // expect(cart.items.length).toBe(2);
      expect(stmt3).toBeInstanceOf(IRStatement);
      expect(stmt3.type).toBe("CallExpression");
    });
  });

  describe("buildDescribeBlock", () => {
    it("should build a DescribeBlock with multiple it blocks", () => {
      const code = `
        describe("Cart", () => {
          it("should add items", () => {});
          it("should remove items", () => {});
        });
      `;

      const ast = ASTParser.parse(code);
      const describeBlocks = ASTParser.extractDescribeBlocks(ast);
      const describeBlock = IRBuilder.buildDescribeBlock(describeBlocks[0]);

      expect(describeBlock).toBeInstanceOf(DescribeBlock);
      expect(describeBlock.name).toBe("Cart");
      expect(describeBlock.testCases).toHaveLength(2);

      expect(describeBlock.testCases[0]).toBeInstanceOf(TestCase);
      expect(describeBlock.testCases[0].name).toBe("should add items");

      expect(describeBlock.testCases[1]).toBeInstanceOf(TestCase);
      expect(describeBlock.testCases[1].name).toBe("should remove items");
    });

    it("should handle a describe block with a beforeEach block", () => {
      const code = `
        describe("Cart", () => {
          beforeEach(() => {
            initializeCart();
          });

          it("should add items", () => {});
        });
      `;

      const ast = ASTParser.parse(code);
      const describeBlocks = ASTParser.extractDescribeBlocks(ast);
      const describeBlock = IRBuilder.buildDescribeBlock(describeBlocks[0]);

      expect(describeBlock.beforeEachBodies).toHaveLength(1);

      const [beforeEachStatement] = describeBlock.beforeEachBodies;
      expect(beforeEachStatement).toBeInstanceOf(IRStatement);
      expect(beforeEachStatement.type).toBe("CallExpression");
    });
  });

  describe("buildTestCase", () => {
    it("should build a TestCase with a valid function body", () => {
      const code = `
        describe("Cart", () => {
          it("should add items to the cart", () => {
            cart.addItem('Apple', 1.99, 2);
          });
        });
      `;

      const ast = ASTParser.parse(code);
      const describeBlocks = ASTParser.extractDescribeBlocks(ast);
      const itBlocks = ASTParser.extractItBlocks(describeBlocks[0].node);
      const testCase = IRBuilder.buildTestCase(itBlocks[0]);

      expect(testCase).toBeInstanceOf(TestCase);
      expect(testCase.name).toBe("should add items to the cart");
      expect(testCase.statements).toHaveLength(1);

      const statement = testCase.statements[0];
      expect(statement).toBeInstanceOf(IRStatement);
      expect(statement.type).toBe("CallExpression");
    });

    it("should throw an error for an it block without a function", () => {
      const code = `
        describe("Cart", () => {
          it("should fail without a function");
        });
      `;

      const ast = ASTParser.parse(code);
      const describeBlocks = ASTParser.extractDescribeBlocks(ast);
      const itBlocks = ASTParser.extractItBlocks(describeBlocks[0].node);

      expect(() => IRBuilder.buildTestCase(itBlocks[0])).toThrowError(
        /Expected a function in 'it' block/,
      );
    });
  });

  describe("buildStatement", () => {
    it("should correctly parse a numeric literal", () => {
      const code = `42;`;
      const ast = ASTParser.parse(code);
      const statement = IRBuilder.buildStatement(ast.program.body[0]);

      expect(statement).toBeInstanceOf(IRStatement);
      expect(statement.type).toBe("Numeric");
      expect(statement.data).toEqual({ value: 42 });
    });

    it("should correctly parse a call expression", () => {
      const code = `cart.addItem('Apple', 1.99);`;
      const ast = ASTParser.parse(code);
      const statement = IRBuilder.buildStatement(ast.program.body[0]);

      expect(statement).toBeInstanceOf(IRStatement);
      expect(statement.type).toBe("CallExpression");
      expect(statement.data).toHaveProperty("callee");
      expect(statement.data).toHaveProperty("args");
    });
  });

  describe("buildIR", () => {
    it("should build a TestSuite with multiple DescribeBlocks", () => {
      const code = `
        describe("FirstBlock", () => {
          it("test1", () => {});
        });
        describe("SecondBlock", () => {
          it("test2", () => {});
        });
      `;

      const testSuite = IRBuilder.buildIR(code);

      expect(testSuite).toBeInstanceOf(TestSuite);
      expect(testSuite.describeBlocks).toHaveLength(2);

      const [firstBlock, secondBlock] = testSuite.describeBlocks;
      expect(firstBlock.name).toBe("FirstBlock");
      expect(secondBlock.name).toBe("SecondBlock");
    });
  });
});
