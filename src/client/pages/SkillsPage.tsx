import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import {
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Zap,
  Loader2,
  FileCode,
} from 'lucide-react';

interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  filePath: string;
}

interface SkillDetail extends Skill {
  content: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Skill[]>('/skills');
      setSkills(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch skills';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectSkill = async (name: string) => {
    try {
      const detail = await apiGet<SkillDetail>(`/skills/${encodeURIComponent(name)}`);
      setSelected(detail);
      setEditContent(detail.content);
      setEditing(false);
      setCreating(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch skill';
      setError(msg);
    }
  };

  const saveEdit = async () => {
    if (!selected) return;
    try {
      await apiPut(`/skills/${encodeURIComponent(selected.name)}`, {
        ...selected,
        content: editContent,
      });
      setSelected({ ...selected, content: editContent });
      setEditing(false);
      fetchSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save skill';
      setError(msg);
    }
  };

  const createSkill = async () => {
    if (!newName.trim()) return;
    try {
      await apiPost('/skills', {
        name: newName.trim(),
        description: newDescription.trim(),
        content: newContent,
        enabled: true,
      });
      setCreating(false);
      setNewName('');
      setNewDescription('');
      setNewContent('');
      fetchSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create skill';
      setError(msg);
    }
  };

  const deleteSkill = async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      await apiDelete(`/skills/${encodeURIComponent(name)}`);
      if (selected?.name === name) setSelected(null);
      fetchSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete skill';
      setError(msg);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Skills List */}
        <div className="w-64 flex flex-col flex-shrink-0">
          <Button
            onClick={() => { setCreating(true); setSelected(null); }}
            className="w-full mb-3"
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Skill
          </Button>
          <div className="flex-1 overflow-y-auto space-y-1">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && skills.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Zap className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">No skills yet</p>
              </div>
            )}
            {skills.map((skill) => (
              <div
                key={skill.name}
                onClick={() => selectSkill(skill.name)}
                className={cn(
                  'group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors',
                  selected?.name === skill.name
                    ? 'bg-accent border border-primary/30'
                    : 'hover:bg-accent/50 border border-transparent'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{skill.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSkill(skill.name); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {creating && (
            <div className="p-4 flex flex-col h-full">
              <h3 className="text-sm font-medium mb-4">Create New Skill</h3>
              <div className="space-y-3 flex-1 flex flex-col">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Skill name"
                />
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Description"
                />
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Skill content (markdown)"
                  className="flex-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
                <div className="flex gap-2">
                  <Button onClick={createSkill} size="sm">
                    <Save className="h-4 w-4 mr-1" />
                    Create
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {selected && !creating && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                  <h3 className="text-sm font-medium">{selected.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
                </div>
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      <Button size="sm" onClick={saveEdit}>
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditing(false); setEditContent(selected.content); }}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                {editing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full bg-transparent px-4 py-3 text-sm font-mono resize-none focus:outline-none"
                  />
                ) : (
                  <pre className="w-full h-full overflow-y-auto px-4 py-3 text-sm text-muted-foreground font-mono whitespace-pre-wrap">
                    {selected.content}
                  </pre>
                )}
              </div>
            </div>
          )}

          {!selected && !creating && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <FileCode className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select a skill or create a new one</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
