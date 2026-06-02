import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SKILL_CATALOG, UNCATEGORIZED_DEFAULTS } from '@/lib/skill-catalog';

/**
 * Server-side local skill discovery — only useful in dev (`npm run dev`),
 * because Vercel functions don't have access to the user's home directory.
 *
 * On Vercel we 404 immediately so the client can fall back to the File
 * System Access API flow (see lib/local-skills-fs.ts).
 */

/** Pretty-print an absolute path with `~` for the user's home directory. */
function prettyHome(absPath: string, home: string): string {
  if (home && absPath.startsWith(home)) {
    return '~' + absPath.slice(home.length);
  }
  return absPath;
}

/** Build the full list of candidate skill directories on this machine. */
function getSkillDirs(): string[] {
  const home = process.env.HOME || '/Users/tonyye';
  const dirs: string[] = [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.openclaw', 'skills'),
    path.join(home, '.aider', 'skills'),
  ];

  // Plus any per-agent skill dirs under ~/.openagents/agents/*/skills
  const agentsRoot = path.join(home, '.openagents', 'agents');
  try {
    if (fs.existsSync(agentsRoot)) {
      for (const agentDir of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
        if (agentDir.isDirectory()) {
          const skillsPath = path.join(agentsRoot, agentDir.name, 'skills');
          if (fs.existsSync(skillsPath)) dirs.push(skillsPath);
        }
      }
    }
  } catch {
    // ignore — best-effort discovery
  }

  return dirs;
}

function formatName(slug: string): string {
  return slug
    .replace(/\.md$/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function GET() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'not available in serverless env', useFsAccessApi: true },
      { status: 404 },
    );
  }

  try {
    const home = process.env.HOME || '/Users/tonyye';
    const dirs = getSkillDirs();
    const seen = new Set<string>();
    const skills: Array<{
      slug: string;
      name: string;
      description: string;
      category: string;
      categoryIcon: string;
      exists: boolean;
      sourceDir: string;
    }> = [];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        // Skip hidden entries (.system, .git, .DS_Store) — they pollute the list
        // and break the dropdown UX even if we technically can read them.
        if (entry.name.startsWith('.')) continue;

        const slug = entry.name.replace(/\.md$/, '');
        // Dedupe by slug — first-seen wins.
        if (seen.has(slug)) continue;
        seen.add(slug);

        const catalogEntry = SKILL_CATALOG[slug] || UNCATEGORIZED_DEFAULTS;

        // Try to read SKILL.md for description if not in catalog
        let description = catalogEntry.description;
        if (!description) {
          const skillDir = path.join(dir, entry.name);
          const mdPath = entry.isDirectory()
            ? path.join(skillDir, 'SKILL.md')
            : skillDir;
          try {
            if (fs.existsSync(mdPath)) {
              const content = fs.readFileSync(mdPath, 'utf-8');
              const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
              description = firstLine?.trim().slice(0, 120) || '';
            }
          } catch {
            // ignore read errors (broken symlinks, etc.)
          }
        }

        skills.push({
          slug,
          name: formatName(slug),
          description,
          category: catalogEntry.category,
          categoryIcon: catalogEntry.categoryIcon,
          exists: true,
          sourceDir: prettyHome(dir, home),
        });
      }
    }

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read local skills', details: String(error) },
      { status: 500 }
    );
  }
}
