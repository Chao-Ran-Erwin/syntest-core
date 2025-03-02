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
import { TargetType } from "@syntest/analysis";
import {
  ClassTarget,
  ConstantPoolManager,
  Export,
  FunctionTarget,
  isExported,
  MethodTarget,
  PropertyTarget,
} from "@syntest/analysis-javascript";
import { unwrapOr } from "@syntest/diagnostics";
import { IRStatement } from "@syntest/llmparser/src/models/IRStatement";
import {
  AssignmentExpressionData,
  CallExpressionData,
  ConstructorCallData,
  MemberExpressionData,
  ObjectExpressionData,
  VariableDeclarationData,
} from "@syntest/llmparser/src/models/IRStatementTypes";
import { TestSuite } from "@syntest/llmparser/src/models/TestSuite";
import { getLogger, Logger } from "@syntest/logging";
import { prng } from "@syntest/prng";

import { JavaScriptSubject } from "../../search/JavaScriptSubject";
import { JavaScriptTestCase } from "../JavaScriptTestCase";
import { StatementPool } from "../StatementPool";
import { ActionStatement } from "../statements/action/ActionStatement";
import { ClassActionStatement } from "../statements/action/ClassActionStatement";
import { ConstantObject } from "../statements/action/ConstantObject";
import { ConstructorCall } from "../statements/action/ConstructorCall";
import { FunctionCall } from "../statements/action/FunctionCall";
import { Getter } from "../statements/action/Getter";
import { MethodCall } from "../statements/action/MethodCall";
import { ObjectFunctionCall } from "../statements/action/ObjectFunctionCall";
import { Setter } from "../statements/action/Setter";
import { ArrayStatement } from "../statements/complex/ArrayStatement";
import { ArrowFunctionStatement } from "../statements/complex/ArrowFunctionStatement";
import { ObjectStatement } from "../statements/complex/ObjectStatement";
import { BoolStatement } from "../statements/primitive/BoolStatement";
import { IntegerStatement } from "../statements/primitive/IntegerStatement";
import { NullStatement } from "../statements/primitive/NullStatement";
import { NumericStatement } from "../statements/primitive/NumericStatement";
import { StringStatement } from "../statements/primitive/StringStatement";
import { UndefinedStatement } from "../statements/primitive/UndefinedStatement";
import { Statement } from "../statements/Statement";

import { JavaScriptRandomSampler } from "./JavaScriptRandomSampler";
import { JavaScriptTestCaseSampler } from "./JavaScriptTestCaseSampler";

export class JavaScriptLLMConverter extends JavaScriptTestCaseSampler {
  protected static LOGGER: Logger;
  private irTestSuite: TestSuite;
  private statementMap: Map<string, Statement>;
  private sampleCounter = 0; // increment this to iterate through tests
  private randomSampler: JavaScriptRandomSampler;

  constructor(
    subject: JavaScriptSubject,
    constantPoolManager: ConstantPoolManager,
    constantPoolEnabled: boolean,
    constantPoolProbability: number,
    typePoolEnabled: boolean,
    typePoolProbability: number,
    statementPoolEnabled: boolean,
    statementPoolProbability: number,
    typeInferenceMode: string,
    randomTypeProbability: number,
    incorporateExecutionInformation: boolean,
    maxActionStatements: number,
    stringAlphabet: string,
    stringMaxLength: number,
    deltaMutationProbability: number,
    exploreIllegalValues: boolean,
    addRemoveArgumentProbability: number,
    addArgumentProbability: number,
    removeArgumentProbability: number,
    irTestSuite: TestSuite,
  ) {
    super(
      subject,
      constantPoolManager,
      constantPoolEnabled,
      constantPoolProbability,
      typePoolEnabled,
      typePoolProbability,
      statementPoolEnabled,
      statementPoolProbability,
      typeInferenceMode,
      randomTypeProbability,
      incorporateExecutionInformation,
      maxActionStatements,
      stringAlphabet,
      stringMaxLength,
      deltaMutationProbability,
      exploreIllegalValues,
      addRemoveArgumentProbability,
      addArgumentProbability,
      removeArgumentProbability,
    );
    this.irTestSuite = irTestSuite;
    this.statementMap = new Map<string, Statement>(); // Uses variable name as key, assume LLM's don't reuse variable names
    JavaScriptLLMConverter.LOGGER = getLogger(JavaScriptLLMConverter.name);
    // Use random sampler for filling initial population, and mutation
    this.randomSampler = new JavaScriptRandomSampler(
      subject,
      constantPoolManager,
      constantPoolEnabled,
      constantPoolProbability,
      typePoolEnabled,
      typePoolProbability,
      statementPoolEnabled,
      statementPoolProbability,
      typeInferenceMode,
      randomTypeProbability,
      incorporateExecutionInformation,
      maxActionStatements,
      stringAlphabet,
      stringMaxLength,
      deltaMutationProbability,
      exploreIllegalValues,
      addRemoveArgumentProbability,
      addArgumentProbability,
      removeArgumentProbability,
    );
    this.randomSampler.rootContext = this.rootContext;
  }

