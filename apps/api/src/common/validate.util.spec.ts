import {
  applyMapping,
  checkUniqueFields,
  fingerprintRow,
  isDuplicateIssue,
  normalizeDateInput,
  validateMappedRow,
} from './validate.util';
import { detectDelimiter } from '../jobs/file-parse.util';

const fields = [
  {
    key: 'email',
    label: 'Email',
    type: 'EMAIL' as const,
    required: true,
    unique: true,
  },
  {
    key: 'name',
    label: 'Name',
    type: 'STRING' as const,
    required: true,
    unique: false,
  },
  {
    key: 'amount',
    label: 'Amount',
    type: 'DECIMAL' as const,
    required: false,
    unique: false,
  },
];

describe('validateMappedRow', () => {
  it('flags required and invalid email', () => {
    const issues = validateMappedRow({ email: 'bad', name: '' }, fields);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['INVALID_EMAIL', 'REQUIRED']),
    );
  });

  it('passes valid row', () => {
    const issues = validateMappedRow(
      { email: 'a@b.com', name: 'Ada', amount: '12.5' },
      fields,
    );
    expect(issues).toHaveLength(0);
  });

  it('rejects bad decimal', () => {
    const issues = validateMappedRow(
      { email: 'a@b.com', name: 'Ada', amount: 'x' },
      fields,
    );
    expect(issues[0].code).toBe('INVALID_DECIMAL');
  });
});

describe('unique + helpers', () => {
  it('detects in-file unique collisions', () => {
    const seen = new Map<string, Set<string>>();
    expect(
      checkUniqueFields({ email: 'a@b.com' }, fields, seen),
    ).toHaveLength(0);
    expect(
      checkUniqueFields({ email: 'a@b.com' }, fields, seen)[0].code,
    ).toBe('DUPLICATE_UNIQUE_FIELD');
  });

  it('maps csv columns to fields', () => {
    expect(
      applyMapping(
        { 'Email Address': 'a@b.com', FullName: 'Ada' },
        { email: 'Email Address', name: 'FullName' },
      ),
    ).toEqual({ email: 'a@b.com', name: 'Ada' });
  });

  it('builds stable fingerprint', () => {
    expect(
      fingerprintRow({ email: 'A@B.com', name: ' Ada ', phone: '010-1234' }),
    ).toBe('a@b.com|ada|0101234');
  });

  it('normalizes excel serial dates', () => {
    const d = normalizeDateInput('45321');
    expect(d).toBeInstanceOf(Date);
  });

  it('detects semicolon delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('classifies duplicate codes', () => {
    expect(isDuplicateIssue('DUPLICATE_IN_FILE')).toBe(true);
    expect(isDuplicateIssue('REQUIRED')).toBe(false);
  });
});
