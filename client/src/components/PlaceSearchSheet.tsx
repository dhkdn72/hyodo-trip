import { useEffect, useRef, useState } from 'react';
import type { GeoResult, LatLng } from '@hyodo/core';
import { geoSearch } from '../lib/api';
import { Sheet } from './ui';

/** 화면 ① 지역·출발 장소 검색 (서버가 카카오 로컬 API 로 주소→좌표 변환) */
export function PlaceSearchSheet({
  open,
  kind,
  onClose,
  onPick,
  sampleNote,
}: {
  open: boolean;
  kind: 'region' | 'origin';
  onClose: () => void;
  onPick: (v: { name: string; pos: LatLng }) => void;
  sampleNote?: string | null;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (query: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await geoSearch(query, kind);
      setResults(r.results);
      setSource(r.source);
      if (!r.results.length) setErr('검색 결과가 없어요. 다른 이름이나 주소로 찾아 보세요.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) {
      setQ('');
      setErr(null);
      run('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  return (
    <Sheet open={open} onClose={onClose} title={kind === 'region' ? '어느 지역으로 가세요?' : '어디서 출발하세요?'}>
      <form
        className="sheet-search"
        onSubmit={(e) => {
          e.preventDefault();
          run(q.trim());
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === 'region' ? '예: 명동, 경복궁, 전주 한옥마을' : '숙소 이름이나 주소 (예: 서울역)'}
          aria-label="검색어"
        />
        <button type="submit" disabled={busy}>
          {busy ? '…' : '검색'}
        </button>
      </form>
      {source === 'sample' && sampleNote && <p className="notice" style={{ marginTop: 10 }}>{sampleNote}</p>}
      {err && <p className="error-text">{err}</p>}
      <ul className="result-list">
        {results.map((r, i) => (
          <li key={`${r.name}-${i}`}>
            <button
              onClick={() => {
                onPick({ name: r.name, pos: r.pos });
                onClose();
              }}
            >
              <b>{r.name}</b>
              {r.addr && <span>{r.addr}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
