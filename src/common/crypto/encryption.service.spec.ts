import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          },
        },
      ],
    }).compile();
    service = module.get(EncryptionService);
  });

  it('round-trips marketplace credentials', () => {
    const secret = 'amzn.sp.token.example';
    const encrypted = service.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });
});
