// 카카오 JavaScript SDK 로더
//  - 지도: https://dapi.kakao.com/v2/maps/sdk.js?appkey=JS키&autoload=false → kakao.maps.load()
//  - 카카오톡 공유: Kakao JS SDK v2 (Kakao.Share.uploadImage / sendDefault)
// JavaScript 키는 앱 관리 > 플랫폼 키에서 확인하고, 'JavaScript SDK 도메인'에 접속 주소를 등록해야 합니다.

export const KAKAO_JS_KEY = (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) || '';

declare global {
  interface Window {
    kakao?: any;
    Kakao?: any;
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트를 불러오지 못했어요: ${src}`));
    document.head.appendChild(s);
  });
}

let mapsPromise: Promise<any> | null = null;
export function loadKakaoMaps(): Promise<any> {
  if (!KAKAO_JS_KEY) return Promise.reject(new Error('VITE_KAKAO_JS_KEY 없음'));
  mapsPromise ??= loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`).then(
    () => new Promise((resolve) => window.kakao.maps.load(() => resolve(window.kakao))),
  );
  return mapsPromise;
}

let sdkPromise: Promise<any> | null = null;
export function loadKakaoSdk(): Promise<any> {
  if (!KAKAO_JS_KEY) return Promise.reject(new Error('VITE_KAKAO_JS_KEY 없음'));
  // 카카오 공식 튜토리얼에 안내된 2.8.2 버전과 무결성 값
  sdkPromise ??= loadScript('https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js', {
    integrity: 'sha384-zt/G7/KfaRQ9dT/QIkS0ujMtzouJqzuSJcXVQu50x0rl/+mD1dc70AeOejVbMD9E',
    crossorigin: 'anonymous',
  }).then(() => {
    if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
    return window.Kakao;
  });
  return sdkPromise;
}
