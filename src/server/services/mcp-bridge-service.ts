import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPConfigService, MCPServerConfig } from './mcp-config-service.js';

// === Data Models ===

export interface Requirement {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  updatedAt: string;
}

export interface RequirementDetail extends Requirement {
  description: string;
  acceptanceCriteria: string[];
  attachments: Attachment[];
  relatedIssues: RelatedIssue[];
}

export interface Attachment {
  name: string;
  url: string;
  type: string;
}

export interface RelatedIssue {
  id: string;
  title: string;
  status: string;
}

export interface ConnectionStatus {
  connected: boolean;
  message: string;
  latency?: number;
}

// === MCP Bridge Service ===

export class MCPBridgeService {
  private mcpConfigService: MCPConfigService;
  private serverName: string;
  private client: Client | null = null;
  private connecting: boolean = false;

  constructor(mcpConfigService: MCPConfigService, serverName?: string) {
    this.mcpConfigService = mcpConfigService;
    this.serverName = serverName ?? 'ones-api';
  }

  /**
   * Ensure we have an active connection to the MCP server.
   * Uses lazy connection — only connects on first use.
   */
  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;

    if (this.connecting) {
      // Wait for existing connection attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.client) return this.client;
      throw new Error('Connection already in progress');
    }

    this.connecting = true;
    try {
      const config = this.getServerConfig();
      if (!config) {
        throw new Error(
          `MCP Server "${this.serverName}" is not configured. Please add it in MCP Management.`
        );
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      });

      const client = new Client(
        { name: 'ai-dev-workbench', version: '0.1.0' },
        { capabilities: {} }
      );

