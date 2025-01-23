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
import * as t from "@babel/types";

import { ASTParser } from "../../src/parser/ASTParser";

describe("ASTParser", () => {
  const sampleCode = `
    describe('LinkedList', () => {
      let list;

      beforeEach(() => {
        list = new LinkedList();
      });

      it('should prepend a node', () => {
        list.prepend(1);
        expect(list.head.value).toBe(1);
      });

      it('should append a node', () => {
        list.append(1);
        expect(list.tail.value).toBe(1);
      });
    });
  `;

  let ast: t.File;

  beforeAll(() => {
    // Parse the sample code before running tests
    ast = ASTParser.parse(sampleCode);
  });

  test("should parse JavaScript code into an AST", () => {
    expect(ast).toBeDefined();
    expect(ast.type).toBe("File"); // Ensure root node is of type `File`
  });

  test("should extract describe blocks", () => {
    const describeBlocks = ASTParser.extractDescribeBlocks(ast);
    expect(describeBlocks).toHaveLength(1); // Only one describe block
    expect(describeBlocks[0].name).toBe("LinkedList"); // Ensure the name matches
  });

  test("should extract it blocks from describe block", () => {
    const describeBlocks = ASTParser.extractDescribeBlocks(ast);
    const itBlocks = ASTParser.extractItBlocks(describeBlocks[0].node);

    expect(itBlocks).toHaveLength(2); // Two `it` blocks
    expect(itBlocks[0].name).toBe("should prepend a node");
    expect(itBlocks[1].name).toBe("should append a node");
  });

  test("should extract beforeEach blocks", () => {
    const beforeEachBlocks = ASTParser.extractBeforeEachBlocks(ast);

    expect(beforeEachBlocks).toHaveLength(1); // One `beforeEach` block
    expect(beforeEachBlocks[0].body).toHaveLength(1); // Contains one statement
    const statement = beforeEachBlocks[0].body[0];
    expect(t.isExpressionStatement(statement)).toBe(true); // Ensure it's an ExpressionStatement
    const expression = (statement as t.ExpressionStatement).expression;
    expect(t.isAssignmentExpression(expression)).toBe(true); // Ensure it's an AssignmentExpression
  });

  test("should extract function body from concise arrow function", () => {
    const conciseCode = `
      beforeEach(() => list = new LinkedList());
    `;
    const conciseAst = ASTParser.parse(conciseCode);
    const beforeEachBlocks = ASTParser.extractBeforeEachBlocks(conciseAst);

    expect(beforeEachBlocks).toHaveLength(1); // One `beforeEach` block
    expect(beforeEachBlocks[0].body).toHaveLength(1); // Contains one concise statement
    const statement = beforeEachBlocks[0].body[0];
    expect(t.isExpressionStatement(statement)).toBe(true); // Ensure it's an ExpressionStatement
  });

  test("should handle nested describe blocks", () => {
    const nestedCode = `
      describe('Outer', () => {
        describe('Inner', () => {
          it('should do something', () => {});
        });
      });
    `;
    const nestedAst = ASTParser.parse(nestedCode);
    const describeBlocks = ASTParser.extractDescribeBlocks(nestedAst);

    expect(describeBlocks).toHaveLength(2); // Two `describe` blocks
    expect(describeBlocks[0].name).toBe("Outer");
    expect(describeBlocks[1].name).toBe("Inner");
  });
});
