import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode 'demo' = 서버 없이 브라우저에서 예시 데이터로 일정 엔진을 돌리는 한 파일짜리 데모 (dist-demo/index.html)
// 데모 페이지는 외부 스타일시트를 Google Fonts 에서만 불러올 수 있는 곳에 올리므로 글꼴을 Noto Sans KR 로 바꿈
const demoFont = {
  name: 'demo-font',
  transformIndexHtml: (html: string) =>
    html.replace(
      /<link rel="stylesheet" crossorigin="anonymous" href="https:\/\/cdn\.jsdelivr\.net[^"]+" \/>/,
      '<link rel="stylesheet" crossorigin="anonymous" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" />',
    ),
};

export default defineConfig(({ mode }) => ({
  // 개발 중 /api 요청은 서버(루트 .env 의 PORT, 기본 8787)로 넘김
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile(), demoFont] : [])],
  envDir: '..',
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${loadEnv(mode, '..', '').PORT || 8787}` },
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    emptyOutDir: true,
  },
}));
