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
import * as babelParser from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export class ASTParser {
  constructor() {}
  /**
   * Parses JavaScript code into an Abstract Syntax Tree (AST).
   * @param code - The JavaScript code to parse.
   * @returns The parsed AST.
   */
  public static parse(code: string): t.File {
    return babelParser.parse(code, {
      sourceType: "module", // Supports ES modules
      plugins: ["jsx", "typescript"], // Add plugins for JSX and TypeScript if needed
    });
  }

  /**
   * Extracts `describe` blocks from the AST.
   * @param ast - The AST to traverse.
   * @returns An array of describe block details.
   */
  public static extractDescribeBlocks(
    ast: t.File,
  ): Array<{ name: string; node: t.CallExpression }> {
    const describeBlocks: Array<{ name: string; node: t.CallExpression }> = [];

    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const callee = path.node.callee;

        // Check if the function is `describe`
        if (t.isIdentifier(callee, { name: "describe" })) {
          const arguments_ = path.node.arguments;

          if (arguments_.length > 0 && t.isStringLiteral(arguments_[0])) {
            describeBlocks.push({ name: arguments_[0].value, node: path.node });
          }
        }
      },
    });

    return describeBlocks;
  }

  /**
   * Extracts `it` blocks from a given `describe` block.
   * @param describeNode - The `describe` block's AST node.
   * @returns An array of it block details.
   */
  public static extractItBlocks(
    describeNode: t.CallExpression,
  ): Array<{ name: string; node: t.CallExpression }> {
    const itBlocks: Array<{ name: string; node: t.CallExpression }> = [];

    const programNode: t.File = t.file(
      t.program([t.expressionStatement(describeNode)]),
    );

    traverse(programNode, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const callee = path.node.callee;

        // Check if the function is `it`
        if (t.isIdentifier(callee, { name: "it" }) || t.isIdentifier(callee, { name: "test"})) {
          const arguments_ = path.node.arguments;

          if (arguments_.length > 0 && t.isStringLiteral(arguments_[0])) {
            itBlocks.push({ name: arguments_[0].value, node: path.node });
          }
        }
      },
    });

    return itBlocks;
  }

  /**
   * Extracts the body of a function (e.g., `it` or `beforeEach`).
   * @param functionNode - The function expression or arrow function node.
   * @returns The statements inside the function body.
   */
  public static extractFunctionBody(
    functionNode: t.FunctionExpression | t.ArrowFunctionExpression,
  ): t.Statement[] {
    if (t.isBlockStatement(functionNode.body)) {
      return functionNode.body.body;
    }

    // For concise arrow functions, wrap the single expression in a BlockStatement
    return [t.expressionStatement(functionNode.body)];
  }

  /**
   * Extracts `beforeEach` blocks from the AST.
   * @param ast - The AST to traverse.
   * @returns An array of beforeEach block details.
   */
  public static extractBeforeEachBlocks(
    ast: t.File,
  ): Array<{ node: t.CallExpression; body: t.Statement[] }> {
    const beforeEachBlocks: Array<{
      node: t.CallExpression;
      body: t.Statement[];
    }> = [];

    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const callee = path.node.callee;

        // Check if the function is `beforeEach`
        if (t.isIdentifier(callee, { name: "beforeEach" })) {
          const arguments_ = path.node.arguments;

          if (
            arguments_.length > 0 &&
            (t.isFunctionExpression(arguments_[0]) ||
              t.isArrowFunctionExpression(arguments_[0]))
          ) {
            beforeEachBlocks.push({
              node: path.node,
              body: ASTParser.extractFunctionBody(arguments_[0]),
            });
          }
        }
      },
    });

    return beforeEachBlocks;
  }
}
