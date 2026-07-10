#!/usr/bin/env node

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const examplePath = join(rootDir, '.env.example');
const localPath = join(rootDir, '.env.local');

if (existsSync(localPath)) {
  console.log('.env.local 파일이 이미 있음. 기존 파일은 건드리지 않음.');
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('.env.example 파일을 찾을 수 없음.');
  process.exit(1);
}

copyFileSync(examplePath, localPath);
console.log('.env.local 파일을 만들었음.');
console.log('수강생이 직접 파일을 열어 수정하지 않아도 됨.');
console.log('Codex 채팅에서 애드센스 정보를 제공하면, Codex가 이 파일에 저장해서 사용할 수 있음.');
