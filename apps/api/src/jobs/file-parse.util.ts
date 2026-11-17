import { closeSync, createReadStream, openSync, readSync } from 'fs';
import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';

export type FileKind = 'csv' | 'xlsx';

export function detectFileKind(originalName: string, mimeType?: string): FileKind {
  const lower = originalName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  if (
    mimeType?.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return 'xlsx';
  }
  return 'csv';
}

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts: Record<string, number> = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length,
  };
  let best = ',';
  let max = -1;
  for (const [d, c] of Object.entries(counts)) {
    if (c > max) {
      max = c;
      best = d;
    }
  }
  return max > 0 ? best : ',';
}

function readFileHead(filePath: string, maxBytes = 64 * 1024): string {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export async function inspectCsv(filePath: string): Promise<{
  headers: string[];
  delimiter: string;
  sampleRows: Record<string, string>[];
}> {
  const delimiter = detectDelimiter(readFileHead(filePath));

  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    const stream = createReadStream(filePath).pipe(
      parse({
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        delimiter,
        to: 6,
      }),
    );
    stream.on('readable', () => {
      let row: Record<string, string> | null;
      while ((row = stream.read() as Record<string, string> | null)) {
        if (!headers.length) headers = Object.keys(row);
        rows.push(row);
      }
    });
    stream.on('end', () => resolve({ headers, delimiter, sampleRows: rows }));
    stream.on('error', reject);
  });
}

export function createCsvRowStream(filePath: string, delimiter = ',') {
  return createReadStream(filePath).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      delimiter,
    }),
  );
}

export function inspectXlsx(filePath: string): {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  allRows: Record<string, string>[];
} {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  const allRows = json.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[String(k)] = v == null ? '' : String(v);
    }
    return out;
  });
  const headers = allRows[0] ? Object.keys(allRows[0]) : [];
  return {
    headers,
    sampleRows: allRows.slice(0, 5),
    totalRows: allRows.length,
    allRows,
  };
}

export async function* iterateFileRows(
  filePath: string,
  fileKind: FileKind,
  delimiter: string,
): AsyncGenerator<Record<string, string>> {
  if (fileKind === 'xlsx') {
    const { allRows } = inspectXlsx(filePath);
    for (const row of allRows) yield row;
    return;
  }
  const stream = createCsvRowStream(filePath, delimiter);
  for await (const row of stream as AsyncIterable<Record<string, string>>) {
    yield row;
  }
}
