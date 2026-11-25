import React, { useEffect, useMemo, useRef, useState } from "react";
import { TrackRecord } from "../types/music";
import { IconDisc, IconPause, IconPlay } from "./Icons";

interface MiniTransportBarProps {
  track: TrackRecord | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function parseLrcLines(lrc: string): Array<{ timeSec: number; text: string }> {
  const lines: Array<{ timeSec: number; text: string }> = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      const text = m[4].trim();
      if (text) {
        lines.push({ timeSec: min * 60 + sec + ms / 1000, text });
      }
    }
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
}

export const MiniTransportBar: React.FC<MiniTransportBarProps> = ({
  track,
  isPlaying,
  onTogglePlay,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscNodesRef = useRef<OscillatorNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);

  const [currentSec, setCurrentSec] = useState(0);
  const totalSec = track ? Math.max(1, Math.round(track.specs.durationMs / 1000)) : 180;

  // Deterministic pseudo-waveform heights per track
  const waveBars = useMemo(() => {
    const seedStr = track?.id || "default";
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bars: number[] = [];
    for (let i = 0; i < 42; i++) {
      h = Math.imul(h ^ i, 16777619);
      const norm = (Math.abs(h) % 70) + 25;
      bars.push(norm);
    }
    return bars;
  }, [track?.id]);

  // Reset position when track changes
  useEffect(() => {
    setCurrentSec(0);
  }, [track?.id]);

  // Real audio or gentle WebAudio audition chord
  useEffect(() => {
    const stopSynth = () => {
      oscNodesRef.current.forEach((o) => {
        try {
          o.stop();
          o.disconnect();
        } catch {}
      });
      oscNodesRef.current = [];
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
    };

    if (!track || !isPlaying) {
      audioRef.current?.pause();
      stopSynth();
      return;
    }

    if (track.objectUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      if (audioRef.current.src !== track.objectUrl) {
        audioRef.current.src = track.objectUrl;
      }
      audioRef.current.currentTime = currentSec;
      audioRef.current.play().catch(() => {});
      return () => {
        audioRef.current?.pause();
      };
    } else {
      // Gentle harmonic preview for pre-populated demo tracks (zero external audio asset needed)
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!audioCtxRef.current) {
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") ctx.resume();
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.12);
        master.connect(ctx.destination);
        gainNodeRef.current = master;

        const freqs = [220, 277.18, 329.63];
        oscNodesRef.current = freqs.map((f) => {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = f;
          osc.connect(master);
          osc.start();
          return osc;
        });
      } catch {}
    }

    return () => {
      stopSynth();
    };
  }, [track?.id, track?.objectUrl, isPlaying]);

  useEffect(() => {
    if (!isPlaying || !track) return;
    const timer = window.setInterval(() => {
      if (track.objectUrl && audioRef.current) {
        setCurrentSec(audioRef.current.currentTime);
      } else {
        setCurrentSec((prev) => (prev + 1 >= totalSec ? 0 : prev + 1));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, track, totalSec]);

  const lrcLines = useMemo(
    () => (track?.lyrics ? parseLrcLines(track.lyrics) : []),
    [track?.lyrics]
  );

  const activeLyric = useMemo(() => {
    if (lrcLines.length === 0) return "";
    let current = lrcLines[0].text;
    for (const line of lrcLines) {
      if (line.timeSec <= currentSec) {
        current = line.text;
      } else {
        break;
      }
    }
    return current;
  }, [lrcLines, currentSec]);

  const progressRatio = Math.min(1, currentSec / totalSec);

  return (
    <footer className="transport-bar" aria-label="音频快速试听与实时歌词栏">
      <div className="transport-now">
        <div
          className={`transport-vinyl-disc ${isPlaying && track ? "playing" : ""}`}
          aria-hidden="true"
        >
          {track?.coverDataUrl ? (
            <img
              src={track.coverDataUrl}
              alt=""
              className="transport-thumb"
              width={32}
              height={32}
            />
          ) : (
            <div className="transport-thumb">
              <IconDisc size={15} />
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track ? track.title || track.fileName : "未选择试听音轨"}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track
              ? `${track.artist || "未知歌手"} · ${track.album || "未知专辑"}`
              : "点击时长列的播放键或按 Space 试听核对音频"}
          </div>
        </div>
      </div>

      <div className="transport-controls-center">
        <button
          type="button"
          className="tool-btn icon-only"
          disabled={!track}
          aria-label={isPlaying ? "暂停试听" : "播放试听"}
          onClick={onTogglePlay}
        >
          {isPlaying ? <IconPause size={13} /> : <IconPlay size={13} />}
        </button>

        <span className="mono" style={{ fontSize: "11px", color: "var(--text-tertiary)", width: "38px" }}>
          {formatSec(currentSec)}
        </span>

        <div
          className="waveform-strip"
          role="slider"
          tabIndex={0}
          aria-label="试听进度条"
          aria-valuemin={0}
          aria-valuemax={totalSec}
          aria-valuenow={Math.round(currentSec)}
          onClick={(e) => {
            if (!track) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const nextSec = ratio * totalSec;
            setCurrentSec(nextSec);
            if (track.objectUrl && audioRef.current) {
              audioRef.current.currentTime = nextSec;
            }
          }}
        >
          {waveBars.map((heightPct, idx) => {
            const barRatio = idx / waveBars.length;
            return (
              <span
                key={idx}
                className={`wave-bar ${barRatio <= progressRatio ? "played" : ""}`}
                style={{ height: `${heightPct}%` }}
              />
            );
          })}
        </div>

        <span className="mono" style={{ fontSize: "11px", color: "var(--text-tertiary)", width: "38px", textAlign: "right" }}>
          {formatSec(totalSec)}
        </span>
      </div>

      <div className="transport-lyric-right">
        {activeLyric ? (
          <span className="lyric-ticker" title={activeLyric}>
            {activeLyric}
          </span>
        ) : track ? (
          <span className="spec-pill">
            {track.specs.codec} {track.specs.bitDepth}-bit /{" "}
            {(track.specs.sampleRate / 1000).toFixed(1)} kHz
          </span>
        ) : (
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Space 快捷播放/暂停
          </span>
        )}
      </div>
    </footer>
  );
};
