import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

let cachedServer: express.Express | undefined;

async function createServer(): Promise<express.Express> {
  if (cachedServer) return cachedServer;

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });
  configureApp(app);
  await app.init();
  cachedServer = server;
  return server;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = await createServer();
  server(req, res);
}
