import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ConnectWhatsAppDto {
  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  businessAccountId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;
}

export class SimulateInboundDto {
  @IsString()
  phone!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  customerName?: string;
}

export class SendMessageDto {
  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  template?: string;
}

export class WhatsAppOrderItemDto {
  @IsString()
  variantId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateWhatsAppOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WhatsAppOrderItemDto)
  items!: WhatsAppOrderItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
