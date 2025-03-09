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
import generate from "@babel/generator";
import * as t from "@babel/types";
import { getLogger, Logger } from "@syntest/logging";

import { DescribeBlock } from "../models/DescribeBlock";
import { IRStatement } from "../models/IRStatement"; // Updated IRStatement
import {
  AssignmentExpressionData,
  CallExpressionData,
  ConstructorCallData,
  MemberExpressionData,
  ObjectExpressionData,
  ObjectMethodData,
  VariableDeclarationData,
} from "../models/IRStatementTypes";
import { TestCase } from "../models/TestCase";
import { TestSuite } from "../models/TestSuite";

import { ASTParser } from "./ASTParser";

export class IRBuilder {
  protected static LOGGER: Logger;

  constructor() {
    IRBuilder.LOGGER = getLogger(IRBuilder.name);
  }

  public buildIR(code: string): TestSuite {
    try {
      const ast = ASTParser.parse(code);
      const describeBlocks = ASTParser.extractDescribeBlocks(ast);

      const describeModels = describeBlocks
        .map((describeBlock) => this.buildDescribeBlock(describeBlock))
        .filter((d) => d !== undefined);
      let testSuite = new TestSuite(describeModels);

      // Postprocess to flatten chained members
      testSuite = this.postProcessFlattenChainedMemberExpressions(testSuite);

      return testSuite;
    } catch (error) {
      IRBuilder.LOGGER.warn(error as string);
      return undefined;
    }
  }

  buildDescribeBlock(describeBlock: {
    name: string;
    node: t.CallExpression;
  }): DescribeBlock {
    try {
      const name = describeBlock.name;

      const itBlocks = ASTParser.extractItBlocks(describeBlock.node);
      const testCases = itBlocks
        .map((itBlock) => this.buildTestCase(itBlock))
        .filter((tc) => tc !== undefined);

      const programNode = t.file(
        t.program([t.expressionStatement(describeBlock.node)]),
      );
      const beforeEachBlocks = ASTParser.extractBeforeEachBlocks(
        programNode,
      ).flatMap((block) => block.body);
      const beforeEachStatements = beforeEachBlocks
        .map((stmt) => this.buildStatement(stmt))
        .filter((s) => s !== undefined);

      return new DescribeBlock(name, testCases, beforeEachStatements);
    } catch (error) {
      IRBuilder.LOGGER.warn(error as string);
      return undefined;
    }
  }

  buildTestCase(itBlock: { name: string; node: t.CallExpression }): TestCase {
    const name = itBlock.name;

    const functionNode = itBlock.node.arguments[1];
    if (
      !t.isFunctionExpression(functionNode) &&
      !t.isArrowFunctionExpression(functionNode)
    ) {
      IRBuilder.LOGGER.warn(`Expected a function in 'it' block: ${name}`);
      return undefined;
    }

    const babelStatements = ASTParser.extractFunctionBody(functionNode);
    const statements = babelStatements
      .map((stmt) => this.buildStatement(stmt))
      .filter((s) => s !== undefined);

    return new TestCase(
      name,
      statements.filter((x) => x !== undefined),
    );
  }

