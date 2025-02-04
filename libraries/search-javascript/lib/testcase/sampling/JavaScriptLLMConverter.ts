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
import { getLogger, Logger } from "@syntest/logging";
import { prng } from "@syntest/prng";
import { IRStatement } from "llmparser/src/models/IRStatement";
import {
  AssignmentExpressionData,
  CallExpressionData,
  ConstructorCallData,
  MemberExpressionData,
  ObjectExpressionData,
  VariableDeclarationData,
} from "llmparser/src/models/IRStatementTypes";
import { TestSuite } from "llmparser/src/models/TestSuite";

import { JavaScriptSubject } from "../../search/JavaScriptSubject";
import { JavaScriptTestCase } from "../JavaScriptTestCase";
import { ActionStatement } from "../statements/action/ActionStatement";
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

import { JavaScriptTestCaseSampler } from "./JavaScriptTestCaseSampler";

export class JavaScriptLLMConverter extends JavaScriptTestCaseSampler {
  protected static LOGGER: Logger;
  private irTestSuite: TestSuite;
  private statementMap: Map<string, Statement>;

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
  }

  convertIRToSynTest(irTestSuite: TestSuite): JavaScriptTestCase[] {
    const testCases: JavaScriptTestCase[] = [];

    for (const describeBlock of irTestSuite.describeBlocks) {
      for (const testCase of describeBlock.testCases) {
        const statements = this._processIRStatements(0, testCase.statements);
        // Filter out any undefined statements that were discarded
        const filteredStatements = statements.filter((s) => s !== undefined);
        testCases.push(new JavaScriptTestCase(filteredStatements));
      }
    }
    return testCases;
  }

  sample(): JavaScriptTestCase {
    const tests = this.convertIRToSynTest(this.irTestSuite);
    return prng.pickOne(tests);
  }

  sampleRoot(): ActionStatement {
    JavaScriptLLMConverter.LOGGER.error("sampleRoot not implemented");
    return undefined;
  }

  override sampleFunctionCall(
    depth: number,
    data?: CallExpressionData,
  ): FunctionCall {
    if (!data) {
      JavaScriptLLMConverter.LOGGER.warn(
        "CallExpression data is required for FunctionCall.",
      );
      return undefined;
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
      JavaScriptLLMConverter.LOGGER.warn(
        `Function target not found for: ${functionName}`,
      );
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
      arguments_[index] = this._mapArgument(
        depth + 1,
        argument,
        parameterId,
        parameterId,
        name,
      );
    }
    const export_ = this._getExport(functionTarget.id);
    // Construct and return a FunctionCall
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
      return this.statementMap.get(name) as ConstructorCall;
    }
    // Case 1: Construct from IR data
    if (data) {
      const class_ = <ClassTarget>(
        (<JavaScriptSubject>this._subject)
          .getActionableTargetsByType(TargetType.CLASS)
          .find((t) => (t as ClassTarget).name === data.callee)
      );
      if (!class_) {
        JavaScriptLLMConverter.LOGGER.warn(
          `Class target not found for: ${JSON.stringify(data.callee)}`,
        );
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
          `Constructor not found for class: ${class_.id}`,
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
        arguments_[index] = this._mapArgument(
          depth + 1,
          argument,
          parameterId,
          parameterId,
          name,
        );
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

    JavaScriptLLMConverter.LOGGER.warn(
      "Either data or classId must be provided for sampleConstructorCall.",
    );
    return undefined;
  }

  sampleClassAction(depth: number): MethodCall | Getter | Setter {
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleClassAction not implemented: " + depth,
    );
    return undefined;
  }

  override sampleMethodCall(
    depth: number,
    data?: CallExpressionData,
  ): MethodCall {
    if (!data) {
      JavaScriptLLMConverter.LOGGER.warn(
        "CallExpression data is required for MethodCall.",
      );
      return undefined;
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
      JavaScriptLLMConverter.LOGGER.warn(
        `Method '${methodName}' not found in actionable targets!`,
      );
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
      arguments_[index] = this._mapArgument(
        depth + 1,
        argument,
        parameterId,
        parameterId,
        name,
      );
    }

    const class_ = this._getClass(methodTarget.classId);

    // Extract the object name from the callee to check the constructor map
    const calleeData = data.callee.data as MemberExpressionData;
    const objectName =
      data.callee.type === "MemberExpression" &&
      calleeData.object.type === "Identifier"
        ? (
            calleeData.object.data as {
              name: string;
            }
          ).name
        : (() => {
            JavaScriptLLMConverter.LOGGER.warn(
              "Callee object is not an Identifier",
            );
            return "unknown";
          })();
    let constructorCall = this.statementMap.get(objectName) as ConstructorCall;
    if (!constructorCall) {
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
    const propertyName = data.property as string;
    console.log(propertyName);
    // console.log(propertyName)
    const property = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.PROPERTY)
      .find(
        (propertyTarget) =>
          (propertyTarget as PropertyTarget).name === propertyName,
      );
    if (!property) {
      JavaScriptLLMConverter.LOGGER.warn(
        `Property not in list: ${propertyName}`,
      );
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
        `Constructor call not found for class: ${constructorName}`,
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
      JavaScriptLLMConverter.LOGGER.warn(
        "Setter missing left getter or right statement",
      );
      return undefined;
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
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleConstantObject not implemented: " + depth + objectId,
    );
    return undefined;
  }

  sampleObjectFunctionCall(depth: number): ObjectFunctionCall {
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleObjectFunctionCall not implemented: " + depth,
    );
    return undefined;
  }

  sampleArrayArgument(depth: number, arrayId: string): Statement {
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleArrayArgument not implemented: " + depth + arrayId,
    );
    return undefined;
  }

  sampleObjectArgument(
    depth: number,
    objectId: string,
    property?: string,
  ): Statement {
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleObjectArgument not implemented: " + depth + objectId + property,
    );
    return undefined;
  }

  sampleArgument(depth: number, id: string, name: string): Statement {
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleArgument not implemented: " + depth + id + name,
    );
    return undefined;
  }

  sampleObject(
    depth: number,
    id: string,
    typeId: string,
    name: string,
    data?: ObjectExpressionData,
  ): ObjectStatement {
    const object_: { [key: string]: Statement } = {};
    for (const [key, value] of Object.entries(data.properties)) {
      // Map each property to a corresponding SynTest statement
      const mapped = this._mapArgument(depth + 1, value, key);
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
    const elements: Statement[] = (data || [])
      .map((statement) =>
        this._mapArgument(depth + 1, statement, "id", "typeid", "arrayElement"),
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
    JavaScriptLLMConverter.LOGGER.warn(
      "sampleArrowFunction not implemented: " + depth + id + typeId + name,
    );
    return undefined;
  }

  sampleString(
    id: string,
    typeId: string,
    name: string,
    value?: string,
  ): StringStatement {
    return new StringStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleBool(
    id: string,
    typeId: string,
    name: string,
    value?: boolean,
  ): BoolStatement {
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
    return new NumericStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleInteger(
    id: string,
    typeId: string,
    name: string,
    value?: number,
  ): IntegerStatement {
    return new IntegerStatement(id, typeId, name, prng.uniqueId(), value);
  }

  sampleUndefined(
    id: string,
    typeId: string,
    name: string,
  ): UndefinedStatement {
    return new UndefinedStatement(id, typeId, name, prng.uniqueId());
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
            if (data.callee.type === "MemberExpression") {
              const calleeData = data.callee.data as MemberExpressionData;
              const calleeCallExpression = calleeData.object
                .data as CallExpressionData;

              // Expect case
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
            } else if (data.callee.type === "Identifier") {
              const stmt = this.sampleFunctionCall(depth, data);
              if (stmt) processedStatements.push(stmt);
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
              undefined,
              undefined,
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
                undefined,
                undefined,
                variableName,
              );
              if (!(rightStatement instanceof ActionStatement)) {
                JavaScriptLLMConverter.LOGGER.warn(
                  `AssignmentExpression right-hand side is not an action statement: ${JSON.stringify(rightStatement)}`,
                );
                break;
              }
              processedStatements.push(rightStatement);
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
        // Discard this statement and continue with others.
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
    id = "id",
    typeId = "typeId",
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
          // Check if the identifier refers to an object in the constructor map
          if (this.statementMap.has(identifierName)) {
            // TODO in case const x = "123" const y = z.foo(x), x will have the wrong varID since it is reused
            return this.statementMap.get(identifierName);
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
    const filePath = classId.split(":")[1]; // Had to change this TODO windows bug! see how they change it and copy
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
}
