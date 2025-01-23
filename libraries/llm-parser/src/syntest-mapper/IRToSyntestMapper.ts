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

import { Export } from "@syntest/analysis-javascript";
import {
  BoolStatement,
  ConstructorCall,
  FunctionCall,
  MethodCall,
  NullStatement,
  NumericStatement,
  ObjectStatement,
  Statement,
  StringStatement,
} from "@syntest/search-javascript";

import { IRStatement } from "../models/IRStatement";

type ConstructorCallData = {
  callee: string | IRStatement;
  args: IRStatement[];
};

type CallExpressionData = {
  callee: IRStatement;
  args: IRStatement[];
};

type MemberExpressionData = {
  object: IRStatement;
  property: string | IRStatement;
  computed: boolean;
};

type AssignmentExpressionData = {
  operator: string; // e.g. '=', '+=', '-=', etc.
  left: IRStatement; // e.g., 'cart'
  right: IRStatement; // e.g., new IRStatement("Numeric", 42)
};

const DEFAULT_EXPORT: Export = {
  id: "default-id",
  filePath: "default-file-path",
  name: "default-name",
  renamedTo: "default-name",
  default: false,
  module: false,
};

/**
 * Maps IRStatement objects to Syntest-compatible Statement objects.
 */
export class IRToSyntestMapper {
  /**
   * Main entry point: map a single IRStatement to a Syntest Statement.
   */
  static mapStatement(
    irStatement: IRStatement,
    variableIdentifier?: string,
  ): Statement | undefined {
    switch (irStatement.type) {
      case "Numeric": {
        return new NumericStatement(
          variableIdentifier || "varId", // Assign the variable name if provided
          "Numeric",
          "name",
          "uid",
          irStatement.data as number,
        );
      }

      case "String": {
        return new StringStatement(
          variableIdentifier || "varId",
          "String",
          "name",
          "uid",
          irStatement.data as string,
        );
      }

      case "Boolean": {
        return new BoolStatement(
          variableIdentifier || "varId",
          "Boolean",
          "name",
          "uid",
          irStatement.data as boolean,
        );
      }

      case "Null": {
        return new NullStatement(
          variableIdentifier || "varId",
          "Null",
          "name",
          "uid",
        );
      }

      case "ConstructorCall": {
        return this.mapConstructorCall(
          irStatement.data as {
            callee: string | IRStatement;
            args: IRStatement[];
          },
        );
      }

      case "CallExpression": {
        return this.mapCallExpression(
          irStatement.data as { callee: IRStatement; args: IRStatement[] },
        );
      }

      case "MemberExpression": {
        return this.mapMemberExpression(
          irStatement.data as {
            object: IRStatement;
            property: string | IRStatement;
            computed: boolean;
          },
        );
      }

      case "AssignmentExpression": {
        return this.mapAssignmentExpression(
          irStatement.data as {
            operator: string;
            left: IRStatement;
            right: IRStatement;
          },
        );
      }

      case "VariableDeclaration": {
        return this.mapVariableDeclaration(
          irStatement.data as {
            name: string;
            kind: string;
            init: IRStatement | null;
          },
        );
      }

      default: {
        console.warn(`Unhandled IR type: ${irStatement.type}`);
        return undefined;
      }
    }
  }

  private static mapConstructorCall(
    data: ConstructorCallData,
  ): ConstructorCall {
    const { callee, args } = data;

    let classIdentifier;
    if (typeof callee === "string") {
      classIdentifier = callee;
    } else if (callee instanceof IRStatement) {
      const calleeStatement = this.mapStatement(callee);
      if (calleeStatement instanceof Statement) {
        classIdentifier = calleeStatement.variableIdentifier;
      }
    }

    const argumentStatements = args.map((argument) =>
      this.mapStatement(argument),
    );

    return new ConstructorCall(
      "tempVar", //TODO
      "Object",
      classIdentifier,
      "name",
      "uid",
      argumentStatements,
      DEFAULT_EXPORT,
    );
  }

