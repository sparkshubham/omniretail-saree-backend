import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RecordStatus } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
