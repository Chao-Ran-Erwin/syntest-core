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
  private extractOutputTags(fullText: string): string {
    const match = fullText.match(/\[OUTPUT](.*?)\[\/OUTPUT]/s);
    if (match && match[1]) {
      return match[1].trim();
    }
    return fullText.trim(); // fallback if no tags found
  }

  public async generateTest(
    filePath: string,
    subject: JavaScriptSubject,
  ): Promise<string> {
    const model = "gpt-3.5-turbo";
    // 1) Get the className from the file path for storing in JSON
    const className = path.basename(filePath, path.extname(filePath));

    // 2) Gather code & targets
    const classCode: string = fs.readFileSync(filePath, "utf8");
    const targets = this.parseTargets(subject.getActionableTargets());

    // ─────────────────────────────────────────────────────────
    // STEP A) self_refine_initial
    // ─────────────────────────────────────────────────────────
    const promptA = this.constructPrompt("self_refine_initial", {
      class_code: classCode,
      targets,
    });
    const responseA = await this.openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: "You are a JavaScript testing expert." },
        { role: "user", content: promptA },
      ],
    });
    console.log(promptA);
    const initialText = responseA.choices?.[0]?.message?.content ?? "";
    const initialTestSuite = this.extractOutputTags(initialText);

    // Save step A result
    this.saveStepResult("self_refine_initial", className, initialTestSuite);

    // ─────────────────────────────────────────────────────────
    // STEP B) self_refine_reflection
    // ─────────────────────────────────────────────────────────
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
    console.log(promptB);
    const reflectionText = responseB.choices?.[0]?.message?.content ?? "";
    const reflectionOutput = this.extractOutputTags(reflectionText);

    // Save step B result
    this.saveStepResult("self_refine_reflection", className, reflectionOutput);

    // ─────────────────────────────────────────────────────────
    // STEP C) self_refine_refinement
    // ─────────────────────────────────────────────────────────
    const promptC = this.constructPrompt("self_refine_refinement", {
      self_refine_initial: initialTestSuite,
      self_refine_reflection: reflectionOutput,
      targets,
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
    const refinedTestSuite = this.extractOutputTags(refinementText);
    console.log(promptC);
    // Save step C result
    this.saveStepResult("self_refine_refinement", className, refinedTestSuite);

    // Return the final, refined suite
    return refinedTestSuite;
  }

  /**
   * Gather NamedSubTarget info as text
   */
  private parseTargets(targets: SubTarget[]): string {
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const target of targets) {
      if (this.isNamedSubTarget(target)) {
        // Skip anonymous entries
        if (target.name === "anonymous") {
          continue;
        }

        // Construct the line for this target
        const line = `Name: ${target.name}, Type: ${target.type}`;

        // Check if we've already seen an identical line
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
        }
      }
    }

    // Join everything with newlines
    return lines.join("\n");
  }

  private isNamedSubTarget(target: SubTarget): target is NamedSubTarget {
    return (
      typeof (target as NamedSubTarget).name === "string" &&
      typeof (target as NamedSubTarget).typeId === "string"
    );
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

  private saveStepResult(
    stepName: string,
    className: string,
    responseText: string,
  ): void {
    const outputDirectory = "./self_refine_with_targets/10";

    // Ensure the directory exists
    if (!fs.existsSync(outputDirectory)) {
      fs.mkdirSync(outputDirectory, { recursive: true });
    }

    // The file we’re appending/writing to, e.g. self_refine_initial.json
    const outFile = path.join(outputDirectory, `${stepName}.json`);

    // If that file already exists, read it into an object; otherwise start fresh
    let data: Record<string, string> = {};
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, "utf8");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data = JSON.parse(raw);
    }

    // Set or overwrite the response for this class
    data[className] = responseText;

    // Write it back to disk
    fs.writeFileSync(outFile, JSON.stringify(data, undefined, 2), "utf8");
  }
}