  /**
   * Map a CallExpression IR into either a FunctionCall or MethodCall statement.
   */
  private static mapCallExpression(
    data: CallExpressionData,
  ): Statement | undefined {
    const { callee, args } = data;

    // Map the arguments
    const argumentStatements = (args || [])
      .map((argument: IRStatement | null) =>
        argument ? this.mapStatement(argument) : undefined,
      )
      .filter((stmt) => stmt !== undefined);

    // Distinguish between a function call (identifier) and method call (member expression).
    if (!callee) {
      console.warn("CallExpression missing callee!");
      return undefined;
    }

    // If callee is an IRStatement, check its type
    if (callee instanceof IRStatement) {
      switch (callee.type) {
        case "Identifier": {
          // e.g. `expect(...)`
          // We'll assume callee.data = { name: "expect" }
          return new FunctionCall(
            "varId",
            "FunctionCall",
            "name",
            "uid",
            argumentStatements,
            DEFAULT_EXPORT, // TODO exports
          );
        }

        case "MemberExpression": {
          // e.g. `cart.addItem(...)`
          // We'll assume mapMemberExpression -> an ObjectStatement or similar
          // const value = callee.data as {
          //   object: IRStatement;
          //   property: string | IRStatement;
          //   computed: boolean;
          // };
          // const memberExpr = this.mapMemberExpression(value);
          // If you'd rather map it as a "MethodCall":
          return new MethodCall(
            "varId",
            "MethodCall",
            "name",
            "uid",
            argumentStatements,
            undefined, // TODO Constructor call??
          );
        }

        default: {
          console.warn(`Unsupported callee IR type: ${callee.type}`);
          return undefined;
        }
      }
    } else if (typeof callee === "string") {
      // e.g. direct string callee "someFunction" (rare in your IR)
      return new FunctionCall(
        "varId",
        "FunctionCall",
        "name",
        "uid",
        argumentStatements,
        undefined, // TODO
      );
    } else {
      console.warn("Callee is neither IRStatement nor string.");
      return undefined;
    }
  }

  private static mapMemberExpression(data: MemberExpressionData): Statement {
    const { property } = data;

    // Map the 'object' part of the member expression
    // const objectStatement = this.mapStatement(object);

    // Map the 'property'
    let propertyName = "unknownProperty";
    if (typeof property === "string") {
      propertyName = property;
    } else if (property instanceof IRStatement) {
      const propertyStmt = this.mapStatement(property);
      if (propertyStmt) {
        // If propStmt is an IdentifierStatement or something that can yield a name
        // For now, let's do a naive approach: propStmt.toString() or a direct property
        propertyName = propertyStmt.name;
      }
    }

    // For demonstration, we assume we have an `ObjectStatement` class
    // that represents a member expression (object.property).
    return new ObjectStatement(
      "varId",
      "ObjectStatement",
      propertyName,
      "uid",
      undefined, // TODO
    );
  }

  private static mapAssignmentExpression(
    data: AssignmentExpressionData,
  ): Statement | undefined {
    const { left, right } = data;

    // 1) Map the 'left' side, expecting an Identifier or a MemberExpression
    //    that might indicate which 'variable' or 'object property' is being assigned.
    if (left.type === "Identifier") {
      /* empty */
    } else if (left.type === "MemberExpression") {
      // e.g., cart.items = ...
      // Option A: build a string like "cart.items"
      // Option B: leave it as "unknown" or log a warning
    } else {
      console.warn(`Unsupported left-hand side in assignment: ${left.type}`);
      return undefined;
    }

    // 2) Map the 'right' side to a Syntest statement
    const rightStmt = this.mapStatement(right);
    if (!rightStmt) {
      console.warn("Right side of assignment could not be mapped!");
      return undefined;
    }

    // 3) Attach the left side variable name to the 'rightStmt'
    //    if your Syntest statements have something like 'variableIdentifier'
    //    or an equivalent property you can mutate.

    // Optional: if you want to store the operator or do something else, you could:
    //   rightStmt.operator = operator;

    // Return the updated statement
    return rightStmt;
  }

  private static mapVariableDeclaration(data: {
    name: string;
    kind: string;
    init: IRStatement | null;
  }): Statement {
    const { name, init } = data;

    // If there's no initialization, treat the variable as null
    if (!init) {
      return new NullStatement(name, "Null", "name", "uid");
    }

    // Map the initialization value to a Syntest statement, passing the variable name
    return this.mapStatement(init, name);
  }
}
