import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { RouteStop, SavedRoute, ShortcutPlace } from "../../types";
import { comprehensivePlacesDB } from "../../data/placesDB";
import { getIsoDateString, parseDisplayDateToIso } from "../../utils/dateUtils";
import { newId } from "./usePhonePlanner";
import { PhoneDialog, PhoneHeader } from "./PhonePrimitives";

export function StopPicker({
  shortcuts,
  onAdd,
  onClose,
}: {
  shortcuts: ShortcutPlace[];
  onAdd: (stop: RouteStop) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [error, setError] = useState("");
  const results = query.trim()
    ? comprehensivePlacesDB
        .filter((place) =>
          `${place.name} ${place.roadAddress}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
  return (
    <PhoneDialog title="방문지 추가" onClose={onClose}>
      <label className="search-field">
        <Search size={20} />
        <input
          autoFocus
          aria-label="장소 이름 검색"
          placeholder="어디에 들를까요?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="field-hint">
        저장한 장소와 예시 장소에서 검색해요. 실시간 검색은 아니에요.
      </p>
      {!query && shortcuts.length > 0 && (
        <div className="shortcut-list">
          {shortcuts.map((place) => (
            <button
              key={place.id}
              className="shortcut-button"
              onClick={() =>
                onAdd({
                  id: newId("stop"),
                  name: place.name,
                  address: place.address,
                  latitude: place.latitude,
                  longitude: place.longitude,
                })
              }
            >
              <Bookmark size={18} />
              <span>
                {place.keyword}
                <small>{place.name}</small>
              </span>
              <Plus size={18} />
            </button>
          ))}
        </div>
      )}
      {results.map((place, index) => (
        <button
          className="place-result"
          key={`${place.name}-${index}`}
          onClick={() =>
            onAdd({
              id: newId("stop"),
              name: place.name,
              address: place.roadAddress,
              latitude: place.latitude,
              longitude: place.longitude,
              category: place.category,
              type: place.type,
            })
          }
        >
          <MapPin size={20} />
          <span>
            <strong>{place.name}</strong>
            <small>{place.roadAddress}</small>
          </span>
          <span className="subtle-label">예시</span>
        </button>
      ))}
      {query && results.length === 0 && (
        <p className="field-hint">
          저장된 장소가 없어요. 이름과 주소를 직접 입력할 수 있어요.
        </p>
      )}
      <button
        className="text-button"
        onClick={() => setManual(!manual)}
        aria-expanded={manual}
      >
        직접 입력하기
        <ChevronDown size={17} />
      </button>
      {manual && (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            const latitude = lat.trim() ? Number(lat) : undefined;
            const longitude = lon.trim() ? Number(lon) : undefined;
            if (!query.trim()) return setError("방문지 이름을 입력해 주세요.");
            if (
              (latitude === undefined) !== (longitude === undefined) ||
              (latitude !== undefined &&
                (!Number.isFinite(latitude) ||
                  latitude < -90 ||
                  latitude > 90 ||
                  !Number.isFinite(longitude) ||
                  longitude! < -180 ||
                  longitude! > 180))
            )
              return setError("위도와 경도를 모두 올바르게 입력해 주세요.");
            onAdd({
              id: newId("stop"),
              name: query.trim(),
              address: address.trim() || undefined,
              latitude,
              longitude,
            });
          }}
        >
          <label>
            주소
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="도로명 주소"
            />
          </label>
          <details>
            <summary>좌표 입력 (선택)</summary>
            <div className="form-pair">
              <label>
                위도
                <input
                  inputMode="decimal"
                  value={lat}
                  onChange={(event) => setLat(event.target.value)}
                  placeholder="37.5"
                />
              </label>
              <label>
                경도
                <input
                  inputMode="decimal"
                  value={lon}
                  onChange={(event) => setLon(event.target.value)}
                  placeholder="127.0"
                />
              </label>
            </div>
          </details>
          <p className="field-hint">
            좌표 없는 장소는 계획에만 저장돼요. 차량 안내 전 위치 확인이
            필요해요.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit">
            <Plus size={19} />
            방문지 추가
          </button>
        </form>
      )}
    </PhoneDialog>
  );
}

export function RouteEditor({
  draft,
  shortcuts,
  onChange,
  onSave,
  onClose,
}: {
  draft: SavedRoute;
  shortcuts: ShortcutPlace[];
  onChange: (route: SavedRoute) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [error, setError] = useState("");
  const changeStop = (id: string, patch: Partial<RouteStop>) =>
    onChange({
      ...draft,
      stops: draft.stops.map((stop) =>
        stop.id === id ? { ...stop, ...patch } : stop,
      ),
    });
  const move = (index: number, offset: number) => {
    const stops = [...draft.stops];
    [stops[index], stops[index + offset]] = [
      stops[index + offset],
      stops[index],
    ];
    onChange({ ...draft, stops });
  };
  return (
    <>
      <PhoneHeader title="경로 편집" back={onClose} />
      <form
        className="phone-content route-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.title.trim()) {
            setError("경로 이름을 입력해 주세요.");
            document.getElementById("route-title")?.focus();
            return;
          }
          if (!draft.stops.length)
            return setError("방문지를 한 곳 이상 추가해 주세요.");
          const unnamed = draft.stops.find((stop) => !stop.name.trim());
          if (unnamed) {
            setOpenStop(unnamed.id);
            setError("방문지 이름을 입력해 주세요.");
            return;
          }
          onSave();
        }}
      >
        <h1>
          어떤 하루를
          <br />
          함께할까요?
        </h1>
        <label>
          경로 이름
          <input
            id="route-title"
            placeholder="예: 서울에서 보내는 하루"
            maxLength={200}
            value={draft.title}
            onChange={(event) =>
              onChange({ ...draft, title: event.target.value })
            }
          />
        </label>
        <div className="form-pair">
          <label>
            날짜
            <input
              type="date"
              value={
                /^\d{4}-/.test(draft.date)
                  ? draft.date
                  : parseDisplayDateToIso(draft.date) || getIsoDateString()
              }
              onChange={(event) =>
                onChange({ ...draft, date: event.target.value })
              }
              required
            />
          </label>
          <label>
            이동 목적
            <select
              aria-label="이동 목적"
              value={
                draft.isBusiness && draft.isTravel
                  ? "hybrid"
                  : draft.isBusiness
                    ? "business"
                    : draft.isTravel
                      ? "travel"
                      : "daily"
              }
              onChange={(event) =>
                onChange({
                  ...draft,
                  isBusiness: ["business", "hybrid"].includes(
                    event.target.value,
                  ),
                  isTravel: ["travel", "hybrid"].includes(event.target.value),
                })
              }
            >
              <option value="travel">여행</option>
              <option value="business">업무</option>
              <option value="hybrid">업무 · 여행</option>
              <option value="daily">일상</option>
            </select>
          </label>
        </div>
        <section className="editor-stops">
          <div className="section-heading">
            <h2>방문 순서</h2>
            <span>{draft.stops.length}곳</span>
          </div>
          {!draft.stops.length && (
            <p className="field-hint">들르고 싶은 곳부터 추가해 보세요.</p>
          )}
          {draft.stops.map((stop, index) => (
            <div className="editor-stop" key={stop.id}>
              <div className="editor-stop-heading">
                <span className="stop-number">{index + 1}</span>
                <button
                  type="button"
                  className="stop-expand"
                  aria-expanded={openStop === stop.id}
                  onClick={() =>
                    setOpenStop(openStop === stop.id ? null : stop.id)
                  }
                >
                  <strong>{stop.name}</strong>
                  <small>{stop.time || "일정·메모 추가"}</small>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${stop.name} 위로 이동`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${stop.name} 아래로 이동`}
                  disabled={index === draft.stops.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={18} />
                </button>
              </div>
              {openStop === stop.id && (
                <div className="stop-fields">
                  <label>
                    방문지 이름
                    <input
                      value={stop.name}
                      required
                      maxLength={200}
                      onChange={(event) =>
                        changeStop(stop.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    주소
                    <input
                      value={stop.address ?? ""}
                      onChange={(event) =>
                        changeStop(stop.id, { address: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    약속 시간
                    <input
                      type="time"
                      value={stop.time ?? ""}
                      onChange={(event) =>
                        changeStop(stop.id, { time: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    메모
                    <textarea
                      aria-label="메모"
                      value={stop.memo ?? ""}
                      rows={3}
                      onChange={(event) =>
                        changeStop(stop.id, { memo: event.target.value })
                      }
                      placeholder="이곳에서 기억해 둘 내용"
                    />
                  </label>
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={() =>
                      onChange({
                        ...draft,
                        stops: draft.stops.filter(
                          (item) => item.id !== stop.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={17} />
                    방문지 빼기
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            className="secondary-button add-stop"
            type="button"
            onClick={() => setPicker(true)}
          >
            <Plus size={19} />
            방문지 추가
          </button>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-save">
          <button type="submit" className="primary-button">
            <Check size={19} />
            경로 저장
          </button>
          <span>이 기기에 저장돼요.</span>
        </div>
      </form>
      {picker && (
        <StopPicker
          shortcuts={shortcuts}
          onClose={() => setPicker(false)}
          onAdd={(stop) => {
            onChange({ ...draft, stops: [...draft.stops, stop] });
            setPicker(false);
            setOpenStop(stop.id);
          }}
        />
      )}
    </>
  );
}