  convertIRToSynTest(irTestSuite: TestSuite): JavaScriptTestCase[] {
    const testCases: JavaScriptTestCase[] = [];

    for (const describeBlock of irTestSuite.describeBlocks) {
      for (const testCase of describeBlock.testCases) {
        const statements = this._processIRStatements(0, testCase.statements);
        // Filter out any undefined statements that were discarded
        const filteredStatements = statements.filter((s) => s !== undefined);
        if (filteredStatements.length > 0) {
          this.randomSampler.statementPool = new StatementPool(
            filteredStatements,
          );
          testCases.push(new JavaScriptTestCase(filteredStatements));
        }
      }
    }
    return testCases;
  }

  sample(): JavaScriptTestCase {
    this.randomSampler.statementPool = new StatementPool([]);
    this.randomSampler.rootContext = this.rootContext;
    const tests = this.convertIRToSynTest(this.irTestSuite);
    const numberOfTests = tests.length;
    if (numberOfTests === 0) {
      return this.randomSampler.sample();
    }
    return this.sampleCounter < numberOfTests
      ? tests[this.sampleCounter++]
      : this.randomSampler.sample();
  }

  sampleRoot(): ActionStatement {
    return this.randomSampler.sampleRoot();
  }

  override sampleFunctionCall(
    depth: number,
    data?: CallExpressionData,
  ): FunctionCall {
    if (!data) {
      return this.randomSampler.sampleFunctionCall(depth);
    }

    // Extract the function name from the callee
    if (data.callee.type !== "Identifier") {
      JavaScriptLLMConverter.LOGGER.warn(
        `Expected Identifier for FunctionCall, but got ${data.callee.type}.`,
      );
      return undefined;
    }

    const functionName = (data.callee.data as { name: string }).name;

    const targets = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.FUNCTION)
      .filter((target) => isExported(target));

    const functionTarget = <FunctionTarget>(
      targets.find((t) => (t as FunctionTarget).name === functionName)
    );
    if (!functionTarget) {
      // JavaScriptLLMConverter.LOGGER.warn(`Function target not found: ${functionName}`);
      return undefined;
    }
    const type_ = this.rootContext
      .getTypeModel()
      .getObjectDescription(functionTarget.typeId);

    const arguments_ = [];

