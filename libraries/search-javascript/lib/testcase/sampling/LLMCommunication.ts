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

import * as fs from "node:fs";
import * as path from "node:path";

import { NamedSubTarget, SubTarget } from "@syntest/analysis-javascript";
import { OpenAI } from "openai";

import { JavaScriptSubject } from "../../search/JavaScriptSubject";

export class LLMCommunication {
  private openai: OpenAI;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment
    this.openai = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"], // Ensuring apiKey is always a string
    });
  }

  public async generateTest(
    filePath: string,
    subject: JavaScriptSubject,
  ): Promise<string> {
    try {
      const classCode: string = fs.readFileSync(filePath, "utf8");

      const targets = this.parseTargets(subject.getActionableTargets());

      const prompt: string = `

### Class Code:
${classCode}

### Targets:
${targets}

Provide the test cases in a structured format.`;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a JavaScript testing expert. Generate Jest test cases for the given class and targets.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
      const output: string = response.choices?.[0]?.message?.content;

      return output ?? "No response received from ChatGPT.";
    } catch {
      return "Error generating test cases.";
    }
  }

  /**
   * Parses the targets to extract relevant NamedSubTarget information.
   */
  private parseTargets(targets: SubTarget[]): string {
    let info = "";

    for (const target of targets) {
      if (this.isNamedSubTarget(target)) {
        info += `Name: ${target.name}, Type: ${target.type}\n`;
      }
    }

    return info;
  }

  /**
   * Type guard function to check if a target is a NamedSubTarget.
   */
  private isNamedSubTarget(target: SubTarget): target is NamedSubTarget {
    return (
      typeof (target as NamedSubTarget).name === "string" &&
      typeof (target as NamedSubTarget).typeId === "string"
    );
  }

  /**
   * Load existing LLM tests instead of generating new ones.
   * @param testCaseFolder folder containing LLM tests
   * @param className class-under-test
   */
  public loadTestSuite(testCaseFolder: string, className: string): string {
    const files = fs.readdirSync(testCaseFolder);
    const testCaseFile = files.find((file) =>
      file.endsWith(`${className}.test.js`),
    );
    if (!testCaseFile) {
      throw new Error(`Test case for ${className} not found`);
    }
    return fs.readFileSync(path.join(testCaseFolder, testCaseFile), "utf8");
  }
}
