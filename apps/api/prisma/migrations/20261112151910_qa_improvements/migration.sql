-- AlterEnum
ALTER TYPE "job_status" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "delimiter" TEXT NOT NULL DEFAULT ',',
ADD COLUMN     "file_kind" TEXT NOT NULL DEFAULT 'csv';

-- AlterTable
ALTER TABLE "import_records" ADD COLUMN     "data" JSONB NOT NULL DEFAULT '{}';
