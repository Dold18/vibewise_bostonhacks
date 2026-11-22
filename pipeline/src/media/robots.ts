interface Rule { allow: boolean; pattern: string; re: RegExp }
interface Group { agents: string[]; rules: Rule[] }

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function parseGroups(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== 'allow' && key !== 'disallow') || value === '') continue;
    current.rules.push({ allow: key === 'allow', pattern: value, re: toRegExp(value) });
  }
  return groups;
}

/** Returns a predicate saying whether `path` may be fetched by `userAgent` under this robots.txt. */
export function parseRobots(txt: string, userAgent: string): (path: string) => boolean {
  const token = (userAgent.split('/')[0] ?? userAgent).trim().toLowerCase();
  const groups = parseGroups(txt);
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  return (path: string) => {
    let best: Rule | null = null;
    for (const r of rules) {
      if (!r.re.test(path)) continue;
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
    }
    return best ? best.allow : true;
  };
}
