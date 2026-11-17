export type FieldType = 'STRING' | 'EMAIL' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'PHONE';

export type SchemaFieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  pattern?: string | null;
};

export type ValidationIssue = {
  field: string | null;
  code: string;
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export function validateMappedRow(
  mapped: Record<string, string | undefined>,
  fields: SchemaFieldDef[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of fields) {
    const raw = mapped[field.key];
    const value = raw == null ? '' : String(raw).trim();

    if (!value) {
      if (field.required) {
        issues.push({
          field: field.key,
          code: 'REQUIRED',
          message: `${field.label} is required`,
        });
      }
      continue;
    }

    switch (field.type) {
      case 'EMAIL':
        if (!EMAIL_RE.test(value)) {
          issues.push({
            field: field.key,
            code: 'INVALID_EMAIL',
            message: `${field.label} must be a valid email`,
          });
        }
        break;
      case 'INTEGER':
        if (!/^-?\d+$/.test(value)) {
          issues.push({
            field: field.key,
            code: 'INVALID_INTEGER',
            message: `${field.label} must be an integer`,
          });
        }
        break;
      case 'DECIMAL':
        if (!/^-?\d+(\.\d+)?$/.test(value.replace(/,/g, ''))) {
          issues.push({
            field: field.key,
            code: 'INVALID_DECIMAL',
            message: `${field.label} must be a number`,
          });
        }
        break;
      case 'DATE': {
        const normalized = normalizeDateInput(value);
        if (!normalized) {
          issues.push({
            field: field.key,
            code: 'INVALID_DATE',
            message: `${field.label} must be a valid date`,
          });
        }
        break;
      }
      case 'PHONE':
        if (!PHONE_RE.test(value)) {
          issues.push({
            field: field.key,
            code: 'INVALID_PHONE',
            message: `${field.label} must be a valid phone`,
          });
        }
        break;
      case 'STRING':
      default:
        break;
    }

    if (field.pattern) {
      try {
        const re = new RegExp(field.pattern);
        if (!re.test(value)) {
          issues.push({
            field: field.key,
            code: 'PATTERN',
            message: `${field.label} does not match required format`,
          });
        }
      } catch {
        /* ignore bad pattern */
      }
    }
  }

  return issues;
}

/** In-file uniqueness for fields marked unique. */
export function checkUniqueFields(
  mapped: Record<string, string | undefined>,
  fields: SchemaFieldDef[],
  seen: Map<string, Set<string>>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of fields.filter((f) => f.unique)) {
    const value = (mapped[field.key] || '').trim().toLowerCase();
    if (!value) continue;
    if (!seen.has(field.key)) seen.set(field.key, new Set());
    const set = seen.get(field.key)!;
    if (set.has(value)) {
      issues.push({
        field: field.key,
        code: 'DUPLICATE_UNIQUE_FIELD',
        message: `${field.label} must be unique within the file`,
      });
    } else {
      set.add(value);
    }
  }
  return issues;
}

export function normalizeDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(trimmed)) {
    const t = Date.parse(trimmed);
    if (!Number.isNaN(t)) return new Date(t);
  }
  // Excel serial date (days since 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 20000 && serial < 80000) {
      const epoch = Date.UTC(1899, 11, 30);
      return new Date(epoch + serial * 86400000);
    }
  }
  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? null : new Date(t);
}

export function fingerprintRow(mapped: Record<string, string | undefined>): string {
  const email = (mapped.email || '').trim().toLowerCase();
  const name = (mapped.name || '').trim().toLowerCase();
  const phone = (mapped.phone || '').replace(/\D/g, '');
  return `${email}|${name}|${phone}`;
}

export function applyMapping(
  raw: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [fieldKey, csvColumn] of Object.entries(mapping)) {
    out[fieldKey] = csvColumn ? raw[csvColumn] : undefined;
  }
  return out;
}

export function isDuplicateIssue(code: string) {
  return (
    code === 'DUPLICATE_IN_FILE' ||
    code === 'DUPLICATE_EXISTING' ||
    code === 'DUPLICATE_UNIQUE_FIELD'
  );
}
