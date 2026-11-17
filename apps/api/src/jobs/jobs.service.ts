import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createReadStream, existsSync, unlinkSync } from 'fs';
import {
  applyMapping,
  checkUniqueFields,
  SchemaFieldDef,
  validateMappedRow,
} from '../common/validate.util';
import { IMPORT_QUEUE } from '../queue/import.processor';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SetMappingDto } from './dto/job.dto';
import {
  detectFileKind,
  FileKind,
  inspectCsv,
  inspectXlsx,
  iterateFileRows,
} from './file-parse.util';

const ALLOWED_EXT = ['.csv', '.xlsx', '.xls'];

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(IMPORT_QUEUE) private readonly importQueue: Queue,
  ) {}

  listSchemaFields() {
    return this.prisma.schemaField.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  list(userId: string) {
    return this.prisma.importJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        status: true,
        fileKind: true,
        sizeBytes: true,
        totalRows: true,
        processedRows: true,
        successRows: true,
        failedRows: true,
        duplicateRows: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }

  async get(userId: string, jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.userId !== userId) throw new ForbiddenException();
    const progress =
      job.totalRows > 0
        ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100))
        : job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED
          ? 100
          : job.status === JobStatus.PROCESSING
            ? 1
            : 0;
    return { ...job, progress };
  }

  async upload(userId: string, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('File is required');
    const lower = file.originalname.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      this.safeUnlink(file.path);
      throw new BadRequestException('Only CSV or Excel (.xlsx) files are supported');
    }

    const abs = file.path;
    const fileKind = detectFileKind(file.originalname, file.mimetype);
    let headers: string[] = [];
    let delimiter = ',';
    let totalRows = 0;

    try {
      if (fileKind === 'xlsx') {
        const inspected = inspectXlsx(abs);
        headers = inspected.headers;
        totalRows = inspected.totalRows;
      } else {
        const inspected = await inspectCsv(abs);
        headers = inspected.headers;
        delimiter = inspected.delimiter;
        // Avoid full double-scan on upload; worker will finalize totalRows
        totalRows = 0;
      }
    } catch (err) {
      this.safeUnlink(abs);
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not parse file',
      );
    }

    if (!headers.length) {
      this.safeUnlink(abs);
      throw new BadRequestException('Could not read file headers');
    }

    return this.prisma.importJob.create({
      data: {
        userId,
        originalName: file.originalname,
        storedPath: abs,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        fileKind,
        delimiter,
        status: JobStatus.UPLOADED,
        headers: headers as Prisma.InputJsonValue,
        totalRows,
      },
    });
  }

  async setMapping(userId: string, jobId: string, dto: SetMappingDto) {
    const job = await this.assertOwner(userId, jobId);
    if (
      job.status !== JobStatus.UPLOADED &&
      job.status !== JobStatus.MAPPED &&
      job.status !== JobStatus.FAILED &&
      job.status !== JobStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot change mapping for this job');
    }

    const fields = await this.prisma.schemaField.findMany();
    const headers = (job.headers as string[]) || [];
    for (const [key, col] of Object.entries(dto.mapping)) {
      if (!fields.some((f) => f.key === key)) {
        throw new BadRequestException(`Unknown field: ${key}`);
      }
      if (col && !headers.includes(col)) {
        throw new BadRequestException(`Unknown column: ${col}`);
      }
    }

    for (const f of fields.filter((x) => x.required)) {
      if (!dto.mapping[f.key]) {
        throw new BadRequestException(`Required field not mapped: ${f.key}`);
      }
    }

    return this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        mapping: dto.mapping as Prisma.InputJsonValue,
        status: JobStatus.MAPPED,
      },
    });
  }

  async preview(userId: string, jobId: string, limit = 5) {
    const job = await this.assertOwner(userId, jobId);
    if (!job.mapping) throw new BadRequestException('Mapping required');
    const fields = (await this.prisma.schemaField.findMany({
      orderBy: { sortOrder: 'asc' },
    })) as SchemaFieldDef[];
    const mapping = job.mapping as Record<string, string>;
    const uniqueSeen = new Map<string, Set<string>>();
    const rows: Array<{
      rowNumber: number;
      mapped: Record<string, string | undefined>;
      issues: ReturnType<typeof validateMappedRow>;
    }> = [];

    let n = 0;
    for await (const raw of iterateFileRows(
      job.storedPath,
      (job.fileKind || 'csv') as FileKind,
      job.delimiter || ',',
    )) {
      n += 1;
      const mapped = applyMapping(raw, mapping);
      const issues = [
        ...validateMappedRow(mapped, fields),
        ...checkUniqueFields(mapped, fields, uniqueSeen),
      ];
      rows.push({ rowNumber: n, mapped, issues });
      if (rows.length >= limit) break;
    }
    return { rows, fields };
  }

  async start(userId: string, jobId: string) {
    const job = await this.assertOwner(userId, jobId);
    if (
      job.status !== JobStatus.MAPPED &&
      job.status !== JobStatus.FAILED &&
      job.status !== JobStatus.CANCELLED &&
      job.status !== JobStatus.COMPLETED
    ) {
      throw new BadRequestException('Job must be mapped before start');
    }
    if (!job.mapping) throw new BadRequestException('Mapping required');

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.QUEUED,
        errorMessage: null,
        cancelRequested: false,
      },
    });

    // Unique Bull job id every run so FAILED/CANCELLED retries work
    await this.importQueue.add(
      'process',
      { jobId },
      {
        jobId: `import-${jobId}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
      },
    );

    return this.get(userId, jobId);
  }

  async cancel(userId: string, jobId: string) {
    const job = await this.assertOwner(userId, jobId);
    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.PROCESSING) {
      throw new BadRequestException('Only queued/processing jobs can be cancelled');
    }
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { cancelRequested: true },
    });
    return this.get(userId, jobId);
  }

  async remove(userId: string, jobId: string) {
    const job = await this.assertOwner(userId, jobId);
    if (job.status === JobStatus.QUEUED || job.status === JobStatus.PROCESSING) {
      throw new BadRequestException('Cancel the job before deleting');
    }
    this.safeUnlink(job.storedPath);
    await this.prisma.importJob.delete({ where: { id: jobId } });
    return { ok: true };
  }

  async errors(
    userId: string,
    jobId: string,
    page = 1,
    pageSize = 50,
  ) {
    await this.assertOwner(userId, jobId);
    const take = Math.min(Math.max(pageSize, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.importError.findMany({
        where: { jobId },
        orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }],
        skip,
        take,
      }),
      this.prisma.importError.count({ where: { jobId } }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async records(
    userId: string,
    jobId: string,
    page = 1,
    pageSize = 50,
  ) {
    await this.assertOwner(userId, jobId);
    const take = Math.min(Math.max(pageSize, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.importRecord.findMany({
        where: { jobId },
        orderBy: { rowNumber: 'asc' },
        skip,
        take,
      }),
      this.prisma.importRecord.count({ where: { jobId } }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async errorsCsv(userId: string, jobId: string): Promise<string> {
    await this.assertOwner(userId, jobId);
    const rows = await this.prisma.importError.findMany({
      where: { jobId },
      orderBy: [{ rowNumber: 'asc' }],
    });
    const header = 'row_number,field,code,message\n';
    const body = rows
      .map((r) =>
        [r.rowNumber, csvEscape(r.field || ''), csvEscape(r.code), csvEscape(r.message)].join(
          ',',
        ),
      )
      .join('\n');
    return header + body;
  }

  async recordsCsv(userId: string, jobId: string): Promise<string> {
    await this.assertOwner(userId, jobId);
    const fields = await this.prisma.schemaField.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    const keys = fields.map((f) => f.key);
    const rows = await this.prisma.importRecord.findMany({
      where: { jobId },
      orderBy: { rowNumber: 'asc' },
    });
    const header = ['row_number', ...keys].join(',') + '\n';
    const body = rows
      .map((r) => {
        const data = (r.data as Record<string, string | undefined>) || {};
        const fallback: Record<string, string | null | undefined> = {
          email: r.email,
          name: r.name,
          phone: r.phone,
          amount: r.amount?.toString(),
          order_date: r.orderDate?.toISOString().slice(0, 10),
        };
        return [
          r.rowNumber,
          ...keys.map((k) => csvEscape(data[k] ?? fallback[k] ?? '')),
        ].join(',');
      })
      .join('\n');
    return header + body;
  }

  openStoredFile(userId: string, jobId: string) {
    return this.assertOwner(userId, jobId).then((job) => {
      if (!existsSync(job.storedPath)) {
        throw new NotFoundException('Stored file missing');
      }
      return { stream: createReadStream(job.storedPath), job };
    });
  }

  private async assertOwner(userId: string, jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.userId !== userId) throw new ForbiddenException();
    return job;
  }

  private safeUnlink(path?: string | null) {
    if (!path) return;
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

function csvEscape(value: string) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
