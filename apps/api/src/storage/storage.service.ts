import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  readonly uploadDir: string;

  constructor(config: ConfigService) {
    this.uploadDir = config.get('UPLOAD_DIR', join(process.cwd(), 'uploads'));
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  buildStoredName(originalName: string) {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${Date.now()}-${randomUUID()}-${safe}`;
  }

  absolutePath(storedName: string) {
    return join(this.uploadDir, storedName);
  }

  openReadStream(storedPath: string) {
    return createReadStream(storedPath);
  }
}
