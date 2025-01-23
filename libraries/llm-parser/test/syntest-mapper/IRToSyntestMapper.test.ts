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

import { TestSuite } from "../../src/models/TestSuite";
import { IRBuilder } from "../../src/parser/IRBuilder";
import { IRToSyntestMapper } from "../../src/syntest-mapper/IRToSyntestMapper";

describe("IRToSyntestMapper Integration Test", () => {
  it("should correctly map a simple test case from IR to SynTest encoding", () => {
    const testCode = `
        describe('ShoppingCart', () => {
            it('should add items to the cart', () => {
                let cart = new ShoppingCart();
                cart.addItem('Apple', 1.99, 2);
                expect(cart.items.length).toBe(2);
            });
        });
      `;

    // Step 1: Convert LLM test code to IR
    const testSuite: TestSuite = IRBuilder.buildIR(testCode);

    const describeBlock = testSuite.describeBlocks[0];

    const testCase = describeBlock.testCases[0];
    console.log(JSON.stringify(testCase));
    // Step 2: Map IR to SynTest encoding
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    // eslint-disable-next-line unused-imports/no-unused-vars
    const syntestStatements = testCase.statements.map((stmt) =>
      IRToSyntestMapper.mapStatement(stmt),
    );
    // for (const x of syntestStatements) console.log(`Syntest statement: ${JSON.stringify(x)}`)
    // // Assertions on SynTest encoding
    // expect(syntestStatements).toHaveLength(2);
    //
    // // Check the first statement: cart.addItem('Apple', 1.99, 2)
    // const firstStatement = syntestStatements[0];
    // expect(firstStatement).toBeInstanceOf(FunctionCall);
    // expect(firstStatement).toMatchObject({
    //   variableIdentifier: "varId",
    //   typeIdentifier: "FunctionCall",
    //   name: "name",
    //   uniqueId: "uid",
    //   functionName: "cart.addItem",
    //   arguments_: [
    //     new StringStatement("varId", "String", "name", "uid", "Apple"),
    //     new NumericStatement("varId", "Numeric", "name", "uid", 1.99),
    //     new NumericStatement("varId", "Numeric", "name", "uid", 2),
    //   ],
    // });

    // Check the second statement: expect(cart.items.length).toBe(2)
    // eslint-disable-next-line unused-imports/no-unused-vars
  });
});
