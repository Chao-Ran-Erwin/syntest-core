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
import { IRStatement } from "./IRStatement";

export interface ConstructorCallData {
  callee: string | IRStatement; // The constructor being called
  args: (IRStatement | undefined)[]; // Arguments passed to the constructor
}

export interface CallExpressionData {
  callee: IRStatement; // The function or method being called
  args: (IRStatement | undefined)[]; // Arguments passed to the function or method
}

export interface MemberExpressionData {
  object: IRStatement; // The object on which the property is accessed
  property: string | IRStatement; // The property being accessed
  computed: boolean; // Whether the property access is computed
}

export interface AssignmentExpressionData {
  operator: string; // Assignment operator
  left: IRStatement; // Left-hand side of the assignment
  right: IRStatement; // Right-hand side of the assignment
}

export interface VariableDeclarationData {
  name: string; // Variable name
  kind: "var" | "let" | "const" | "using" | "await using"; // Declaration type
  init?: IRStatement; // Initialization expression
}
