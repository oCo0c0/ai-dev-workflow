import fs from 'fs';
import path from 'path';
import os from 'os';

export interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  filePath: string;
}

export interface SkillDetail extends Skill {
  content: string;
}

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');

export class SkillsService {
  private commandsDir: string;
  private skillsDir: string;

  constructor(commandsDir?: string, skillsDir?: string) {
    this.commandsDir = commandsDir ?? COMMANDS_DIR;
    this.skillsDir = skillsDir ?? SKILLS_DIR;
  }

  /**
   * Ensures the commands directory exists.
   */
  private ensureCommandsDir(): void {
    if (!fs.existsSync(this.commandsDir)) {
      fs.mkdirSync(this.commandsDir, { recursive: true });
    }
  }

  /**
   * Extract a description from the skill file content.
   * Uses the first non-empty line as description, or empty string if none.
   */
  private extractDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip markdown headers for description, use first content line
      if (trimmed && !trimmed.startsWith('#')) {
        // Truncate long descriptions
        return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
      }
      // Use header text as description if it's the first meaningful line
      if (trimmed.startsWith('#')) {
        const headerText = trimmed.replace(/^#+\s*/, '');
        return headerText.length > 100 ? headerText.substring(0, 100) + '...' : headerText;
      }
    }
    return '';
  }

  /**
   * Derive a skill name from the filename (without .md extension).
   */
  private fileNameToSkillName(filename: string): string {
    return filename.replace(/\.md$/, '');
  }

  /**
   * List all skills from both commands/ and skills/ directories.
   */
  list(): Skill[] {
    const skills: Skill[] = [];

    // Scan commands/ directory (.md files)
    if (fs.existsSync(this.commandsDir)) {
      try {
        const entries = fs.readdirSync(this.commandsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = path.join(this.commandsDir, entry.name);
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              skills.push({
                name: this.fileNameToSkillName(entry.name),
                description: this.extractDescription(content),
                enabled: true,
                filePath,
              });
            } catch {
              // Skip files we can't read
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    // Scan skills/ directory (subdirectories with .md files inside)
    if (fs.existsSync(this.skillsDir)) {
      try {
        const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillDir = path.join(this.skillsDir, entry.name);
            // Look for .md files inside the skill directory
            const mdFile = this.findSkillMdFile(skillDir);
            if (mdFile) {
              try {
                const content = fs.readFileSync(mdFile, 'utf-8');
                skills.push({
                  name: entry.name,
                  description: this.extractDescription(content),
                  enabled: true,
                  filePath: mdFile,
                });
              } catch {
                // Skip
              }
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            // Also handle .md files directly in skills/
            const filePath = path.join(this.skillsDir, entry.name);
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              skills.push({
                name: this.fileNameToSkillName(entry.name),
                description: this.extractDescription(content),
                enabled: true,
                filePath,
              });
            } catch {
              // Skip
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    return skills;
  }

  /**
   * Find the main .md file inside a skill directory.
   */
  private findSkillMdFile(dirPath: string): string | null {
    try {
      const files = fs.readdirSync(dirPath);
      // Prefer index.md or the first .md file
      const indexMd = files.find(f => f === 'index.md');
      if (indexMd) return path.join(dirPath, indexMd);
      const firstMd = files.find(f => f.endsWith('.md'));
      if (firstMd) return path.join(dirPath, firstMd);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get a skill's full detail including content.
   */
  get(name: string): SkillDetail | undefined {
    const filePath = path.join(this.commandsDir, `${name}.md`);

    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        name,
        description: this.extractDescription(content),
        enabled: true,
        filePath,
        content,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Create a new skill.
   * Validates that content is non-empty.
   */
  create(name: string, content: string): SkillDetail {
    if (!name || name.trim() === '') {
      throw new Error('Skill name is required');
    }

    if (!content || content.trim() === '') {
      throw new Error('Skill content cannot be empty');
    }

    // Sanitize name: only allow alphanumeric, hyphens, underscores
    const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    const filePath = path.join(this.commandsDir, `${sanitizedName}.md`);

    if (fs.existsSync(filePath)) {
      throw new Error(`Skill "${sanitizedName}" already exists`);
    }

    this.ensureCommandsDir();
    fs.writeFileSync(filePath, content, 'utf-8');

    return {
      name: sanitizedName,
      description: this.extractDescription(content),
      enabled: true,
      filePath,
      content,
    };
  }

  /**
   * Update an existing skill's content.
   * Validates that content is non-empty.
   */
  update(name: string, content: string): SkillDetail {
    if (!content || content.trim() === '') {
      throw new Error('Skill content cannot be empty');
    }

    const filePath = path.join(this.commandsDir, `${name}.md`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Skill "${name}" not found`);
    }

    fs.writeFileSync(filePath, content, 'utf-8');

    return {
      name,
      description: this.extractDescription(content),
      enabled: true,
      filePath,
      content,
    };
  }

  /**
   * Delete a skill.
   */
  delete(name: string): boolean {
    const filePath = path.join(this.commandsDir, `${name}.md`);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }

}
