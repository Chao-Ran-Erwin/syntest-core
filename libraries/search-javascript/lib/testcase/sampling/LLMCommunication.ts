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

    const promptsPath =
      "C:\\Users\\erwin\\PycharmProjects\\syntest-project\\syntest-framework\\libraries\\search-javascript\\lib\\testcase\\sampling\\prompts.json";
    this.prompts = this.loadPromptsFile(promptsPath);
  }

  /**
   * Load prompts.json
   */
  private loadPromptsFile(filePath: string): Record<string, string> {
    const raw = fs.readFileSync(filePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(raw);
  }

  /**
   * Replace placeholders (e.g. {class_code}) in the prompt
   */
  private constructPrompt(
    key: string,
    placeholders: Record<string, string>,
  ): string {
    let template = this.prompts[key];
    if (!template) {
      throw new Error(`No prompt found for key: ${key}`);
    }
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

    // Extract text inside [OUTPUT] tags if they exist (fallback to cleaned text otherwise)
    const match = cleanedTestCode.match(/\[OUTPUT](.*?)\[\/OUTPUT]/s);
    if (match && match[1]) {
      return match[1].trim();
    }

    return cleanedTestCode.trim(); // Fallback if no tags found
  }

  public async generateTest(filePath: string): Promise<string> {
    const model = "gpt-4o-mini";
    // 2) Gather code & targets
    const classCode: string = fs.readFileSync(filePath, "utf8");

    const promptA = this.constructPrompt("self_refine_initial", {
      class_code: classCode,
    });
    const responseA = await this.openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: "You are a JavaScript testing expert." },
        { role: "user", content: promptA },
      ],
    });

    const initialText = responseA.choices?.[0]?.message?.content ?? "";
    const initialTestSuite = this.cleanCode(initialText);

    const promptB = this.constructPrompt("self_refine_reflection", {
      self_refine_initial: initialTestSuite,
    });
    const responseB = await this.openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a JavaScript testing expert reflecting on the suite.",
        },
        { role: "user", content: promptB },
      ],
    });

    const reflectionText = responseB.choices?.[0]?.message?.content ?? "";
    const reflectionOutput = this.cleanCode(reflectionText);

    const promptC = this.constructPrompt("self_refine_refinement", {
      self_refine_initial: initialTestSuite,
      self_refine_reflection: reflectionOutput,
    });
    const responseC = await this.openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "Refine the test suite based on reflection.",
        },
        { role: "user", content: promptC },
      ],
    });

    const refinementText = responseC.choices?.[0]?.message?.content ?? "";

    return this.cleanCode(refinementText);
  }

  /**
   * Load existing test suite from a folder
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
