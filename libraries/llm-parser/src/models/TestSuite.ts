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
import { DescribeBlock } from "./DescribeBlock";

export class TestSuite {
  constructor(public describeBlocks: DescribeBlock[]) {}

  public merge(other: TestSuite): void {
    for (const sourceBlock of other.describeBlocks) {
      // Check if there's an existing block with the same name
      const existingBlock = this.describeBlocks.find(
        (block) => block.name === sourceBlock.name,
      );
      if (existingBlock) {
        // Merge test cases
        existingBlock.testCases.push(...sourceBlock.testCases);
        // Merge beforeEach bodies
        existingBlock.beforeEachBodies.push(...sourceBlock.beforeEachBodies);
      } else {
        // If no block has the same name, just add this block as a new one
        this.describeBlocks.push(sourceBlock);
      }
    }
  }

  countAllTestCases(): number {
    const seen = new Set<string>();

    for (const block of this.describeBlocks) {
      for (const testCase of block.testCases) {
        const uniqueKey = `${testCase.name}:::${testCase.statements.length}`;
        seen.add(uniqueKey);
      }
    }
    return seen.size;
  }
}
