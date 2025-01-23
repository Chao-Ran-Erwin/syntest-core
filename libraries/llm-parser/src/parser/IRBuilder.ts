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

import { DescribeBlock } from "../models/DescribeBlock";
import { IRStatement } from "../models/IRStatement"; // Updated IRStatement
import {
  AssignmentExpressionData,
  CallExpressionData,
  ConstructorCallData,
  MemberExpressionData,
  VariableDeclarationData,
} from "../models/IRStatementTypes";
import { TestCase } from "../models/TestCase";
import { TestSuite } from "../models/TestSuite";

import { ASTParser } from "./ASTParser";

export const IRBuilder = {
  buildIR(code: string): TestSuite {
    const ast = ASTParser.parse(code);
    const describeBlocks = ASTParser.extractDescribeBlocks(ast);

    const describeModels = describeBlocks.map((describeBlock) =>
      this.buildDescribeBlock(describeBlock),
    );

    return new TestSuite(describeModels);
  },

  buildDescribeBlock(describeBlock: {
    name: string;
    node: t.CallExpression;
  }): DescribeBlock {
    const name = describeBlock.name;

    const itBlocks = ASTParser.extractItBlocks(describeBlock.node);
    const testCases = itBlocks.map((itBlock) => this.buildTestCase(itBlock));

    const programNode = t.file(
      t.program([t.expressionStatement(describeBlock.node)]),
    );
    const beforeEachBlocks = ASTParser.extractBeforeEachBlocks(
      programNode,
    ).flatMap((block) => block.body);
    const beforeEachStatements = beforeEachBlocks.map((stmt) =>
      this.buildStatement(stmt),
    );

    return new DescribeBlock(name, testCases, beforeEachStatements);
  },

  buildTestCase(itBlock: { name: string; node: t.CallExpression }): TestCase {
    const name = itBlock.name;

    const functionNode = itBlock.node.arguments[1];
    if (
      !t.isFunctionExpression(functionNode) &&
      !t.isArrowFunctionExpression(functionNode)
    ) {
      throw new Error(`Expected a function in 'it' block: ${name}`);
    }

    const babelStatements = ASTParser.extractFunctionBody(functionNode);
    const statements = babelStatements.map((stmt) => this.buildStatement(stmt));

    return new TestCase(name, statements);
  },

  buildStatement(node: t.Statement | t.Expression): IRStatement {
    if (t.isExpressionStatement(node)) {
      return this.buildStatement(node.expression);
    }

    if (t.isNumericLiteral(node)) {
      return new IRStatement<number>("Numeric", node.value);
    }
    if (t.isStringLiteral(node)) {
      return new IRStatement<string>("String", node.value);
    }
    if (t.isBooleanLiteral(node)) {
      return new IRStatement<boolean>("Boolean", node.value);
    }
    if (t.isNullLiteral(node)) {
      return new IRStatement<null>("Null", undefined);
    }
    if (t.isIdentifier(node)) {
      return new IRStatement<{ name: string }>("Identifier", {
        name: node.name,
      });
    }

    if (t.isNewExpression(node)) {
      return this.parseNewExpression(node);
    }
    if (t.isCallExpression(node)) {
      return this.parseCallExpression(node);
    }
    if (t.isMemberExpression(node)) {
      return this.parseMemberExpression(node);
    }
    if (t.isAssignmentExpression(node)) {
      return this.parseAssignmentExpression(node);
    }

    if (t.isVariableDeclaration(node)) {
      const declarations = this.parseVariableDeclaration(node);
      return declarations.length === 1
        ? declarations[0]
        : new IRStatement("MultipleVariableDeclarations", declarations);
    }
    if (t.isUnaryExpression(node)) {
      return this.parseUnaryExpression(node);
    }
    throw new Error(`Unsupported node type: ${node.type} `);
  },

  parseNewExpression(node: t.NewExpression): IRStatement<ConstructorCallData> {
    const callee = t.isIdentifier(node.callee)
      ? node.callee.name
      : t.isExpression(node.callee)
        ? this.buildStatement(node.callee)
        : (() => {
            throw new Error(`Unsupported callee type: ${node.callee.type}`);
          })();

    const arguments_ = node.arguments.map((argument) =>
      t.isExpression(argument) ? this.buildStatement(argument) : undefined,
    );

    return new IRStatement<ConstructorCallData>("ConstructorCall", {
      callee,
      args: arguments_,
    });
  },

  parseCallExpression(node: t.CallExpression): IRStatement<CallExpressionData> {
    const callee = t.isExpression(node.callee)
      ? this.buildStatement(node.callee)
      : undefined;
    const arguments_ = node.arguments.map((argument) =>
      t.isExpression(argument) ? this.buildStatement(argument) : undefined,
    );

    return new IRStatement<CallExpressionData>("CallExpression", {
      callee,
      args: arguments_,
    });
  },

  parseMemberExpression(
    node: t.MemberExpression,
  ): IRStatement<MemberExpressionData> {
    const object = this.buildStatement(node.object);

    const property = t.isPrivateName(node.property)
      ? node.property.id.name
      : t.isIdentifier(node.property) && !node.computed
        ? node.property.name
        : this.buildStatement(node.property as t.Expression);

    return new IRStatement<MemberExpressionData>("MemberExpression", {
      object,
      property,
      computed: node.computed,
    });
  },

  parseAssignmentExpression(
    node: t.AssignmentExpression,
  ): IRStatement<AssignmentExpressionData> {
    const left = t.isIdentifier(node.left)
      ? new IRStatement<{ name: string }>("Identifier", {
          name: node.left.name,
        })
      : t.isMemberExpression(node.left) ||
          t.isOptionalMemberExpression?.(node.left)
        ? this.buildStatement(node.left as t.MemberExpression)
        : (() => {
            throw new Error(
              `Unsupported left-hand side in assignment: ${node.left.type}. Only simple identifiers and member expressions are currently supported.`,
            );
          })();

    const right = this.buildStatement(node.right);

    return new IRStatement<AssignmentExpressionData>("AssignmentExpression", {
      operator: node.operator,
      left,
      right,
    });
  },

  parseVariableDeclaration(
    node: t.VariableDeclaration,
  ): IRStatement<VariableDeclarationData>[] {
    return node.declarations.map((declarator) => {
      if (!t.isIdentifier(declarator.id)) {
        throw new Error(
          `Unsupported variable declarator id type: ${declarator.id.type}. Only identifiers are supported.`,
        );
      }

      const variableName = declarator.id.name;

      const initStatement = declarator.init
        ? this.buildStatement(declarator.init)
        : undefined;

      return new IRStatement<VariableDeclarationData>("VariableDeclaration", {
        name: variableName,
        kind: node.kind,
        init: initStatement,
      });
    });
  },
  parseUnaryExpression(node: t.UnaryExpression): IRStatement {
    if (!t.isExpression(node.argument)) {
      throw new Error("UnaryExpression argument must be an expression");
    }

    // Recursively process the operand
    const operand = this.buildStatement(node.argument);

    // Resolve the operand value
    const operandValue = operand.data;

    // Precompute the result
    const result = this._evaluateUnaryExpression(
      node.operator,
      operandValue as number | boolean,
    );

    // Return an IRStatement with the precomputed value
    if (typeof result === "number") {
      return new IRStatement<number>("Numeric", result);
    } else if (typeof result === "boolean") {
      return new IRStatement<boolean>("Boolean", result);
    } else {
      throw new TypeError(
        `Unsupported UnaryExpression result type: ${typeof result}`,
      );
    }
  },

  _evaluateUnaryExpression(
    operator: string,
    operandValue: number | boolean,
  ): number | boolean {
    switch (operator) {
      case "-": {
        if (typeof operandValue !== "number")
          throw new Error(
            `Operator '-' expects a number, got: ${typeof operandValue}`,
          );
        return -operandValue;
      }
      case "+": {
        if (typeof operandValue !== "number")
          throw new Error(
            `Operator '+' expects a number, got: ${typeof operandValue}`,
          );
        return +operandValue;
      }
      case "!": {
        if (typeof operandValue !== "boolean")
          throw new Error(
            `Operator '!' expects a boolean, got: ${typeof operandValue}`,
          );
        return !operandValue;
      }
      default: {
        throw new Error(`Unsupported unary operator: ${operator}`);
      }
    }
  },

  injectBeforeEachIntoTestCases(irTestSuite: TestSuite): TestSuite {
    // Clone the input to avoid mutating the original
    const transformedTestSuite: TestSuite = <TestSuite>(
      JSON.parse(JSON.stringify(irTestSuite))
    );

    for (const describeBlock of transformedTestSuite.describeBlocks) {
      const beforeEachBodies = describeBlock.beforeEachBodies;

      if (beforeEachBodies && beforeEachBodies.length > 0) {
        for (const testCase of describeBlock.testCases) {
          // Prepend the beforeEachBodies to each test case's statements
          testCase.statements = [...beforeEachBodies, ...testCase.statements];
        }
      }

      // Clear the beforeEachBodies since they're now part of the test cases
      describeBlock.beforeEachBodies = [];
    }

    return transformedTestSuite;
  },
};
