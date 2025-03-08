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

import { OpenAI } from "openai";

export class LLMCommunication {
  private openai: OpenAI;
  private prompts: Record<string, string>;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
    });

    // Store prompts directly in the class instead of loading from file
    this.prompts = {
      self_refine_initial: `[INST] You are an expert JavaScript tester. Your goal is to write test cases that are readable and understandable to other developers while maximizing coverage of the class under test. **Include test cases with multiple method calls where relevant.** These involve sequences of method invocations on the same object, where one method's behavior or state affects others. Use such tests when the class’s methods share state, have side effects, or depend on logical sequencing. Avoid unnecessary complexity: if the methods are independent or do not benefit from sequencing, use standalone tests instead. Place the final test suite between the [OUTPUT] and [/OUTPUT] tags. The class under test is provided between the [CODE] and [/CODE] tags. Do not return any text outside the [OUTPUT] and [/OUTPUT] tags. [/INST]
[CODE]
{class_code}
[/CODE]
[OUTPUT]
[/OUTPUT]`,

      self_refine_reflection: `[INST] Here is a test suite: {self_refine_initial}. Please review the test suite and suggest any improvements or identify any missing edge cases or issues. Provide feedback in terms of readability, coverage, and structure of the tests. **Specifically, check whether the test suite includes tests with multiple method calls where relevant.** These involve sequences of method invocations on the same object, where one method's behavior or state affects others. Place the feedback between the [OUTPUT] and [/OUTPUT] tags. Do not return any text outside the [OUTPUT] and [/OUTPUT] tags. [/INST]
[OUTPUT]
[/OUTPUT]`,

      self_refine_refinement: `[INST] Here is the test suite to be improved: {self_refine_initial}. Based on the following feedback, refine the test suite to include the suggested improvements: {self_refine_reflection}. Ensure that the final test suite is comprehensive, readable, and well-structured, covering all important scenarios for the class under test, **including tests with multiple method calls where relevant**. Place the final test suite between the [OUTPUT] and [/OUTPUT] tags. Do not return any text outside the [OUTPUT] and [/OUTPUT] tags. [/INST]
[OUTPUT]
[/OUTPUT]`,
    };
  }

  /**
   * Replace placeholders (e.g. {class_code}) in the prompt
   */
  private constructPrompt(key: string, placeholders: Record<string, string>): string {
    let template = this.prompts[key];
    if (!template) {
      throw new Error(`No prompt found for key: ${key}`);
    }

    // Replace dynamic placeholders
    for (const [ph, value] of Object.entries(placeholders)) {
      const regex = new RegExp(`\\{${ph}\\}`, "g");
      template = template.replace(regex, value);
    }

    return template;
  }

  /**
   * Extract everything between [OUTPUT] ... [/OUTPUT] tags.
   */
  private cleanCode(fullText: string): string {
    // Remove all [OUTPUT] and [/OUTPUT] tags
    let cleanedTestCode = fullText.replaceAll(/\[\/?OUTPUT]/g, "");

    // Remove code fences if present (``` or ```javascript)
    cleanedTestCode = cleanedTestCode
      .replaceAll(/```(?:javascript)?\n?/g, "") // Remove ``` or ```javascript with optional newline
      .replaceAll(/```\s*/g, ""); // Remove closing ```

    return cleanedTestCode.trim();
  }

  /**
   * Send a message to OpenAI and return the response.
   */
  private async askOpenAI(model: string, systemMessage: string, userMessage: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    });

    return response.choices?.[0]?.message?.content ?? "";
  }

  /**
   * Generate a test suite for a given JavaScript file.
   */
  public async generateTest(filePath: string): Promise<string> {
    const model = "gpt-4o-mini";
    const classCode = fs.readFileSync(filePath, "utf8");

    // 1. Initial test generation
    const promptA = this.constructPrompt("self_refine_initial", { class_code: classCode });
    const initialText = await this.askOpenAI(model, "You are a JavaScript testing expert.", promptA);
    const initialTestSuite = this.cleanCode(initialText);

    // 2. Reflection on test suite
    const promptB = this.constructPrompt("self_refine_reflection", { self_refine_initial: initialTestSuite });
    const reflectionText = await this.askOpenAI(model, "You are a JavaScript testing expert reflecting on the suite.", promptB);
    const reflectionOutput = this.cleanCode(reflectionText);

    // 3. Refinement of test suite
    const promptC = this.constructPrompt("self_refine_refinement", {
      self_refine_initial: initialTestSuite,
      self_refine_reflection: reflectionOutput,
    });
    const refinementText = await this.askOpenAI(model, "Refine the test suite based on reflection.", promptC);

    return this.cleanCode(refinementText);
  }

  /**
   * Load existing test suite from a folder.
   */
  public loadTestSuite(testCaseFolder: string, className: string): string {
    const files = fs.readdirSync(testCaseFolder);
    const testCaseFile = files.find((file) => file.endsWith(`${className}.test.js`));

    if (!testCaseFile) {
      throw new Error(`Test case for ${className} not found`);
    }

    return fs.readFileSync(path.join(testCaseFolder, testCaseFile), "utf8");
  }
}
