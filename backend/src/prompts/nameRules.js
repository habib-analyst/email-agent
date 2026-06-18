export const NAME_RULES_PROMPT = `STRICT NAME RULES:
- "name" MUST be a real person name (e.g. "Guihai Chen", "Xuandong Li"), NOT a title/department/field
- For Chinese names like "Prof. Guihai CHEN": surname is the ALL-CAPS word → "Chen"
- For email gchen@nju.edu.cn: local part "gchen" = first letter "g" + surname "chen" → last_name "Chen"
- For email lxd@nju.edu.cn: local part "lxd" is initials → find real name from profile, surname "Li" NOT "Liang"
- NEVER return "Engineering", "Computer Science", or department names as person names`;
