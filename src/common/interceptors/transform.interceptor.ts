import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

interface Envelope<T> {
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(
      map((payload) => {
        if (payload && typeof payload === 'object' && 'data' in (payload as Envelope<T>)) {
          const envelope = payload as Envelope<T>;
          return {
            success: true as const,
            message: envelope.message ?? 'OK',
            data: (envelope.data ?? null) as T,
            ...(envelope.meta ? { meta: envelope.meta } : {}),
          };
        }
        return {
          success: true as const,
          message: 'OK',
          data: payload,
        };
      }),
    );
  }
}
