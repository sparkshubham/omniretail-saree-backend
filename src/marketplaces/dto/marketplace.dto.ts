import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MarketplacePlatform } from '@prisma/client';

export class ConnectAccountDto {
  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}

export class ConnectMarketplaceDto extends ConnectAccountDto {
  @IsEnum(MarketplacePlatform)
  platform!: MarketplacePlatform;
}

export class MapListingDto {
  @IsString()
  variantId!: string;

  @IsString()
  externalSku!: string;
}

export class ImportOrderItemDto {
  @IsString()
  externalSku!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ImportMarketplaceOrderDto {
  @IsEnum(MarketplacePlatform)
  platform!: MarketplacePlatform;

  @IsString()
  externalOrderId!: string;

  @IsString()
  customerName!: string;

  @IsString()
  customerMobile!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportOrderItemDto)
  items!: ImportOrderItemDto[];
}
