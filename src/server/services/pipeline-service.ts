import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface RequirementSourceConfig {
  type: 'ones' | 'jira' | 'gitlab' | 'manual';
  mcpServerName?: string;
}

export interface WorkspaceStepConfig {
  boundPath?: string;
}

export interface SkillSetConfig {
  mode: 'all' | 'selected';
  selectedSkills: string[];
}

export interface MCPToolSetConfig {
  mode: 'all' | 'selected';
  selectedServers: string[];
}

export interface TestStrategyConfig {
  mode: 'ai_generate' | 'run_existing';  // AI writes tests vs run existing tests
  framework?: string;   // Only for run_existing mode
  command?: string;     // Only for run_existing mode
  autoRunAfterExecution: boolean;
}

export interface PipelineStepConfig {
  requirementSource: RequirementSourceConfig;
  workspace: WorkspaceStepConfig;
  // Per-phase skill configuration (preferred)
  planSkills?: SkillSetConfig;       // Skills used during plan generation
  executionSkills?: SkillSetConfig;  // Skills used during code execution
  testSkills?: SkillSetConfig;       // Skills used during testing
  // Legacy single skillSet (kept for backward compatibility)
  skillSet?: SkillSetConfig;
  mcpToolSet: MCPToolSetConfig;
  testStrategy: TestStrategyConfig;
}

export interface WorkflowPipeline {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  steps: PipelineStepConfig;
}

export interface PipelineValidationError {
  field: string;
  message: string;
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: PipelineValidationError[];
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const PIPELINES_FILE = path.join(CONFIG_DIR, 'pipelines.json');

export class PipelineService {
  private configDir: string;
  private pipelinesFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? CONFIG_DIR;
    this.pipelinesFile = path.join(this.configDir, 'pipelines.json');
  }

  /**
   * Ensures the config directory exists.
   */
  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * Load all pipelines from disk.
   */
  private loadPipelines(): WorkflowPipeline[] {
    if (!fs.existsSync(this.pipelinesFile)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.pipelinesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as WorkflowPipeline[];
    } catch {
      return [];
    }
  }

  /**
   * Save all pipelines to disk.
   */
  private savePipelines(pipelines: WorkflowPipeline[]): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.pipelinesFile, JSON.stringify(pipelines, null, 2), 'utf-8');
  }

  /**
   * List all pipelines.
   */
  list(): WorkflowPipeline[] {
    return this.loadPipelines();
  }

  /**
   * Get a pipeline by ID.
   */
  get(id: string): WorkflowPipeline | undefined {
    const pipelines = this.loadPipelines();
    return pipelines.find(p => p.id === id);
  }

  /**
   * Create a new pipeline.
   */
  create(input: Omit<WorkflowPipeline, 'id' | 'createdAt' | 'updatedAt'>): WorkflowPipeline {
    const pipelines = this.loadPipelines();
    const now = new Date().toISOString();

    const pipeline: WorkflowPipeline = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      isDefault: input.isDefault,
      createdAt: now,
      updatedAt: now,
      steps: input.steps,
    };

    // If this pipeline is set as default, unset others
    if (pipeline.isDefault) {
      for (const p of pipelines) {
        p.isDefault = false;
      }
    }

    pipelines.push(pipeline);
    this.savePipelines(pipelines);
    return pipeline;
  }

  /**
   * Update an existing pipeline.
   */
  update(id: string, input: Partial<Omit<WorkflowPipeline, 'id' | 'createdAt'>>): WorkflowPipeline {
    const pipelines = this.loadPipelines();
    const index = pipelines.findIndex(p => p.id === id);

    if (index === -1) {
      throw new Error(`Pipeline not found: ${id}`);
    }

    const existing = pipelines[index];

    // If setting this as default, unset others
    if (input.isDefault) {
      for (const p of pipelines) {
        p.isDefault = false;
      }
    }

    const updated: WorkflowPipeline = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    pipelines[index] = updated;
    this.savePipelines(pipelines);
    return updated;
  }

  /**
   * Delete a pipeline by ID.
   */
  delete(id: string): boolean {
    const pipelines = this.loadPipelines();
    const index = pipelines.findIndex(p => p.id === id);

    if (index === -1) {
      return false;
    }

    pipelines.splice(index, 1);
    this.savePipelines(pipelines);
    return true;
  }

  /**
   * Set a pipeline as the default. Unsets all others.
   */
  setDefault(id: string): void {
    const pipelines = this.loadPipelines();
    const target = pipelines.find(p => p.id === id);

    if (!target) {
      throw new Error(`Pipeline not found: ${id}`);
    }

    for (const p of pipelines) {
      p.isDefault = p.id === id;
    }

    this.savePipelines(pipelines);
  }

  /**
   * Validate a pipeline configuration.
   * Checks that referenced MCP Servers exist in the provided list of available servers.
   */
  validate(pipeline: WorkflowPipeline, availableMCPServers: string[]): PipelineValidationResult {
    const errors: PipelineValidationError[] = [];

    if (!pipeline.name || pipeline.name.trim() === '') {
      errors.push({ field: 'name', message: 'Pipeline name is required' });
    }

    if (!pipeline.steps) {
      errors.push({ field: 'steps', message: 'Pipeline steps configuration is required' });
      return { valid: false, errors };
    }

    // Validate requirement source MCP server reference
    const reqSource = pipeline.steps.requirementSource;
    if (reqSource && reqSource.type !== 'manual' && reqSource.mcpServerName) {
      if (!availableMCPServers.includes(reqSource.mcpServerName)) {
        errors.push({
          field: 'steps.requirementSource.mcpServerName',
          message: `Referenced MCP Server "${reqSource.mcpServerName}" does not exist`,
        });
      }
    }

    // Validate MCP tool set server references
    const mcpToolSet = pipeline.steps.mcpToolSet;
    if (mcpToolSet && mcpToolSet.mode === 'selected') {
      for (const serverName of mcpToolSet.selectedServers) {
        if (!availableMCPServers.includes(serverName)) {
          errors.push({
            field: 'steps.mcpToolSet.selectedServers',
            message: `Referenced MCP Server "${serverName}" does not exist`,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
