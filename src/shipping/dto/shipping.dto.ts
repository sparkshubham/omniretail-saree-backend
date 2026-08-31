import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ShippingProviderKind } from '@prisma/client';

export class CreateShipmentDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsEnum(ShippingProviderKind)
  provider?: ShippingProviderKind;
}

export class RequestReturnDto {
  @IsString()
  reason!: string;
}

export class DecideReturnDto {
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
