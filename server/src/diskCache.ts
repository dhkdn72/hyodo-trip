// 서버를 껐다 켜도 남는 작은 JSON 캐시 (server/.cache/*.json, git 에 올리지 않음)
// 장소 소개글·임베딩 벡터처럼 거의 바뀌지 않는데 다시 받으면 API 트래픽·계산 시간이 드는 값에 씁니다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './http.ts';

export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../.cache');

export class DiskCache<T> {
  private data: Record<string, T> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private file: string;

  constructor(name: string) {
    this.file = join(CACHE_DIR, `${name}.json`);
    try {
      if (existsSync(this.file)) this.data = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (e) {
      log(`캐시 ${name} 읽기 실패 → 새로 만듦`, (e as Error).message);
    }
  }

  get(k: string): T | undefined {
    return this.data[k];
  }

  has(k: string) {
    return k in this.data;
  }

  set(k: string, v: T) {
    this.data[k] = v;
    // 여러 번 바뀌어도 2초에 한 번만 파일에 씀
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 2000);
      this.timer.unref?.();
    }
  }

  flush() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data));
    } catch (e) {
      log('캐시 저장 실패', (e as Error).message);
    }
  }
}