    for (const [index, argument] of data.args.entries()) {
      // Retrieve parameter information
      const parameterId = type_.parameters.get(index);
      const name = type_.parameterNames.get(index);

      // Map the argument to a Statement
      const mappedArgument = this._mapArgument(
        depth + 1,
        argument,
        parameterId,
        parameterId,
        name,
      );
      if (!mappedArgument) {
        JavaScriptLLMConverter.LOGGER.warn(
          `Argument: ${JSON.stringify(argument)} at index ${index} is undefined. Returning undefined for the entire function call.`,
        );
        return undefined;
      }
      arguments_[index] = mappedArgument;
    }
    const export_ = this._getExport(functionTarget.id);
    return new FunctionCall(
      functionTarget.id,
      functionTarget.typeId,
      functionTarget.name,
      prng.uniqueId(),
      arguments_,
      export_,
    );
  }

  override sampleConstructorCall(
    depth: number,
    classId?: string,
    data?: ConstructorCallData,
    name?: string,
  ): ConstructorCall {
    if (name && this.statementMap.has(name)) {
      const existing = this.statementMap.get(name);
      if (existing instanceof ConstructorCall) {
        return existing;
      }
    }
    if (!data) {
      return this.randomSampler.sampleConstructorCall(depth);
    }

    const class_ = <ClassTarget>(
      (<JavaScriptSubject>this._subject)
        .getActionableTargetsByType(TargetType.CLASS)
        .find((t) => (t as ClassTarget).name === data.callee)
    );
    if (!class_) {
      // JavaScriptLLMConverter.LOGGER.warn(
      //   // `Class target not found for: ${JSON.stringify(data.callee)}`,
      // );
      return undefined;
    }
    const constructor_ = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.METHOD)
      .find(
        (method) =>
          (<MethodTarget>method).classId === class_.id &&
          (<MethodTarget>method).methodType === "constructor",
      );

    if (!constructor_) {
      JavaScriptLLMConverter.LOGGER.warn(
        `In sampleConstructorCall Constructor not found for class: ${class_.id}`,
      );
      return undefined;
    }

    const constructor: MethodTarget = <MethodTarget>constructor_;
    const arguments_ = [];
    const type_ = this.rootContext
      .getTypeModel()
      .getObjectDescription(constructor.typeId);

    for (const [index, argument] of data.args.entries()) {
      // Retrieve parameter information
      const parameterId = type_.parameters.get(index);
      const name = type_.parameterNames.get(index);

      // Map the argument to a Statement
      const value = this._mapArgument(
        depth + 1,
        argument,
        parameterId,
        parameterId,
        name,
      );
      if (!value) return undefined;
      arguments_[index] = value;
    }

    const export_ = this._getExport(class_.id);

    const constructorCall = new ConstructorCall(
      constructor.id,
      constructor.typeId,
      class_.id,
      name,
      prng.uniqueId(),
      arguments_,
      export_,
    );

    this.statementMap.set(name, constructorCall);
    return constructorCall;
  }

  sampleClassAction(depth: number): MethodCall | Getter | Setter {
    return this.randomSampler.sampleClassAction(depth);
  }

  override sampleMethodCall(
    depth: number,
    data?: CallExpressionData,
  ): MethodCall {
    if (!data) {
      return this.randomSampler.sampleMethodCall(depth);
    }
    const methodName = this._extractMethodName(data.callee);
    const targets = (<JavaScriptSubject>this._subject).getActionableTargets();

    const methods = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.METHOD)
      .filter((method) => (<MethodTarget>method).methodType === "method")
      .filter((target) =>
        isExported(
          targets.find(
            (objectTarget) =>
              objectTarget.id === (<MethodTarget>target).classId,
          ),
        ),
      );

    // Retrieve the method target
    const methodTarget = <MethodTarget>(
      methods.find((t) => (t as MethodTarget).name === methodName)
    );

    if (!methodTarget) {
      return undefined;
    }
    // Get id and typeId of arguments
    const type_ = this.rootContext
      .getTypeModel()
      .getObjectDescription(methodTarget.typeId);

    const arguments_: Statement[] = [];

    for (const [index, argument] of data.args.entries()) {
      // Retrieve parameter information
      const parameterId = type_.parameters.get(index);
      const name = type_.parameterNames.get(index);

      // Map the argument to a Statement
      const mappedArgument = this._mapArgument(
        depth + 1,
        argument,
        parameterId,
        parameterId,
        name,
      );
      if (!mappedArgument) {
        JavaScriptLLMConverter.LOGGER.warn(
          `Argument at index ${index} is undefined. Returning undefined for the entire function call.`,
        );
        return undefined;
      }
      arguments_[index] = mappedArgument;
    }

    const class_ = this._getClass(methodTarget.classId);

    // Use the recursive helper to extract the base object name.
    const objectName = this._getBaseObjectName(data.callee);
    if (!objectName) {
      JavaScriptLLMConverter.LOGGER.warn(
        "Unable to extract base object name from callee",
      );
      return undefined;
    }
    let constructorCall = this.statementMap.get(objectName) as ConstructorCall;
    if (constructorCall) {
      // If the retrieved value is not a ConstructorCall, try to resolve it by following its _constructor chain
      // Example case disjointSet.makeSet("A").makeSet("B");
      // For the second makeSet it will retrieve disjointSet.makeSet("A") which is a methodCall.
      if (!(constructorCall instanceof ConstructorCall)) {
        let resolved: Statement = constructorCall;
        const maxAttempts = 10;
        let attempts = 0;
        while (
          !(resolved instanceof ConstructorCall) &&
          resolved instanceof ClassActionStatement &&
          attempts < maxAttempts
        ) {
          resolved = resolved.constructor_;
          attempts++;
        }
        if (resolved instanceof ConstructorCall) {
          constructorCall = resolved;
          this.statementMap.set(objectName, resolved);
        } else {
          JavaScriptLLMConverter.LOGGER.warn(
            `Could not resolve a ConstructorCall for object: ${objectName}`,
          );
          return undefined;
        }
      }
    } else {
      // Create a new constructor and save it in the map for future reuse
      constructorCall = this.sampleConstructorCall(
        depth + 1,
        class_.id,
        undefined,
        objectName,
      );
      if (constructorCall) {
        this.statementMap.set(objectName, constructorCall);
      } else {
        JavaScriptLLMConverter.LOGGER.warn(
          `Could not create constructor call for object: ${objectName}`,
        );
        return undefined;
      }
    }

    return new MethodCall(
      methodTarget.id,
      methodTarget.typeId,
      methodTarget.name,
      prng.uniqueId(),
      arguments_,
      constructorCall,
    );
  }

  sampleGetter(
    depth: number,
    name?: string,
    data?: MemberExpressionData,
  ): Getter {
    if (!data) {
      this.randomSampler.statementPool = new StatementPool([]);
      return this.randomSampler.sampleGetter(depth);
    }
    const propertyName = data.property as string;
    const property = [
      ...(<JavaScriptSubject>this._subject).getActionableTargetsByType(
        TargetType.PROPERTY,
      ),
      ...(<JavaScriptSubject>this._subject)
        .getActionableTargetsByType(TargetType.METHOD)
        .filter((method) => (<MethodTarget>method).methodType === "get"),
    ].find((t) => (t as PropertyTarget | MethodTarget).name === propertyName);

    if (!property) {
      // JavaScriptLLMConverter.LOGGER.warn(`Property not in list: ${propertyName}`);
      return undefined;
    }
    let constructorName: string;
    if (
      typeof data.object === "object" &&
      "data" in data.object &&
      (data.object.data as { name?: string }).name
    ) {
      constructorName = (data.object.data as { name: string }).name;
    } else if (typeof data.object === "string") {
      // In case data.object is directly given as a string.
      constructorName = data.object;
    } else {
      JavaScriptLLMConverter.LOGGER.error(
        "Unsupported object type in MemberExpressionData",
      );
      return undefined;
    }

    const constructor_ = this.statementMap.get(
      constructorName,
    ) as ConstructorCall;
    if (!constructor_) {
      JavaScriptLLMConverter.LOGGER.warn(
        `In sampleGetter Constructor call not found for class: ${constructorName}`,
      );
      return undefined;
    }
    if (constructor_.classIdentifier !== (property as PropertyTarget).classId) {
      JavaScriptLLMConverter.LOGGER.error(
        `Wrong constructor class in sampleGetter ${constructor_.classIdentifier}`,
      );
      return undefined;
    }
    return new Getter(
      property.id,
      property.id,
      propertyName,
      prng.uniqueId(),
      constructor_,
    );
  }

  sampleSetter(depth: number, left?: Getter, right?: Statement): Setter {
    // NOTE: if left or right is undefined, log and return undefined.
    if (!left || !right) {
      this.randomSampler.statementPool = new StatementPool([]);
      return this.randomSampler.sampleSetter(depth);
    }
    return new Setter(
      left.variableIdentifier,
      left.typeIdentifier,
      left.name,
      prng.uniqueId(),
      right,
      left.constructor_,
    );
  }

  sampleConstantObject(depth: number, objectId?: string): ConstantObject {
    this.randomSampler.statementPool = new StatementPool([]);
    return this.randomSampler.sampleConstantObject(depth, objectId);
  }

  sampleObjectFunctionCall(depth: number): ObjectFunctionCall {
    this.randomSampler.statementPool = new StatementPool([]);
    return this.randomSampler.sampleObjectFunctionCall(depth);
  }

  sampleArrayArgument(depth: number, arrayId: string): Statement {
    this.randomSampler.statementPool = new StatementPool([]);
    return this.randomSampler.sampleArrayArgument(depth, arrayId);
  }

  sampleObjectArgument(
    depth: number,
    objectId: string,
    property?: string,
  ): Statement {
    this.randomSampler.statementPool = new StatementPool([]);
    return this.randomSampler.sampleObjectArgument(depth, objectId, property);
  }

  sampleArgument(depth: number, id: string, name: string): Statement {
    // JavaScriptLLMConverter.LOGGER.warn("sampleArgument not implemented: " + depth + id + name);
    // return undefined;
    this.randomSampler.statementPool = new StatementPool([]);
    return this.randomSampler.sampleArgument(depth, id, name);
  }

  sampleObject(
    depth: number,
    id: string,
    typeId: string,
    name: string,
    data?: ObjectExpressionData,
  ): ObjectStatement | ConstantObject | ConstructorCall {
    if (!data) {
      this.randomSampler.statementPool = new StatementPool([]);
      return this.randomSampler.sampleObject(depth, id, typeId, name);
    }
    const object_: { [key: string]: Statement } = {};
    for (const [key, value] of Object.entries(data.properties)) {
      // Map each property to a corresponding SynTest statement
      const mapped = this._mapArgument(depth + 1, value, id, typeId, key);
      if (mapped) {
        object_[key] = mapped;
      } else {
        JavaScriptLLMConverter.LOGGER.warn(
          `Property ${key} could not be mapped in Object.`,
        );
      }
    }

    return new ObjectStatement(id, typeId, name, prng.uniqueId(), object_);
  }

  sampleArray(
    depth: number,
    id: string,
    typeId: string,
    name: string,
    data?: IRStatement[],
  ): ArrayStatement {
    if (!data) {
      this.randomSampler.statementPool = new StatementPool([]);
      return this.randomSampler.sampleArray(depth, id, typeId, name);
    }
    const elements: Statement[] = (data || [])
      .map((statement) =>
        this._mapArgument(depth + 1, statement, id, typeId, "arrayElement"),
      )
      .filter((s) => s !== undefined);
    return new ArrayStatement(id, typeId, name, prng.uniqueId(), elements);
  }

  sampleArrowFunction(
    depth: number,
    id: string,
    typeId: string,
    name: string,
  ): ArrowFunctionStatement {
    // JavaScriptLLMConverter.LOGGER.warn("sampleArrowFunction not implemented: " + depth + id + typeId + name);
    // return undefined;
    return this.randomSampler.sampleArrowFunction(depth, id, typeId, name);
  }

  sampleString(
    id: string,
    typeId: string,
    name: string,
    value?: string,
  ): StringStatement {
    if (!value) return this.randomSampler.sampleString(id, typeId, name);
    return new StringStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleBool(
    id: string,
    typeId: string,
    name: string,
    value?: boolean,
  ): BoolStatement {
    if (!value) return this.randomSampler.sampleBool(id, typeId, name);
    return new BoolStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleNull(id: string, typeId: string, name: string): NullStatement {
    return new NullStatement(id, typeId, name, prng.uniqueId());
  }

  sampleNumber(
    id: string,
    typeId: string,
    name: string,
    value?: number,
  ): NumericStatement {
    if (!value) return this.randomSampler.sampleNumber(id, typeId, name);
    return new NumericStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleInteger(
    id: string,
    typeId: string,
    name: string,
    value?: number,
  ): IntegerStatement {
    if (!value) return this.randomSampler.sampleInteger(id, typeId, name);
    return new IntegerStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleUndefined(
    id: string,
    typeId: string,
    name: string,
  ): UndefinedStatement {
    return new UndefinedStatement(id, typeId, name, prng.uniqueId());
  }

  private _getBaseObjectName(node: IRStatement): string | undefined {
    switch (node.type) {
      case "Identifier": {
        return (node.data as { name: string }).name;
      }
      case "MemberExpression": {
        // In a MemberExpression, check its object
        const memberData = node.data as MemberExpressionData;
        return this._getBaseObjectName(memberData.object);
      }
      case "CallExpression": {
        // In a CallExpression, check its callee
        const callData = node.data as CallExpressionData;
        return this._getBaseObjectName(callData.callee);
      }
      // No default
    }
    return undefined;
  }

  private _processIRStatements(
    depth: number,
    irStatements: IRStatement[],
  ): ActionStatement[] {
    const processedStatements: ActionStatement[] = [];
    for (const irStatement of irStatements) {
      try {
        switch (irStatement.type) {
          case "ConstructorCall": {
            const stmt = this.sampleConstructorCall(
              depth,
              undefined,
              irStatement.data as ConstructorCallData,
            );
            if (stmt) processedStatements.push(stmt);
            break;
          }

          case "CallExpression": {
            const data = irStatement.data as CallExpressionData;
            if (data.callee.type === "Identifier") {
              const stmt = this.sampleFunctionCall(depth, data);
              if (stmt) {
                processedStatements.push(stmt);
              }
            } else if (data.callee.type === "MemberExpression") {
              const calleeData = data.callee.data as MemberExpressionData;
              const calleeCallExpression = calleeData.object
                .data as CallExpressionData;

              // Expect casep
              if (
                calleeData.object.type === "CallExpression" &&
                calleeCallExpression.callee.type === "Identifier" &&
                (
                  calleeCallExpression.callee.data as {
                    name: string;
                  }
                ).name === "expect"
              ) {
                // Extract the method call inside `expect`
                const innerCall = calleeCallExpression.args[0];
                const innerCallExpression = innerCall.data;
                if (
                  innerCall.type === "CallExpression" &&
                  (innerCallExpression as CallExpressionData).callee.type ===
                    "MemberExpression"
                ) {
                  const stmt = this.sampleMethodCall(
                    depth + 1,
                    innerCallExpression as CallExpressionData,
                  );
                  if (stmt) processedStatements.push(stmt);
                } else if (innerCall.type === "MemberExpression") {
                  const stmt = this.sampleGetter(
                    depth + 1,
                    (innerCallExpression as MemberExpressionData)
                      .property as string,
                    innerCallExpression as MemberExpressionData,
                  );
                  if (stmt) processedStatements.push(stmt);
                } else if (innerCall.type === "Identifier") {
                  const identifierName = (innerCall.data as { name: string })
                    .name;
                  if (this.statementMap.has(identifierName)) {
                    const mapValue = this.statementMap.get(identifierName);
                    if (mapValue instanceof ActionStatement) {
                      processedStatements.push(mapValue);
                    }
                  } else {
                    JavaScriptLLMConverter.LOGGER.warn(
                      `Unhandled Identifier in expect: ${identifierName}`,
                    );
                  }
                } else {
                  JavaScriptLLMConverter.LOGGER.warn(
                    `Unhandled expect inner call: ${JSON.stringify(innerCall)}`,
                  );
                }
              } else {
                const stmt = this.sampleMethodCall(depth, data);
                if (stmt) processedStatements.push(stmt);
              }
            } else {
              JavaScriptLLMConverter.LOGGER.warn(
                "Invalid CallExpression callee type",
              );
            }
            break;
          }
          case "VariableDeclaration": {
            const data = irStatement.data as VariableDeclarationData;
            if (!data.init) {
              JavaScriptLLMConverter.LOGGER.warn(
                `VariableDeclaration '${data.name}' has no initializer.`,
              );
              break;
            }
            // Use _mapArgument with the variable name
            const initializer = this._mapArgument(
              depth,
              data.init,
              "anon",
              "anon",
              data.name,
            );
            if (initializer instanceof ActionStatement) {
              processedStatements.push(initializer);
            }
            this.statementMap.set(data.name, initializer);
            break;
          }
          case "AssignmentExpression": {
            const data = irStatement.data as AssignmentExpressionData;
            // Validate the left side
            if (data.left.type === "Identifier") {
              const variableName = (data.left.data as { name: string }).name;
              const rightStatement = this._mapArgument(
                depth,
                data.right,
                "anon",
                "anon",
                variableName,
              );
              if (rightStatement instanceof ActionStatement) {
                processedStatements.push(rightStatement);
              }
              this.statementMap.set(variableName, rightStatement);
            } else if (data.left.type === "MemberExpression") {
              // Assignment to a property of an object
              const left = this._mapArgument(depth, data.left) as Getter;
              const right = this._mapArgument(depth, data.right);
              const value = this.sampleSetter(depth, left, right);
              if (value) processedStatements.push(value);
            } else {
              JavaScriptLLMConverter.LOGGER.warn(
                `Unsupported left type in AssignmentExpression: ${data.left.type}`,
              );
            }
            break;
          }
          default: {
            JavaScriptLLMConverter.LOGGER.warn(
              `Unhandled IR statement type: ${irStatement.type}`,
            );
            JavaScriptLLMConverter.LOGGER.warn(
              JSON.stringify(irStatement.data),
            );
          }
        }
      } catch (error) {
        JavaScriptLLMConverter.LOGGER.error(
          `Error processing IR statement: ${error}`,
        );
      }
    }
    return processedStatements;
  }

  /**
   * Maps an IR argument into a SynTest-compatible statement.
   * @returns SynTest Statement.
   * @param depth
   * @param argument
   * @param name
   */
  private _mapArgument(
    depth: number,
    argument: IRStatement,
    id = "anon",
    typeId = "anon",
    name = "anon",
  ): Statement | undefined {
    try {
      switch (argument.type) {
        case "String": {
          return this.sampleString(id, typeId, name, argument.data as string);
        }
        case "Numeric": {
          return this.sampleNumber(id, typeId, name, argument.data as number);
        }
        case "Boolean": {
          return this.sampleBool(id, typeId, name, argument.data as boolean);
        }
        case "Null": {
          return this.sampleNull(id, typeId, name);
        }
        case "Undefined": {
          return this.sampleUndefined(id, typeId, name);
        }
        case "VariableDeclaration": {
          const data = argument.data as VariableDeclarationData;
          if (!data.init) {
            JavaScriptLLMConverter.LOGGER.warn(
              `VariableDeclaration '${data.name}' has no initializer.`,
            );
            return undefined;
          }
          // Pass the variable name when mapping the initializer
          return this._mapArgument(depth, data.init, id, typeId, data.name);
        }
        case "CallExpression": {
          const callData = argument.data as CallExpressionData;
          if (callData.callee.type === "MemberExpression") {
            return this.sampleMethodCall(depth + 1, callData);
          } else if (callData.callee.type === "Identifier") {
            return this.sampleFunctionCall(depth + 1, callData);
          }
          break;
        }
        case "ConstructorCall": {
          const callData = argument.data as ConstructorCallData;
          return this.sampleConstructorCall(depth + 1, "", callData, name);
        }
        case "MemberExpression": {
          const data = argument.data as MemberExpressionData;
          // Resolve the object
          const objectName =
            data.object.type === "Identifier"
              ? (data.object.data as { name: string }).name
              : (() => {
                  JavaScriptLLMConverter.LOGGER.warn(
                    `Unsupported object type in MemberExpression: ${data.object.type}`,
                  );
                  return "unknown";
                })();
          // Attempt to resolve the property dynamically
          const resolvedValue = this._resolveConstantValue(
            objectName,
            data.property as string,
          );
          if (resolvedValue !== undefined) {
            // Map the resolved value to the appropriate SynTest statement type
            if (typeof resolvedValue === "number") {
              return this.sampleNumber(id, typeId, name, resolvedValue);
            } else if (typeof resolvedValue === "string") {
              return this.sampleString(id, typeId, name, resolvedValue);
            } else if (typeof resolvedValue === "boolean") {
              return this.sampleBool(id, typeId, name, resolvedValue);
            } else {
              JavaScriptLLMConverter.LOGGER.warn(
                `Unhandled constant value type: ${typeof resolvedValue}`,
              );
              return undefined;
            }
          }
          return this.sampleGetter(depth + 1, "anon", data);
        }
        case "ObjectExpression": {
          return this.sampleObject(
            depth + 1,
            id,
            typeId,
            name,
            argument.data as ObjectExpressionData,
          );
        }
        case "ArrayExpression": {
          return this.sampleArray(
            depth + 1,
            id,
            typeId,
            name,
            argument.data as IRStatement[],
          );
        }
        case "Identifier": {
          const identifierName = (argument.data as { name: string }).name;
          if (this.statementMap.has(identifierName)) {
            const existing = this.statementMap.get(identifierName);
            // If the provided id or typeId aren’t the placeholders, reconstruct the statement.
            if (id !== "anon" || typeId !== "anon")
              return this._reconstructStatement(existing, id, typeId);
            return existing;
          }
          JavaScriptLLMConverter.LOGGER.warn(
            `Unhandled Identifier: ${identifierName}`,
          );
          return undefined;
        }

        default: {
          JavaScriptLLMConverter.LOGGER.warn(
            `Unhandled argument type: ${argument.type} ${JSON.stringify(argument.data)}`,
          );
          return undefined;
        }
      }
    } catch (error) {
      JavaScriptLLMConverter.LOGGER.error(`Error in _mapArgument: ${error}`);
      return undefined;
    }
    return undefined;
  }

  private _extractMethodName(callee: IRStatement): string {
    try {
      switch (callee.type) {
        case "MemberExpression": {
          const memberData = callee.data as MemberExpressionData;
          if (typeof memberData.property === "string") {
            return memberData.property;
          }
          JavaScriptLLMConverter.LOGGER.warn(
            "Computed property names are not supported.",
          );
          return "unknown";
        }
        case "Identifier": {
          const identifierData = callee.data as { name: string };
          return identifierData.name;
        }
        default: {
          JavaScriptLLMConverter.LOGGER.warn(
            `Unsupported callee type: ${callee.type}`,
          );
          return "unknown";
        }
      }
    } catch (error) {
      JavaScriptLLMConverter.LOGGER.error(
        `Error in _extractMethodName: ${error}`,
      );
      return "unknown";
    }
  }

  private _getClass(id?: string): ClassTarget | undefined {
    if (id) {
      const result = <ClassTarget>(
        (<JavaScriptSubject>this._subject)
          .getActionableTargetsByType(TargetType.CLASS)
          .find((target) => (<ClassTarget>target).id === id)
      );
      if (!result) {
        JavaScriptLLMConverter.LOGGER.error("Missing class with id: " + id);
        return undefined;
      } else if (!isExported(result)) {
        JavaScriptLLMConverter.LOGGER.error(
          "Class with id: " + id + " is not exported",
        );
        return undefined;
      }
      return result;
    }
    JavaScriptLLMConverter.LOGGER.error(
      "No id provided to _getClass; cannot pick one randomly",
    );
    return undefined;
  }

  private _getExport(classId: string | undefined): Export {
    if (!classId) return undefined;
    const filePath = classId.split("::")[0]; // Had to change this TODO windows bug! see how they change it and copy
    const exports = unwrapOr(this.rootContext.getExports(filePath), []);
    const exp = exports.find((export_) => export_.id === classId);
    if (!exp) {
      JavaScriptLLMConverter.LOGGER.warn(
        `Export not found for classId: ${classId}`,
      );
    }
    return exp;
  }

  private _resolveConstantValue(
    objectName: string,
    property: string,
  ): number | string | boolean | undefined {
    const constantMappings: Record<
      string,
      Record<string, number | string | boolean | undefined>
    > = {
      Number: {
        MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
        MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
        MAX_VALUE: Number.MAX_VALUE,
        MIN_VALUE: Number.MIN_VALUE,
      },
      Math: {
        PI: Math.PI,
        E: Math.E,
        LN2: Math.LN2,
      }, // Add other objects and their constants here as needed
    };

    return constantMappings[objectName]?.[property];
  }

  private _reconstructStatement(
    original: Statement,
    newId: string,
    newTypeId: string,
  ): Statement {
    // Reconstruct based on the type of the original statement
    if (original instanceof ConstructorCall) {
      return new ConstructorCall(
        newId,
        newTypeId,
        original.classIdentifier,
        original.name,
        original.uniqueId,
        original.args,
        original.export,
      );
    } else if (original instanceof FunctionCall) {
      return new FunctionCall(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.args,
        original.export,
      );
    } else if (original instanceof MethodCall) {
      return new MethodCall(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.args,
        original.constructor_,
      );
    } else if (original instanceof Getter) {
      return new Getter(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.constructor_,
      );
    } else if (original instanceof Setter) {
      return new Setter(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.args[0],
        original.constructor_,
      );
    } else if (original instanceof ArrayStatement) {
      return new ArrayStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.children,
      );
    } else if (original instanceof ObjectStatement) {
      return new ObjectStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.object,
      );
    } else if (original instanceof StringStatement) {
      return new StringStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.value,
      );
    } else if (original instanceof BoolStatement) {
      return new BoolStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.value,
      );
    } else if (original instanceof NumericStatement) {
      return new NumericStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.value,
      );
    } else if (original instanceof IntegerStatement) {
      return new IntegerStatement(
        newId,
        newTypeId,
        original.name,
        original.uniqueId,
        original.value,
      );
    } else if (original instanceof UndefinedStatement) {
      return new UndefinedStatement(
        newId,
        newTypeId,
        original.name,
        prng.uniqueId(),
      );
    } else if (original instanceof NullStatement) {
      return new NullStatement(
        newId,
        newTypeId,
        original.name,
        prng.uniqueId(),
      );
    }
    // Fallback: if no special handling is needed, return the original.
    return original;
  }
}
