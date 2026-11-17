import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Observable, interval, map, switchMap, takeWhile } from 'rxjs';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrQueryGuard } from '../auth/jwt-or-query.guard';
import { SetMappingDto } from './dto/job.dto';
import { JobsService } from './jobs.service';

function uploadDir() {
  const dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_MIME = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('schema-fields')
  schemaFields() {
    return this.jobs.listSchemaFields();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.jobs.list(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':jobId')
  get(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.jobs.get(user.id, jobId);
  }

  /** EventSource cannot set Authorization — use `?access_token=` */
  @UseGuards(JwtOrQueryGuard)
  @Sse(':jobId/events')
  events(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ): Observable<MessageEvent> {
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
    return interval(1000).pipe(
      switchMap(async () => this.jobs.get(user.id, jobId)),
      map((job) => ({ data: job }) as MessageEvent),
      takeWhile((msg) => !terminal.has((msg.data as { status: string }).status), true),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir()),
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const okExt = ['.csv', '.xlsx', '.xls'].includes(ext);
        const okMime = !file.mimetype || ALLOWED_MIME.has(file.mimetype);
        if (!okExt || !okMime) {
          cb(new Error('Only CSV or Excel files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.jobs.upload(user.id, file);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':jobId/mapping')
  setMapping(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() dto: SetMappingDto,
  ) {
    return this.jobs.setMapping(user.id, jobId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':jobId/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Query('limit') limit = '5',
  ) {
    return this.jobs.preview(user.id, jobId, Number(limit) || 5);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':jobId/start')
  start(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.jobs.start(user.id, jobId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':jobId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.jobs.cancel(user.id, jobId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':jobId')
  remove(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.jobs.remove(user.id, jobId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':jobId/errors')
  errors(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    return this.jobs.errors(user.id, jobId, Number(page), Number(pageSize));
  }

  @UseGuards(JwtAuthGuard)
  @Get(':jobId/records')
  records(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    return this.jobs.records(user.id, jobId, Number(page), Number(pageSize));
  }

  @UseGuards(JwtAuthGuard)
  @Get(':jobId/errors.csv')
  async downloadErrors(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const csv = await this.jobs.errorsCsv(user.id, jobId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="job-${jobId}-errors.csv"`,
    );
    res.send(csv);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':jobId/records.csv')
  async downloadRecords(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const csv = await this.jobs.recordsCsv(user.id, jobId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="job-${jobId}-records.csv"`,
    );
    res.send(csv);
  }
}
