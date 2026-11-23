// F5 한 장 일정표 — 화면의 일정표를 이미지(PNG)·PDF 로 만들고 카카오톡으로 보냅니다. 외부 API 는 공유할 때만 씁니다.
//
// 카카오톡으로 보내기 순서
//  1) 휴대폰 브라우저/앱: Web Share API 로 '사진 파일'을 공유 시트에 넘김 → 카카오톡 선택 → 부모님이 사진 한 장을 받음
//  2) 1이 안 되고 카카오 JS 키가 있으면: Kakao.Share.uploadImage 로 이미지를 올린 뒤 sendDefault(피드)로 전송
//  3) 둘 다 안 되면: 이미지를 저장하고, 카카오톡에서 사진으로 보내 달라고 안내

import { toBlob } from 'html-to-image';
import { KAKAO_JS_KEY, loadKakaoSdk } from './kakao';

export async function renderCard(node: HTMLElement): Promise<Blob> {
  const opts = { pixelRatio: 2, backgroundColor: '#fffaf0', cacheBust: true };
  try {
    const b = await toBlob(node, opts);
    if (b) return b;
  } catch {
    /* 웹 폰트를 못 읽으면 폰트 없이 다시 */
  }
  const b = await toBlob(node, { ...opts, skipFonts: true });
  if (!b) throw new Error('이미지를 만들지 못했어요.');
  return b;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function savePdf(blob: Blob, filename: string) {
  const { jsPDF } = await import('jspdf');
  const dataUrl = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(blob);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  // A4 세로에 가로 폭을 맞춰 넣음
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const w = pageW - margin * 2;
  const h = Math.min((img.height / img.width) * w, pageH - margin * 2);
  const ww = (img.width / img.height) * h;
  pdf.addImage(dataUrl, 'PNG', (pageW - ww) / 2, margin, ww, h);
  pdf.save(filename);
}

export type ShareOutcome = 'webshare' | 'kakao' | 'download' | 'cancelled';

export async function shareToKakaoTalk(blob: Blob, filename: string, title: string, description: string): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'webshare';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }

  if (KAKAO_JS_KEY) {
    const Kakao = await loadKakaoSdk();
    const dt = new DataTransfer();
    dt.items.add(file);
    const up = await Kakao.Share.uploadImage({ file: dt.files });
    const imageUrl: string = up?.infos?.original?.url;
    // link 의 도메인은 카카오디벨로퍼스 [앱] > [제품 링크 관리] > [웹 도메인]에 등록돼 있어야 합니다
    const link = { mobileWebUrl: location.origin, webUrl: location.origin };
    Kakao.Share.sendDefault({
      objectType: 'feed',
      content: { title, description, imageUrl, link },
    });
    return 'kakao';
  }

  download(blob, filename);
  return 'download';
}