  buildStatement(node: t.Statement | t.Expression): IRStatement {
    try {
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
        const declarations = this.parseVariableDeclaration(node).filter(
          (d) => d !== undefined,
        );
        return declarations.length === 1
          ? declarations[0]
          : new IRStatement("MultipleVariableDeclarations", declarations);
      }
      if (t.isUnaryExpression(node)) {
        return this.parseUnaryExpression(node);
      }

      if (t.isObjectExpression(node)) {
        return this.parseObjectExpression(node);
      }
      if (t.isArrayExpression(node)) {
        return this.parseArrayExpression(node);
      }
      if (t.isArrowFunctionExpression(node)) {
        return this.parseArrowFunctionExpression(node);
      }
      if (t.isReturnStatement(node)) {
        return new IRStatement("ReturnStatement", {
          argument: node.argument
            ? this.buildStatement(node.argument)
            : undefined,
        });
      }
      IRBuilder.LOGGER.warn(`Unsupported node type: ${node.type} `);
      IRBuilder.LOGGER.warn(generate(node).code);
      return undefined;
    } catch (error) {
      IRBuilder.LOGGER.warn(error as string);
      return undefined;
    }
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  parseUnaryExpression(node: t.UnaryExpression): IRStatement {
    if (!t.isExpression(node.argument)) {
      throw new Error("UnaryExpression argument must be an expression");
    }

    // Recursively process the operand
    const operand = this.buildStatement(node.argument);

    // Precompute the result
    const result = this._evaluateUnaryExpression(
      node.operator,
      operand.data as number | boolean,
    );

    // Return an IRStatement with the precomputed value
    if (typeof result === "number") {
      return new IRStatement<number>("Numeric", result);
    } else if (typeof result === "boolean") {
      return new IRStatement<boolean>("Boolean", result);
    } else {
      return undefined;
      // throw new TypeError(
      //   `Unsupported UnaryExpression result type: ${typeof result}`,
      // );
    }
  }

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
        // throw new Error(`Unsupported unary operator: ${operator}`);
        console.log(`Unsupported unary operator: ${operator}`);
        return undefined;
      }
    }
  }

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
  }

  parseObjectExpression(
    node: t.ObjectExpression,
  ): IRStatement<ObjectExpressionData> {
    const properties: Record<string, IRStatement> = {};

    for (const property of node.properties) {
      if (t.isObjectProperty(property)) {
        const key = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : (() => {
                throw new Error(
                  `Unsupported object property key type: ${property.key.type}`,
                );
              })();

        properties[key] = t.isExpression(property.value)
          ? this.buildStatement(property.value)
          : (() => {
              throw new Error(
                `Unsupported object property value type: ${property.value.type}`,
              );
            })();
      } else if (t.isObjectMethod(property)) {
        // Key is either an identifier or a string literal
        const key = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : (() => {
                throw new Error(
                  `Unsupported object method key type: ${property.key.type}`,
                );
              })();

        // Build an IRStatement describing the method
        properties[key] = this.parseObjectMethod(property);
      } else if (t.isSpreadElement(property)) {
        throw new Error(
          `Spread elements in object expressions are not yet supported: ${property.type}`,
        );
      } else {
        throw new Error(`Unsupported object property type`);
      }
    }

    return new IRStatement<ObjectExpressionData>("ObjectExpression", {
      properties,
    });
  }

  parseArrayExpression(node: t.ArrayExpression): IRStatement<IRStatement[]> {
    const elements: IRStatement[] = [];

    for (const element of node.elements) {
      if (!element) {
        throw new Error(
          "Null or undefined elements in ArrayExpression are not supported.",
        );
      }

      if (t.isExpression(element)) {
        elements.push(this.buildStatement(element));
      } else {
        throw new Error(`Unsupported array element type: ${element.type}`);
      }
    }

    return new IRStatement<IRStatement[]>("ArrayExpression", elements);
  }

  parseArrowFunctionExpression(node: t.ArrowFunctionExpression): IRStatement {
    // Process parameters
    const parameters = node.params.map((parameter) => {
      if (t.isIdentifier(parameter)) {
        return new IRStatement("Identifier", { name: parameter.name });
      }
      throw new Error(
        `Unsupported parameter type in arrow function: ${parameter.type}`,
      );
    });

    // Process body
    let body: IRStatement[];
    if (t.isBlockStatement(node.body)) {
      body = node.body.body.map((stmt) => this.buildStatement(stmt));
    } else {
      // Convert concise expression body to explicit return statement
      const returnExpr = this.buildStatement(node.body);
      body = [new IRStatement("ReturnStatement", { argument: returnExpr })];
    }

    return new IRStatement("ArrowFunction", {
      params: parameters,
      body,
      isAsync: node.async,
    });
  }

  public postProcessFlattenChainedMemberExpressions(
    testSuite: TestSuite,
  ): TestSuite {
    for (const describeBlock of testSuite.describeBlocks) {
      for (const testCase of describeBlock.testCases) {
        testCase.statements = this._flattenStatements(testCase.statements);
      }
    }
    return testSuite;
  }

  /**
   * Given an array of IRStatements, flatten each one and return a single flat array.
   */
  private _flattenStatements(statements: IRStatement[]): IRStatement[] {
    const flattened: IRStatement[] = [];
    for (const stmt of statements) {
      flattened.push(...this._flattenIR(stmt));
    }
    return flattened;
  }

  private _flattenIR(stmt: IRStatement | undefined): IRStatement[] {
    if (!stmt) {
      return [];
    }
    if (stmt.type === "MemberExpression") {
      const memberData = stmt.data as MemberExpressionData;
      const objectFlattened = this._flattenIR(memberData.object);
      const finalObject = objectFlattened.at(-1);

      if (!finalObject) {
        IRBuilder.LOGGER.warn(
          "Could not flatten MemberExpression: object is undefined",
        );
        return [];
      }

      if (objectFlattened.length > 1 || finalObject.type === "CallExpression") {
        const temporaryVariable = `tmp${Math.floor(Math.random() * 10_000)}`;
        const variableDecl = new IRStatement("VariableDeclaration", {
          name: temporaryVariable,
          kind: "const",
          init: finalObject,
        });
        const newMember = new IRStatement("MemberExpression", {
          object: new IRStatement("Identifier", { name: temporaryVariable }),
          property: memberData.property,
          computed: memberData.computed,
        });
        return [
          ...objectFlattened.slice(0, -1),
          variableDecl,
          ...this._flattenIR(newMember),
        ];
      }

      if (finalObject.type === "MemberExpression") {
        const innerFlattened = this._flattenIR(finalObject);
        const finalInner = innerFlattened.at(-1);
        if (!finalInner) {
          IRBuilder.LOGGER.warn("Could not flatten inner MemberExpression");
          return [];
        }
        const temporaryVariable = `tmp${Math.floor(Math.random() * 10_000)}`;
        const variableDecl = new IRStatement("VariableDeclaration", {
          name: temporaryVariable,
          kind: "const",
          init: finalInner,
        });
        const newMember = new IRStatement("MemberExpression", {
          object: new IRStatement("Identifier", { name: temporaryVariable }),
          property: memberData.property,
          computed: memberData.computed,
        });
        return [
          ...innerFlattened.slice(0, -1),
          variableDecl,
          ...this._flattenIR(newMember),
        ];
      }

      return [stmt];
    } else if (stmt.type === "CallExpression") {
      const callData = stmt.data as CallExpressionData;
      const calleeFlattened = this._flattenIR(callData.callee);
      const flattenedCallee = calleeFlattened.at(-1);

      if (!flattenedCallee) {
        IRBuilder.LOGGER.warn(
          "Could not flatten CallExpression: callee is undefined",
        );
        return [];
      }

      const argumentsFlattened: IRStatement[][] = [];
      const newArguments: IRStatement[] = [];
      for (const argument of callData.args) {
        const argumentFlattened = this._flattenIR(argument);
        argumentsFlattened.push(argumentFlattened);
        const lastArgument = argumentFlattened.at(-1);
        if (!lastArgument) {
          IRBuilder.LOGGER.warn("Skipping argument due to undefined value");
          continue;
        }
        newArguments.push(lastArgument);
      }

      const allStatements: IRStatement[] = [];
      allStatements.push(...calleeFlattened.slice(0, -1));
      for (const argument of argumentsFlattened) {
        allStatements.push(...argument.slice(0, -1));
      }

      const newCall = new IRStatement("CallExpression", {
        callee: flattenedCallee,
        args: newArguments,
      });
      allStatements.push(newCall);

      return allStatements;
    }

    return [stmt];
  }
  private parseObjectMethod(node: t.ObjectMethod): IRStatement {
    // Extract the method’s name, parameters, body, async, generator, etc.
    const methodName = t.isIdentifier(node.key)
      ? node.key.name
      : t.isStringLiteral(node.key)
        ? node.key.value
        : "unknownMethod";

    // Process parameters (similar to parseArrowFunctionExpression)
    const parametersIR: IRStatement[] = node.params.map((parameter) => {
      if (t.isIdentifier(parameter)) {
        return new IRStatement("Identifier", { name: parameter.name });
      }
      // You can handle other param patterns as needed
      throw new Error(
        `Unsupported parameter type in object method: ${parameter.type}`,
      );
    });

    // Process body
    let bodyIR: IRStatement[] = [];
    if (t.isBlockStatement(node.body)) {
      bodyIR = node.body.body.map((stmt) => this.buildStatement(stmt));
    } else {
      // Should never happen for an ObjectMethod, but just in case
      throw new Error(
        `Expected block statement in object method body: ${methodName}`,
      );
    }

    return new IRStatement<ObjectMethodData>("ObjectMethod", {
      name: methodName,
      params: parametersIR,
      body: bodyIR,
      kind: node.kind, // "method", "get", or "set"
    });
  }
}
