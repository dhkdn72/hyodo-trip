import { useEffect, useState } from 'react';
import type { Place, PlaceDetail } from '@hyodo/core';
import { fetchPlaceDetail } from '../lib/api';
import { AccessBadges } from './ui';

const dist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);

/**
 * 장소 상세 — 사진, 소개, 이용시간·쉬는 날·메뉴, 근처 관광지, 카카오맵 링크
 * TourAPI 에 음식점 가격 정보가 없어 가격·리뷰는 카카오맵 장소 페이지로 연결합니다.
 */
export function PlaceDetailView({ place }: { place: Place }) {
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(null);
    setMore(false);
    fetchPlaceDetail({ id: place.id, name: place.name, pos: place.pos, contentTypeId: place.contentTypeId, kind: place.kind, addr: place.addr })
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [place.id, place.name, place.pos, place.contentTypeId, place.kind, place.addr]);

  const images = detail?.images.length ? detail.images : place.image ? [place.image] : [];
  const isFood = place.kind === 'restaurant' || place.contentTypeId === '39';
  const ov = detail?.overview;

  return (
    <div className="pd">
      {images.length > 0 && (
        <div className="pd-photos" aria-label="사진">
          {images.map((src, i) => (
            <img key={src} src={src} alt={`${place.name} 사진 ${i + 1}`} loading="lazy" />
          ))}
        </div>
      )}
      {images.length > 0 && detail?.source === 'tourapi' && <p className="pd-credit">사진·정보: 한국관광공사</p>}

      <AccessBadges place={place} />
      {place.access?.known && (
        <ul className="pd-access">
          {Object.entries(place.access.items)
            .filter(([, v]) => v?.text && v.text !== '예시 데이터')
            .map(([k, v]) => (
              <li key={k}>{v!.text}</li>
            ))}
        </ul>
      )}

      {!detail && !err && <p className="subtitle pd-loading">정보를 불러오고 있어요…</p>}
      {err && <p className="error-text">{err}</p>}

      {ov && (
        <div className="pd-overview">
          <p className={more ? '' : 'clamp'}>{ov}</p>
          {ov.length > 120 && (
            <button className="btn text small" onClick={() => setMore(!more)}>
              {more ? '접기' : '더 보기'}
            </button>
          )}
        </div>
      )}

      {detail && (detail.info.length > 0 || detail.tel || detail.homepage) && (
        <dl className="pd-info">
          {detail.info.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
          {detail.tel && !detail.info.some((r) => r.label === '문의') && (
            <div>
              <dt>전화</dt>
              <dd>
                <a href={`tel:${detail.tel.replace(/[^\d+]/g, '')}`}>{detail.tel}</a>
              </dd>
            </div>
          )}
          {detail.homepage && (
            <div>
              <dt>홈페이지</dt>
              <dd>
                <a href={detail.homepage} target="_blank" rel="noopener noreferrer">
                  {detail.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {detail && (
        <a className="btn outline pd-kakao" href={detail.kakaoUrl} target="_blank" rel="noopener noreferrer">
          {detail.kakaoUrlKind === 'place' ? (isFood ? '카카오맵에서 메뉴·가격·리뷰 보기' : '카카오맵에서 사진·리뷰 보기') : '카카오맵에서 위치 보기'}
        </a>
      )}
      {detail && isFood && detail.kakaoUrlKind === 'place' && (
        <p className="field-sub">관광공사 자료에는 가격이 없어 카카오맵 장소 페이지로 연결해요.</p>
      )}

      {detail && detail.nearby.length > 0 && (
        <div className="pd-nearby">
          <span className="field-label">근처 가볼 만한 곳</span>
          <ul>
            {detail.nearby.map((n) => (
              <li key={n.name}>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {n.name}
                  </a>
                ) : (
                  <span>{n.name}</span>
                )}
                <small>
                  {n.category ? `${n.category} · ` : ''}
                  {dist(n.distance)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
