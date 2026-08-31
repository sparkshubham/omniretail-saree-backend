import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RecordStatus } from '@prisma/client';

export class CreateBrandDto {
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
