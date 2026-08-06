/**
 * @module prompts/test
 * @description 测试生成 / 修复 prompt 模板。
 *
 * changedContext 为可选变更文件上下文（可能为空字符串，占位符替换为空即可）。
 */

/** AI 生成测试（本地一体化：写 + 跑 + 修复） */
export const TEST_ANALYZE_PROMPT = `Analyze the code changes in this workspace and write appropriate tests.

## Context
- Workspace: {{workspacePath}}{{changedContext}}
## Instructions
1. Review the changed files listed above (or the overall codebase if no changes detected)
2. Map each changed source file to its corresponding test file using project conventions (e.g., foo.ts → foo.test.ts, Bar.java → BarTest.java)
3. Write appropriate unit and/or integration tests covering the changed functionality
4. Run the tests and report results
5. If tests fail, fix the issues and re-run

Respond in the same language as the project.`;

/** 仅编写测试文件（沙箱三阶段 Phase 1，不运行） */
export const TEST_WRITE_ONLY_PROMPT = `Analyze the code changes in this workspace and write appropriate tests.

## Context
- Workspace: {{workspacePath}}{{changedContext}}
## Instructions
1. Review the changed files listed above (or the overall codebase if no changes detected)
2. Map each changed source file to its corresponding test file using project conventions
3. Write appropriate unit and/or integration tests
4. Save the test files to the project

IMPORTANT: Do NOT run the tests. Only write and save the test files. Tests will be executed in a separate environment.

Respond in the same language as the project.`;

/** 修复沙箱中失败用例（三阶段 Phase 3） */
export const TEST_FIX_PROMPT = `The following tests failed when executed in the sandbox:

{{failureDetails}}

## Context
- Workspace: {{workspacePath}}

## Instructions
1. Analyze the test failures above
2. Fix the test files or source code to resolve the failures
3. Do NOT run the tests - they will be executed separately

Respond in the same language as the project.`;

/** 生成 Playwright E2E 测试（手动入口） */
export const TEST_E2E_PROMPT = `Generate Playwright E2E tests for the recent changes in this project.

## Context
- Workspace: {{workspacePath}}{{changedContext}}
## Instructions
1. Review the changed files listed above (or the overall codebase if no changes detected), focusing on UI/frontend components
2. Use the Playwright MCP browser tools to explore the application UI if needed
3. Generate Playwright test files and save them to the project's e2e/ or tests/e2e/ directory
4. Each test file should import from '@playwright/test', test key user flows affected by the changes, and include appropriate assertions
5. After generating the files, verify they exist on disk

Important: Write the test files to disk using file write tools. Do NOT run the tests - they will be executed separately.

Respond in the same language as the project.`;

/** 执行完成后自动触发：本地一体化（写 + 跑 + 修复，execution 路由用，带 Plan summary 上下文） */
export const TEST_ANALYZE_AUTO_PROMPT = `The execution has been completed. Now analyze the changes made and write appropriate tests.

## Context
- Workspace: {{workspacePath}}
- Plan summary: {{planSummary}}

## Instructions
1. Review the code changes that were just made
2. Write appropriate unit and/or integration tests
3. Run the tests and report results
4. If tests fail, fix the issues and re-run

Respond in the same language as the project.`;

/** 执行完成后自动触发：仅编写测试文件（沙箱三阶段 Phase 1） */
export const TEST_WRITE_ONLY_AUTO_PROMPT = `The execution has been completed. Now analyze the changes made and write appropriate tests.

## Context
- Workspace: {{workspacePath}}
- Plan summary: {{planSummary}}

## Instructions
1. Review the code changes that were just made
2. Write appropriate unit and/or integration tests
3. Save the test files to the project

IMPORTANT: Do NOT run the tests. Only write and save the test files. Tests will be executed in a separate environment.

Respond in the same language as the project.`;

/** 执行完成后自动触发：生成 Playwright E2E 测试 */
export const TEST_E2E_AUTO_PROMPT = `The execution has been completed. Now generate Playwright E2E tests for the UI changes.

## Context
- Workspace: {{workspacePath}}
- Plan summary: {{planSummary}}

## Instructions
1. Review the code changes that were just made, focusing on UI/frontend changes
2. Use the Playwright MCP browser tools to explore the application UI if needed
3. Generate Playwright test files and save them to the project's e2e/ or tests/e2e/ directory
4. Each test file should:
   - Import from '@playwright/test'
   - Test the key user flows affected by the changes
   - Use meaningful test names that describe the scenario
   - Include appropriate assertions
5. After generating the files, verify they exist on disk

Important: Write the test files to disk using file write tools. Do NOT run the tests - they will be executed separately.

Respond in the same language as the project.`;
