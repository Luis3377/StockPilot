// Minimal RFC 4180 CSV reader/writer: quoted fields, escaped quotes, embedded newlines,
// CRLF line endings and a UTF-8 byte-order mark (as written by Excel).

export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((r) => r.cells);
}

/**
 * Like parseCsv, with the line each row starts on in the file (1-based, counting blank lines
 * and lines inside quoted fields), so error messages can point at the line a spreadsheet shows.
 */
export function parseCsvLines(text: string): { cells: string[]; line: number }[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let line = 1;
  let rowLine = 1;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === '\n' || (ch === '\r' && input[i + 1] !== '\n')) line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push({ cells: row, line: rowLine });
      row = [];
      field = '';
      i += ch === '\r' && input[i + 1] === '\n' ? 2 : 1;
      line++;
      rowLine = line;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push({ cells: row, line: rowLine });
  }
  // Drop fully blank lines (common at the end of files or between sections).
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

/**
 * Text cells starting with = + - @ can be executed as formulas by spreadsheet apps
 * ("CSV injection"); prefix them with an apostrophe. Numbers are written as numbers.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number') {
    s = Number.isFinite(value) ? String(value) : '';
  } else {
    s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
