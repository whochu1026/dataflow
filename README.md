# DataFlow

**복잡한 데이터 업로드와 검증 작업을 자동화하세요.**

## 이 프로젝트는?

| | |
|---|---|
| **무엇을** | CSV/Excel을 올리면 컬럼 매핑·검증·중복 검사 후 DB에 적재하는 **데이터 임포트 SaaS** |
| **왜** | 운영에서 파일 업로드 시 형식 오류·중복·필수값 누락이 잦고, 대량 파일을 한 번에 메모리에 올리면 서버가 버티기 어려움 |
| **어떻게** | 디스크 업로드 → 매핑/미리보기 → BullMQ 워커가 스트리밍·배치 검증 → 성공/오류 리포트 다운로드 |

포트폴리오용 MVP로, NestJS + Prisma + Redis/BullMQ + Next.js로 구현했습니다.

---

## 처리 흐름

1. `POST /jobs/upload` — CSV/Excel disk 저장, 헤더·구분자 감지  
2. `POST /jobs/:id/mapping` — 시스템 필드 ↔ 컬럼 매핑  
3. `POST /jobs/:id/preview` — 상위 N행 검증 미리보기  
4. `POST /jobs/:id/start` — BullMQ 큐 등록 (재시도 시 고유 job id)  
5. Worker — 스트리밍 검증 · unique/중복 검사 · batch insert · 취소 폴링  
6. `GET .../errors|records` + `.csv` — 리포트·결과 다운로드  
7. `POST /jobs/:id/cancel` · `DELETE /jobs/:id` — 취소·삭제(+파일 정리)

### 통계 의미

| 필드 | 의미 |
|------|------|
| `successRows` | 검증 통과 후 적재 |
| `failedRows` | **validation** 실패만 |
| `duplicateRows` | 파일 내/기존/unique 필드 중복 |

---

## 로컬 실행

```bash
cp .env.example .env && cp .env.example apps/api/.env
docker compose up -d          # postgres:5434, redis:6381

cd apps/api
npx prisma migrate dev
npx prisma db seed
cd ../..

npm run start:dev -w @dataflow/api   # :3004
npm run dev -w @dataflow/web         # :3005
```

Demo: **Demo** 버튼 (`demo@dataflow.test` / `password123`)  
Swagger: http://localhost:3004/api/docs

---

## 테스트

```bash
npm test -w @dataflow/api
```

---

## 포트폴리오 포인트

- Disk 업로드 + CSV 스트리밍 / Excel 파싱  
- 구분자 자동 감지, unique 필드·중복 검사  
- BullMQ 배치 처리 + 취소 + 재시도  
- 미리보기, 페이지네이션 오류 리포트, 성공/실패 CSV  
- Throttling · MIME/확장자 화이트리스트
