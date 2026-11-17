import { FieldType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const fields = [
  { key: 'email', label: 'Email', type: FieldType.EMAIL, required: true, unique: true, sortOrder: 1 },
  { key: 'name', label: 'Name', type: FieldType.STRING, required: true, unique: false, sortOrder: 2 },
  { key: 'phone', label: 'Phone', type: FieldType.PHONE, required: false, unique: false, sortOrder: 3 },
  { key: 'amount', label: 'Amount', type: FieldType.DECIMAL, required: false, unique: false, sortOrder: 4 },
  { key: 'order_date', label: 'Order Date', type: FieldType.DATE, required: false, unique: false, sortOrder: 5 },
];

async function main() {
  for (const f of fields) {
    await prisma.schemaField.upsert({
      where: { key: f.key },
      create: f,
      update: {
        label: f.label,
        type: f.type,
        required: f.required,
        unique: f.unique,
        sortOrder: f.sortOrder,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
