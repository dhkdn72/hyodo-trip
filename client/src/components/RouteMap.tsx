import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Stop } from '@hyodo/core';
import { KAKAO_JS_KEY, loadKakaoMaps } from '../lib/kakao';

interface Seg {
  points: [number, number][]; // [lng, lat]
  taxi: boolean;
}

function buildGeometry(stops: Stop[]) {
  const markers: { lng: number; lat: number; label: string; home: boolean; name: string }[] = [];
  const segs: Seg[] = [];
  let n = 0;
  let prev: Stop | null = null;
  for (const s of stops) {
    if (s.type === 'rest' && s.restInPlace) continue;
    if (prev && s.legFromPrev) {
      const pts = s.legFromPrev.path?.length
        ? s.legFromPrev.path
        : ([
            [prev.place.pos.lng, prev.place.pos.lat],
            [s.place.pos.lng, s.place.pos.lat],
          ] as [number, number][]);
      segs.push({ points: pts, taxi: s.legFromPrev.mode === 'taxi' });
    }
    if (s.type === 'start') markers.push({ ...s.place.pos, label: s.place.kind === 'lodging' ? '숙' : '출', home: true, name: s.place.name });
    else if (s.type === 'end') {
      // 출발 장소와 다른 곳에서 끝나면(1일차 → 숙소, 마지막 날 → 집) 끝 지점도 표시
      const st = stops[0];
      const far = Math.abs(st.place.pos.lat - s.place.pos.lat) + Math.abs(st.place.pos.lng - s.place.pos.lng) > 0.0003;
      if (far) markers.push({ ...s.place.pos, label: s.place.kind === 'lodging' ? '숙' : '도', home: true, name: s.place.name });
    }
    else if (s.type === 'visit' || s.type === 'meal') markers.push({ ...s.place.pos, label: String(++n), home: false, name: s.place.name });
    else if (s.type === 'rest') markers.push({ ...s.place.pos, label: '☕', home: false, name: s.place.name });
    prev = s;
  }
  return { markers, segs };
}

/** 키가 없을 때: 좌표를 비율대로 그린 간단한 경로도 */
function SvgMap({ stops }: { stops: Stop[] }) {
  const { markers, segs } = useMemo(() => buildGeometry(stops), [stops]);
  const W = 400;
  const H = 190;
  const pad = 24;
  const all = [...markers.map((m) => [m.lng, m.lat] as [number, number]), ...segs.flatMap((s) => s.points)];
  const lngs = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const minX = Math.min(...lngs) * kx;
  const maxX = Math.max(...lngs) * kx;
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const s = Math.min((W - pad * 2) / Math.max(maxX - minX, 1e-6), (H - pad * 2) / Math.max(maxY - minY, 1e-6));
  const ox = (W - (maxX - minX) * s) / 2;
  const oy = (H - (maxY - minY) * s) / 2;
  const P = ([lng, lat]: [number, number]) => [ox + (lng * kx - minX) * s, H - (oy + (lat - minY) * s)] as const;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="이동 경로 개략도">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#e6eeee" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      {segs.map((sg, i) => (
        <polyline
          key={i}
          points={sg.points.map((p) => P(p).join(',')).join(' ')}
          fill="none"
          stroke={sg.taxi ? '#c4501b' : '#106f6b'}
          strokeWidth={sg.taxi ? 2.5 : 3}
          strokeDasharray={sg.taxi ? '6 5' : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />
      ))}
      {markers.map((m, i) => {
        const [x, y] = P([m.lng, m.lat]);
        return (
          <g key={i}>
            <title>{m.name}</title>
            <circle cx={x} cy={y} r={m.label === '☕' ? 8 : 11} fill={m.home ? '#17262f' : m.label === '☕' ? '#ffffff' : '#106f6b'} stroke={m.label === '☕' ? '#106f6b' : '#fff'} strokeWidth="2" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={m.label === '☕' ? 9 : 11} fontWeight="800" fill={m.label === '☕' ? '#106f6b' : '#fff'}>
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 카카오맵 JS SDK (VITE_KAKAO_JS_KEY 가 있을 때) */
function KakaoMap({ stops, onFail }: { stops: Stop[]; onFail: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps()
      .then((kakao) => {
        if (cancelled || !ref.current) return;
        const { markers, segs } = buildGeometry(stops);
        const map = new kakao.maps.Map(ref.current, { center: new kakao.maps.LatLng(markers[0].lat, markers[0].lng), level: 5 });
        const bounds = new kakao.maps.LatLngBounds();
        segs.forEach((sg) => {
          const path = sg.points.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
          path.forEach((p: any) => bounds.extend(p));
          new kakao.maps.Polyline({
            map,
            path,
            strokeWeight: sg.taxi ? 4 : 5,
            strokeColor: sg.taxi ? '#c4501b' : '#106f6b',
            strokeOpacity: 0.85,
            strokeStyle: sg.taxi ? 'shortdash' : 'solid',
          });
        });
        markers.forEach((m) => {
          const pos = new kakao.maps.LatLng(m.lat, m.lng);
          bounds.extend(pos);
          const el = document.createElement('div');
          el.className = `kmarker${m.home ? ' home' : ''}`;
          el.textContent = m.label;
          el.title = m.name;
          new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 0.5 });
        });
        map.setBounds(bounds, 24, 24, 24, 24);
      })
      .catch(() => !cancelled && onFail());
    return () => {
      cancelled = true;
    };
  }, [stops, onFail]);
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

export function RouteMap({ stops }: { stops: Stop[] }) {
  const [kakaoFailed, setKakaoFailed] = useState(false);
  const onFail = useCallback(() => setKakaoFailed(true), []);
  const useKakao = !!KAKAO_JS_KEY && !kakaoFailed;
  return (
    <div className="map">
      {useKakao ? <KakaoMap stops={stops} onFail={onFail} /> : <SvgMap stops={stops} />}
      <div className="map-legend">
        <span>
          <i />
          도보
        </span>
        <span>
          <i className="taxi" />
          택시
        </span>
        {!useKakao && <span>개략도</span>}
      </div>
    </div>
  );
}
