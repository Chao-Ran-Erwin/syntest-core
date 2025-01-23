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
} from "@syntest/analysis-javascript";
import { ImplementationError } from "@syntest/diagnostics";
import { prng } from "@syntest/prng";
import { IRStatement } from "llmparser/src/models/IRStatement";
import {
  AssignmentExpressionData,
  CallExpressionData,
  ConstructorCallData,
  MemberExpressionData,
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
  private irTestSuite: TestSuite;
  private constructorMap: Map<string, ConstructorCall>;

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
    this.constructorMap = new Map<string, ConstructorCall>();
  }

  convertIRToSynTest(irTestSuite: TestSuite): JavaScriptTestCase[] {
    const testCases: JavaScriptTestCase[] = [];

    for (const describeBlock of irTestSuite.describeBlocks) {
      for (const testCase of describeBlock.testCases) {
        const statements = this._processIRStatements(0, testCase.statements);
        testCases.push(new JavaScriptTestCase(statements));
      }
    }

    return testCases;
  }

  sample(): JavaScriptTestCase {
    const tests = this.convertIRToSynTest(this.irTestSuite);
    return prng.pickOne(tests);
  }

  sampleRoot(): ActionStatement {
    // const targets = (<JavaScriptSubject>this._subject).getActionableTargets();
    throw new Error("Future");
  }

  override sampleFunctionCall(
    depth: number,
    data?: CallExpressionData,
  ): FunctionCall {
    if (!data)
      throw new Error("CallExpression data is required for FunctionCall.");

    // Extract the function name from the callee
    if (data.callee.type !== "Identifier") {
      throw new Error(
        `Expected Identifier for FunctionCall, but got ${data.callee.type}.`,
      );
    }

    const functionName = (data.callee.data as { name: string }).name;

    const targets = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.FUNCTION)
      .filter((target) => isExported(target));

    const functionTarget = <FunctionTarget>(
      targets.find((t) => (t as FunctionTarget).name === functionName)
    );

    // Map arguments from IR to SynTest-compatible statements
    const arguments_: Statement[] = data.args.map((argument) =>
      this._mapArgument(depth + 1, argument),
    );
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
    // Case 1: Construct from IR data
    if (data) {
      const class_ = <ClassTarget>(
        (<JavaScriptSubject>this._subject)
          .getActionableTargetsByType(TargetType.CLASS)
          .find((t) => (t as ClassTarget).name === data.callee)
      );

      const constructor_ = (<JavaScriptSubject>this._subject)
        .getActionableTargetsByType(TargetType.METHOD)
        .find(
          (method) =>
            (<MethodTarget>method).classId === class_.id &&
            (<MethodTarget>method).methodType === "constructor",
        );

      const constructor: MethodTarget = <MethodTarget>constructor_;
      // Map IR arguments to SynTest-compatible Statements
      const arguments_ = data.args.map((argument) =>
        this._mapArgument(depth + 1, argument),
      );

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

      this.constructorMap.set(name, constructorCall);
      return constructorCall;
    }

    // Case 2: Dynamically find and generate constructor
    if (classId) {
      const class_ = this._getClass(classId);

      // Get the constructor of the class
      const constructors = (<JavaScriptSubject>this._subject)
        .getActionableTargetsByType(TargetType.METHOD)
        .filter(
          (method) =>
            (<MethodTarget>method).classId === class_.id &&
            (<MethodTarget>method).methodType === "constructor",
        );

      if (constructors.length > 1) {
        throw new Error("Multiple constructors found for class.");
      }

      if (constructors.length === 1) {
        const export_ = this._getExport(class_.id);
        return new ConstructorCall(
          constructors[0].id,
          (<MethodTarget>constructors[0]).typeId,
          class_.id,
          class_.name,
          prng.uniqueId(),
          [],
          export_,
        );
      }
    }

    throw new Error(
      "Either data or classId must be provided for sampleConstructorCall.",
    );
  }

  sampleClassAction(depth: number): MethodCall | Getter | Setter {
    throw new Error("Unnecessary." + depth);
  }

  override sampleMethodCall(
    depth: number,
    data?: CallExpressionData,
  ): MethodCall {
    if (!data) throw new Error("CallExpression data is required.");

    // Resolve the method name from the callee
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

    // for (const x of methods) console.log(`methods: ${JSON.stringify(x)}`)
    // Retrieve the method target
    const methodTarget = <MethodTarget>(
      methods.find((t) => (t as MethodTarget).name === methodName)
    );

    if (!methodTarget)
      throw new Error(
        `Method '${methodName}' not found in actionable targets!`,
      );

    // Map arguments from IR to SynTest-compatible statements
    const arguments_: Statement[] = data.args.map((argument) =>
      this._mapArgument(depth + 1, argument),
    );

    const class_ = this._getClass(methodTarget.classId);

    // Extract the object name from the callee to check the constructor map
    const calleeData = data.callee.data as MemberExpressionData;
    const objectName =
      data.callee.type === "MemberExpression" &&
      calleeData.object.type === "Identifier"
        ? (calleeData.object.data as { name: string }).name
        : (() => {
            throw new Error("Callee object is not an Identifier");
          })();
    const mapValue = this.constructorMap.get(objectName);
    const constructor_ =
      mapValue ?? this.sampleConstructorCall(depth + 1, class_.id);
    console.log(constructor_ === mapValue);
    return new MethodCall(
      methodTarget.id,
      methodTarget.typeId,
      methodTarget.name,
      prng.uniqueId(),
      arguments_,
      constructor_,
    );
  }

  sampleGetter(depth: number, name?: string): Getter {
    const targets = (<JavaScriptSubject>this._subject).getActionableTargets();

    const methods = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.METHOD)
      .filter((method) => (<MethodTarget>method).methodType === "get")
      .filter((target) =>
        isExported(
          targets.find(
            (objectTarget) =>
              objectTarget.id === (<MethodTarget>target).classId,
          ),
        ),
      );
    const method = <MethodTarget>(
      methods.find((t) => (t as MethodTarget).name === name)
    );
    const class_ = this._getClass(method.classId);
    const constructor_ = this.sampleConstructorCall(depth + 1, class_.id);
    return new Getter(
      method.id,
      method.id,
      method.name,
      prng.uniqueId(),
      constructor_,
    );
  }

  sampleSetter(depth: number, data?: CallExpressionData): Setter {
    if (!data) throw new Error("CallExpression data is required for Setter.");

    // Extract property name and object from the MemberExpression
    if (data.callee.type !== "MemberExpression") {
      throw new Error(
        `Expected MemberExpression for Setter, but got ${data.callee.type}.`,
      );
    }
    const targets = (<JavaScriptSubject>this._subject).getActionableTargets();

    const calleeData = data.callee.data as MemberExpressionData;
    const objectName = (calleeData.object.data as { name: string }).name;
    const argument = this._mapArgument(depth + 1, data.args[0]);
    const methods = (<JavaScriptSubject>this._subject)
      .getActionableTargetsByType(TargetType.METHOD)
      .filter((method) => (<MethodTarget>method).methodType === "set")
      .filter((target) =>
        isExported(
          targets.find(
            (objectTarget) =>
              objectTarget.id === (<MethodTarget>target).classId,
          ),
        ),
      );

    const method = <MethodTarget>(
      methods.find((t) => (t as MethodTarget).name === objectName)
    );
    const class_ = this._getClass(method.classId);
    const constructor_ = this.sampleConstructorCall(depth + 1, class_.id);

    return new Setter(
      method.id,
      method.typeId,
      method.name,
      prng.uniqueId(),
      argument,
      constructor_,
    );
  }

  sampleConstantObject(depth: number, objectId?: string): ConstantObject {
    throw new Error("Future" + depth + objectId);
  }

  sampleObjectFunctionCall(depth: number): ObjectFunctionCall {
    throw new Error("Future" + depth);
  }

  sampleArrayArgument(depth: number, arrayId: string): Statement {
    throw new Error("Future" + depth + arrayId);
  }

  sampleObjectArgument(
    depth: number,
    objectId: string,
    property?: string,
  ): Statement {
    throw new Error("Unnecessary" + depth + objectId + property);
  }

  sampleArgument(depth: number, id: string, name: string): Statement {
    throw new Error("Unnecessary" + depth + id + name);
  }

  sampleObject(
    depth: number,
    id: string,
    typeId: string,
    name: string,
  ): FunctionCall | ConstructorCall | ConstantObject | ObjectStatement {
    throw new Error("Method not implemented." + depth + id + typeId + name);
  }

  sampleArray(
    depth: number,
    id: string,
    typeId: string,
    name: string,
  ): ArrayStatement {
    throw new Error("Future work" + depth + id + typeId + name);
  }

  sampleArrowFunction(
    depth: number,
    id: string,
    typeId: string,
    name: string,
  ): ArrowFunctionStatement {
    throw new Error("Future work" + depth + id + typeId + name);
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
      switch (irStatement.type) {
        case "ConstructorCall": {
          processedStatements.push(
            this.sampleConstructorCall(
              depth,
              "",
              irStatement.data as ConstructorCallData,
            ),
          );
          break;
        }

        case "CallExpression": {
          const data = irStatement.data as CallExpressionData;
          if (data.callee.type === "MemberExpression") {
            processedStatements.push(this.sampleMethodCall(depth, data));
          } else if (data.callee.type === "Identifier") {
            processedStatements.push(this.sampleFunctionCall(depth, data));
          } else {
            throw new ImplementationError("Invalid CallExpression callee type");
          }
          break;
        }
        case "VariableDeclaration": {
          const data = irStatement.data as VariableDeclarationData;

          if (!data.init) {
            throw new Error(
              `VariableDeclaration '${data.name}' has no initializer.`,
            );
          }

          // Use _mapArgument with the variable name
          const initializer = this._mapArgument(depth, data.init, data.name);
          if (!(initializer instanceof ActionStatement))
            throw new Error(
              `Variabledeclaration not actionstatement ${JSON.stringify(initializer)}`,
            );
          processedStatements.push(initializer);
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
              variableName,
            );
            if (!(rightStatement instanceof ActionStatement))
              throw new Error(
                `Variabledeclaration not actionstatement ${JSON.stringify(rightStatement)}`,
              );
            processedStatements.push(rightStatement);
            // } else if (data.left.type === "MemberExpression") {
            //   // Assignment to a property of an object
            //   const memberExpression = this._mapArgument(depth, data.left) as MemberExpressionStatement;
            //   const rightStatement = this._mapArgument(depth, data.right);
            //
            //   processedStatements.push(
            //     this.samplePropertyAssignment(memberExpression, rightStatement),
            //   );
          } else {
            throw new ImplementationError(
              `Unsupported left type in AssignmentExpression: ${data.left.type}`,
            );
          }
          break;
        }

        default: {
          console.warn(`Unhandled IR statement type: ${irStatement.type}`);
          console.warn(irStatement.data);
        }
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
    name = "anon",
  ): Statement {
    const defaultId = "id";
    const defaultTypeId = "typeId";
    switch (argument.type) {
      case "String": {
        return this.sampleString(
          defaultId,
          defaultTypeId,
          name,
          argument.data as string,
        );
      }
      case "Numeric": {
        return this.sampleNumber(
          defaultId,
          defaultTypeId,
          name,
          argument.data as number,
        );
      }
      case "Boolean": {
        return this.sampleBool(
          defaultId,
          defaultTypeId,
          name,
          argument.data as boolean,
        );
      }
      case "Null": {
        return this.sampleNull(defaultId, defaultTypeId, name);
      }
      case "Undefined": {
        return this.sampleUndefined(defaultId, defaultTypeId, name);
      }
      case "VariableDeclaration": {
        const data = argument.data as VariableDeclarationData;

        if (!data.init) {
          throw new Error(
            `VariableDeclaration '${data.name}' has no initializer.`,
          );
        }

        // Pass the variable name when mapping the initializer
        return this._mapArgument(depth, data.init, data.name);
      }
      case "CallExpression": {
        const callData = argument.data as CallExpressionData;
        if (callData.callee.type === "MemberExpression") {
          return this.sampleMethodCall(depth + 1, callData);
        } else if (callData.callee.type === "Identifier") {
          return this.sampleFunctionCall(depth + 1, callData);
        }
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
                throw new Error(
                  `Unsupported object type in MemberExpression: ${data.object.type}`,
                );
              })();

        // Attempt to resolve the property dynamically
        const resolvedValue = this._resolveConstantValue(
          objectName,
          data.property as string,
        );

        if (resolvedValue !== undefined) {
          // Map the resolved value to the appropriate SynTest statement type
          if (typeof resolvedValue === "number") {
            return this.sampleNumber(
              defaultId,
              defaultTypeId,
              name,
              resolvedValue,
            );
          } else if (typeof resolvedValue === "string") {
            return this.sampleString(
              defaultId,
              defaultTypeId,
              name,
              resolvedValue,
            );
          } else if (typeof resolvedValue === "boolean") {
            return this.sampleBool(
              defaultId,
              defaultTypeId,
              name,
              resolvedValue,
            );
          } else {
            throw new TypeError(
              `Unhandled constant value type: ${typeof resolvedValue}`,
            );
          }
        }

        throw new Error(
          `Unsupported MemberExpression: ${JSON.stringify(data)}`,
        );
      }
      default: {
        throw new Error(
          `Unhandled argument type: ${argument.type} ${JSON.stringify(argument.data)}`,
        );
      }
    }
  }

  private _extractMethodName(callee: IRStatement): string {
    switch (callee.type) {
      case "MemberExpression": {
        const memberData = callee.data as MemberExpressionData;
        if (typeof memberData.property === "string") {
          return memberData.property;
        }
        throw new Error("Computed property names are not supported.");
      }
      case "Identifier": {
        const identifierData = callee.data as { name: string };
        return identifierData.name;
      }
      default: {
        throw new Error(`Unsupported callee type: ${callee.type}`);
      }
    }
  }

  private _getClass(id?: string) {
    if (id) {
      const result = <ClassTarget>(
        (<JavaScriptSubject>this._subject)
          .getActionableTargetsByType(TargetType.CLASS)
          .find((target) => (<ClassTarget>target).id === id)
      );
      if (!result) {
        throw new ImplementationError("missing class with id: " + id);
      } else if (!isExported(result)) {
        throw new ImplementationError(
          "class with id: " + id + "is not exported",
        );
      }
      return result;
    }
    throw new ImplementationError("no id need to pick one randomly");
  }

  // eslint-disable-next-line unused-imports/no-unused-vars
  private _getExport(classId: string | undefined): Export {
    // const filePath = classId.split(":")[0];
    // return unwrapOr(this.rootContext.getExports(filePath), []).find(
    //   (export_) => export_.id === classId,
    // );
    const export_: Export = {
      id: ":2:0:::20:1:::1:489",
      filePath: "./ShoppingCart.js",
      name: "ShoppingCart",
      renamedTo: "ShoppingCart",
      default: true,
      module: true,
    };
    return export_;
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
      },
      // Add other objects and their constants here as needed
    };

    return constantMappings[objectName]?.[property];
  }
}
