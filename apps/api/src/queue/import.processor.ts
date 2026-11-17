import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStatus, Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import {
  applyMapping,
  checkUniqueFields,
  fingerprintRow,
  isDuplicateIssue,
  normalizeDateInput,
  SchemaFieldDef,
  validateMappedRow,
} from '../common/validate.util';
import { FileKind, iterateFileRows } from '../jobs/file-parse.util';
import { PrismaService } from '../prisma/prisma.service';

export const IMPORT_QUEUE = 'import-jobs';

type ImportJobPayload = { jobId: string };

@Processor(IMPORT_QUEUE)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    this.batchSize = Number(config.get('BATCH_SIZE', 500));
  }

  async process(job: Job<ImportJobPayload>) {
    const { jobId } = job.data;
    this.logger.log(`Processing import job ${jobId}`);

    const importJob = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!importJob) throw new Error(`Job ${jobId} not found`);
    if (!importJob.mapping) throw new Error('Mapping missing');

    const fields = (await this.prisma.schemaField.findMany({
      orderBy: { sortOrder: 'asc' },
    })) as SchemaFieldDef[];
    const mapping = importJob.mapping as Record<string, string>;
    const fileKind = (importJob.fileKind || 'csv') as FileKind;

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PROCESSING,
        startedAt: new Date(),
        processedRows: 0,
        successRows: 0,
        failedRows: 0,
        duplicateRows: 0,
        cancelRequested: false,
        errorMessage: null,
      },
    });

    await this.prisma.importError.deleteMany({ where: { jobId } });
    await this.prisma.importRecord.deleteMany({ where: { jobId } });

    const seenInFile = new Set<string>();
    const uniqueSeen = new Map<string, Set<string>>();

    let rowNumber = 0;
    let processed = 0;
    let success = 0;
    let failed = 0;
    let duplicates = 0;

    type RecordBuf = Prisma.ImportRecordCreateManyInput;
    type ErrorBuf = Prisma.ImportErrorCreateManyInput;
    let recordBuf: RecordBuf[] = [];
    let errorBuf: ErrorBuf[] = [];
    let pendingFingerprints: string[] = [];

    const flush = async () => {
      if (pendingFingerprints.length) {
        const existing = await this.prisma.importRecord.findMany({
          where: {
            fingerprint: { in: pendingFingerprints },
            job: { userId: importJob.userId },
            NOT: { jobId },
          },
          select: { fingerprint: true },
        });
        const existingSet = new Set(existing.map((e) => e.fingerprint));
        // Records already validated as non-dup in-file; drop any that collide with DB
        if (existingSet.size) {
          const kept: RecordBuf[] = [];
          for (const rec of recordBuf) {
            if (existingSet.has(rec.fingerprint as string)) {
              duplicates += 1;
              errorBuf.push({
                jobId,
                rowNumber: rec.rowNumber as number,
                field: null,
                code: 'DUPLICATE_EXISTING',
                message: 'Duplicate of previously imported data',
                raw: rec.raw as Prisma.InputJsonValue,
              });
              success -= 1;
            } else {
              kept.push(rec);
            }
          }
          recordBuf = kept;
        }
        pendingFingerprints = [];
      }

      if (recordBuf.length) {
        await this.prisma.importRecord.createMany({ data: recordBuf });
        recordBuf = [];
      }
      if (errorBuf.length) {
        await this.prisma.importError.createMany({ data: errorBuf });
        errorBuf = [];
      }
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedRows: processed,
          successRows: success,
          failedRows: failed,
          duplicateRows: duplicates,
          totalRows: Math.max(importJob.totalRows, rowNumber),
        },
      });
      const total = Math.max(importJob.totalRows, rowNumber, 1);
      const progress = Math.min(99, Math.round((processed / total) * 100));
      await job.updateProgress(progress);
    };

    try {
      for await (const raw of iterateFileRows(
        importJob.storedPath,
        fileKind,
        importJob.delimiter || ',',
      )) {
        if (processed % 200 === 0) {
          const fresh = await this.prisma.importJob.findUnique({
            where: { id: jobId },
            select: { cancelRequested: true },
          });
          if (fresh?.cancelRequested) {
            await flush();
            await this.prisma.importJob.update({
              where: { id: jobId },
              data: {
                status: JobStatus.CANCELLED,
                totalRows: rowNumber,
                processedRows: processed,
                successRows: success,
                failedRows: failed,
                duplicateRows: duplicates,
                completedAt: new Date(),
                errorMessage: 'Cancelled by user',
              },
            });
            await job.updateProgress(100);
            return { cancelled: true, success, failed, duplicates };
          }
        }

        rowNumber += 1;
        processed += 1;
        const mapped = applyMapping(raw, mapping);
        const issues = [
          ...validateMappedRow(mapped, fields),
          ...checkUniqueFields(mapped, fields, uniqueSeen),
        ];
        const fp = fingerprintRow(mapped);

        if (fp !== '||') {
          if (seenInFile.has(fp)) {
            issues.push({
              field: null,
              code: 'DUPLICATE_IN_FILE',
              message: 'Duplicate row within this file',
            });
          } else {
            seenInFile.add(fp);
          }
        }

        const hasValidation = issues.some((i) => !isDuplicateIssue(i.code));
        const hasDup = issues.some((i) => isDuplicateIssue(i.code));

        if (issues.length) {
          if (hasDup) duplicates += 1;
          if (hasValidation) failed += 1;
          else if (hasDup && !hasValidation) {
            // pure duplicate — counted in duplicateRows only
          }
          // If only dup (no validation), still don't insert — treat as rejected
          // failedRows stays validation-only
          for (const issue of issues) {
            errorBuf.push({
              jobId,
              rowNumber,
              field: issue.field,
              code: issue.code,
              message: issue.message,
              raw: raw as Prisma.InputJsonValue,
            });
          }
        } else {
          success += 1;
          pendingFingerprints.push(fp);
          const orderDate = mapped.order_date
            ? normalizeDateInput(mapped.order_date)
            : null;
          recordBuf.push({
            jobId,
            rowNumber,
            email: mapped.email?.trim() || null,
            name: mapped.name?.trim() || null,
            phone: mapped.phone?.trim() || null,
            amount: mapped.amount ? mapped.amount.replace(/,/g, '') : null,
            orderDate,
            data: mapped as Prisma.InputJsonValue,
            raw: raw as Prisma.InputJsonValue,
            fingerprint: fp,
          });
        }

        if (
          recordBuf.length >= this.batchSize ||
          errorBuf.length >= this.batchSize
        ) {
          await flush();
        }
      }

      await flush();

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          totalRows: rowNumber,
          processedRows: processed,
          successRows: success,
          failedRows: failed,
          duplicateRows: duplicates,
          completedAt: new Date(),
        },
      });
      await job.updateProgress(100);
      this.logger.log(
        `Job ${jobId} done: ${success} ok / ${failed} fail / ${duplicates} dup`,
      );
      return { success, failed, duplicates };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }
}