      await client.connect(transport);
      this.client = client;
      return client;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Disconnect from the MCP server and clean up resources.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Check if the configured MCP server is available.
   */
  async checkAvailability(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test connection to the MCP server and return detailed status.
   */
  async testConnection(): Promise<ConnectionStatus> {
    const config = this.getServerConfig();
    if (!config) {
      return {
        connected: false,
        message: `MCP Server "${this.serverName}" is not configured. Please add it in MCP Management.`,
      };
    }

    const startTime = Date.now();
    try {
      const client = await this.ensureConnected();
      const tools = await client.listTools();
      const latency = Date.now() - startTime;

      return {
        connected: true,
        message: `Connected. ${tools.tools.length} tools available.`,
        latency,
      };
    } catch (err) {
      return {
        connected: false,
        message: `Connection failed: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Fetch the list of requirements from the ONES MCP server.
   */
  async fetchRequirements(): Promise<Requirement[]> {
    try {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name: 'search_requirements', arguments: { query: '' } });
      return this.parseRequirementList(result.content);
    } catch (err) {
      throw new Error(
        `Failed to fetch requirements from ONES MCP: ${(err as Error).message}. ` +
        'Please verify the MCP Server connection.'
      );
    }
  }

  /**
   * Fetch detailed information for a specific requirement.
   */
  async fetchRequirementDetail(id: string): Promise<RequirementDetail> {
    try {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name: 'get_requirement', arguments: { id } });
      return this.parseRequirementDetail(result.content);
    } catch (err) {
      throw new Error(
        `Failed to fetch requirement detail for "${id}": ${(err as Error).message}`
      );
    }
  }

  /**
   * Search requirements by keyword.
   */
  async searchRequirements(query: string): Promise<Requirement[]> {
    try {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name: 'search_requirements', arguments: { query } });
      return this.parseRequirementList(result.content);
    } catch (err) {
      throw new Error(
        `Failed to search requirements: ${(err as Error).message}`
      );
    }
  }

  /**
   * Get the configured MCP server name.
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * Set the MCP server name to use.
   */
  setServerName(name: string): void {
    this.serverName = name;
    // Disconnect from current server so next call reconnects to the new one
    this.disconnect().catch(() => {});
  }

  // === Private Methods ===

  private getServerConfig(): MCPServerConfig | undefined {
    return this.mcpConfigService.get(this.serverName);
  }

  /**
   * Extract text content from MCP tool result.
   * MCP tools return content as an array of { type: 'text', text: '...' } items.
   */
  private extractContentText(content: unknown): string | null {
    if (!content || !Array.isArray(content) || content.length === 0) {
      return null;
    }
    const textItem = content.find(
      (item: Record<string, unknown>) => item.type === 'text' && typeof item.text === 'string'
    );
    return textItem ? (textItem as { text: string }).text : null;
  }

  /**
   * Extract JSON data from MCP tool result content.
   * Falls back to raw text if not valid JSON.
   */
  private extractContentJson(content: unknown): unknown {
    const text = this.extractContentText(content);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text; // Return raw text
    }
  }

  /**
   * Parse raw MCP response content into a list of Requirements.
   * Handles both JSON array and Markdown text formats.
   */
  private parseRequirementList(content: unknown): Requirement[] {
    const raw = this.extractContentJson(content);

    // JSON array format
    if (Array.isArray(raw)) {
      return raw.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        status: String(item.status ?? 'unknown'),
        priority: String(item.priority ?? 'medium'),
        assignee: String(item.assignee ?? ''),
        updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
      }));
    }

    // Markdown text format — parse each ### section as a requirement
    if (typeof raw === 'string') {
      return this.parseMarkdownRequirementList(raw);
    }

    return [];
  }

  /**
   * Parse a Markdown-formatted list of requirements.
   * Format: ### [STATUS] ID: #NUMBER Title
   */
  private parseMarkdownRequirementList(text: string): Requirement[] {
    const results: Requirement[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      // Match: ### [STATUS] ID: #NUMBER Title
      const match = line.match(/^###\s+\[([^\]]+)\]\s+(\S+):\s+(.+)$/);
      if (match) {
        const [, status, id, titlePart] = match;
        // titlePart may be "#130770 Title text"
        const titleMatch = titlePart.match(/^#\d+\s+(.+)$/) ?? titlePart.match(/^(.+)$/);
        const title = titleMatch ? titleMatch[1].trim() : titlePart.trim();

        // Extract metadata from following lines
        let priority = 'medium';
        let assignee = '';
        const lineIdx = lines.indexOf(line);
        for (let i = lineIdx + 1; i < Math.min(lineIdx + 6, lines.length); i++) {
          const meta = lines[i];
          if (meta.includes('Priority:')) {
            const m = meta.match(/Priority:\s*(\w+)/i);
            if (m) priority = m[1].toLowerCase();
          }
          if (meta.includes('Assignee:')) {
            const m = meta.match(/Assignee:\s*(.+)/i);
            if (m) assignee = m[1].trim();
          }
          if (lines[i].startsWith('###')) break;
        }

        results.push({
          id,
          title,
          status: status.toLowerCase(),
          priority,
          assignee,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Parse raw MCP response content into a RequirementDetail.
   * Handles both JSON object and Markdown text formats.
   */
  private parseRequirementDetail(content: unknown): RequirementDetail {
    const raw = this.extractContentJson(content);

    // JSON object format
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const data = raw as Record<string, unknown>;
      return {
        id: String(data.id ?? ''),
        title: String(data.title ?? ''),
        status: String(data.status ?? 'unknown'),
        priority: String(data.priority ?? 'medium'),
        assignee: String(data.assignee ?? ''),
        updatedAt: String(data.updatedAt ?? data.updated_at ?? new Date().toISOString()),
        description: String(data.description ?? ''),
        acceptanceCriteria: this.parseStringArray(data.acceptanceCriteria ?? data.acceptance_criteria),
        attachments: this.parseAttachments(data.attachments),
        relatedIssues: this.parseRelatedIssues(data.relatedIssues ?? data.related_issues),
      };
    }

    // Markdown text format
    if (typeof raw === 'string') {
      return this.parseMarkdownRequirementDetail(raw);
    }

    throw new Error('Invalid requirement detail response');
  }

  /**
   * Parse a Markdown-formatted requirement detail.
   * The ones-api MCP returns Markdown text like:
   *   # #130770 Title
   *   - **ID**: RbSvp3zzkJyHJ47Y
   *   - **Status**: open
   *   ...
   *   ---
   *   ## Requirement Detail
   *   actual description content here
   */
  private parseMarkdownRequirementDetail(text: string): RequirementDetail {
    const lines = text.split('\n');

    let id = '';
    let title = '';
    let status = 'unknown';
    let priority = 'medium';
    let assignee = '';
    const acceptanceCriteria: string[] = [];

    // Parse title from first heading
    const titleLine = lines.find(l => l.startsWith('# '));
    if (titleLine) {
      // Remove leading "# " and optional "#NUMBER " prefix
      const cleaned = titleLine.replace(/^#\s+/, '').replace(/^#\d+\s+/, '').trim();
      title = cleaned;
    }

    // Parse metadata from bullet list (- **Key**: Value)
    for (const line of lines) {
      const idMatch = line.match(/\*\*(?:ID|UUID)\*\*:\s*(\S+)/);
      if (idMatch) id = idMatch[1];

      const statusMatch = line.match(/\*\*Status\*\*:\s*(.+)/i);
      if (statusMatch) status = statusMatch[1].trim();

      const priorityMatch = line.match(/\*\*Priority\*\*:\s*(.+)/i);
      if (priorityMatch) priority = priorityMatch[1].trim().toLowerCase();

      const assigneeMatch = line.match(/\*\*Assignee\*\*:\s*(.+)/i);
      if (assigneeMatch) assignee = assigneeMatch[1].trim();
    }

    // Find description: prefer "Requirement Detail" over "Description"
    // because "Description" section may contain nested metadata
    const sectionOrder = ['Requirement Detail', 'Description', '需求详情', '详情', 'Content'];

    let description = '';
    for (const sectionName of sectionOrder) {
      const pattern = new RegExp(`^##\\s+${sectionName}`, 'i');
      const idx = lines.findIndex(l => pattern.test(l));
      if (idx >= 0) {
        const descLines: string[] = [];
        for (let i = idx + 1; i < lines.length; i++) {
          if (lines[i].startsWith('## ')) break;
          descLines.push(lines[i]);
        }
        const candidate = descLines.join('\n').trim();
        // Skip if the content looks like metadata (contains **Key**: Value patterns)
        // and there might be a better section
        const looksLikeMetadata = candidate.includes('**Type**:') || candidate.includes('**UUID**:');
        if (!looksLikeMetadata || sectionName === sectionOrder[sectionOrder.length - 1]) {
          description = candidate;
          break;
        }
        // Keep looking for a better section
      }
    }

    // Fallback: take everything after the last --- separator
    if (!description) {
      const lastSepIdx = lines.lastIndexOf('---');
      if (lastSepIdx >= 0) {
        description = lines.slice(lastSepIdx + 1).join('\n').replace(/^##[^\n]*\n/gm, '').trim();
      }
    }

    // Parse acceptance criteria if present
    const acIdx = lines.findIndex(l => /^##\s+(Acceptance Criteria|验收标准)/i.test(l));
    if (acIdx >= 0) {
      for (let i = acIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) break;
        const acMatch = lines[i].match(/^[-*]\s+(.+)/);
        if (acMatch) acceptanceCriteria.push(acMatch[1].trim());
      }
    }

    return {
      id,
      title,
      status,
      priority,
      assignee,
      updatedAt: new Date().toISOString(),
      description,
      acceptanceCriteria,
      attachments: [],
      relatedIssues: [],
    };
  }

  private parseStringArray(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) {
      return [];
    }
    return raw.map((item) => String(item));
  }

  private parseAttachments(raw: unknown): Attachment[] {
    if (!raw || !Array.isArray(raw)) {
      return [];
    }
    return raw.map((item: Record<string, unknown>) => ({
      name: String(item.name ?? ''),
      url: String(item.url ?? ''),
      type: String(item.type ?? 'file'),
    }));
  }

  private parseRelatedIssues(raw: unknown): RelatedIssue[] {
    if (!raw || !Array.isArray(raw)) {
      return [];
    }
    return raw.map((item: Record<string, unknown>) => ({
      id: String(item.id ?? ''),
      title: String(item.title ?? ''),
      status: String(item.status ?? 'unknown'),
    }));
  }
}
