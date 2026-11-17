import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';

export class SetMappingDto {
  @ApiProperty({
    description: 'Map system field key → CSV column name',
    example: { email: 'Email', name: 'Full Name', amount: 'Amount' },
  })
  @IsObject()
  mapping!: Record<string, string>;
}

export class StartJobDto {
  @ApiProperty({ required: false, example: 'optional note' })
  @IsString()
  note?: string;
}
