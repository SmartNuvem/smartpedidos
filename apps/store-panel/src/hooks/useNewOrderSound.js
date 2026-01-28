import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COOLDOWN_MS = 2000;
const BEEP_DURATION_SEC = 0.22;
const PAUSE_DURATION_SEC = 0.08;
const ALERT_VOLUME = 0.16;
const FADE_IN_SEC = 0.01;
const FADE_OUT_SEC = 0.06;

const useNewOrderSound = () => {
  const [unlocked, setUnlocked] = useState(false);
  const audioRef = useRef(null);
  const lastPlayedRef = useRef(0);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }, []);

  const unlock = useCallback(async () => {
    if (!isSupported) {
      setUnlocked(true);
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        setUnlocked(true);
        return;
      }
      const audioContext = audioRef.current ?? new AudioContext();
      audioRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.01);
      setUnlocked(true);
    } catch {
      setUnlocked(true);
    }
  }, [isSupported]);

  const play = useCallback(() => {
    if (!unlocked || !isSupported) {
      return;
    }
    const now = Date.now();
    if (now - lastPlayedRef.current < COOLDOWN_MS) {
      return;
    }
    lastPlayedRef.current = now;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      const audioContext = audioRef.current ?? new AudioContext();
      audioRef.current = audioContext;
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const startTime = audioContext.currentTime;
      const firstBeepEnd = startTime + BEEP_DURATION_SEC;
      const secondBeepStart = firstBeepEnd + PAUSE_DURATION_SEC;
      const secondBeepEnd = secondBeepStart + BEEP_DURATION_SEC;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, startTime);
      gainNode.gain.setValueAtTime(0.0001, startTime);

      gainNode.gain.linearRampToValueAtTime(
        ALERT_VOLUME,
        startTime + FADE_IN_SEC
      );
      gainNode.gain.linearRampToValueAtTime(
        0.0001,
        Math.max(firstBeepEnd - FADE_OUT_SEC, startTime + FADE_IN_SEC)
      );

      gainNode.gain.setValueAtTime(0.0001, firstBeepEnd);
      gainNode.gain.linearRampToValueAtTime(
        ALERT_VOLUME,
        secondBeepStart + FADE_IN_SEC
      );
      gainNode.gain.linearRampToValueAtTime(
        0.0001,
        Math.max(secondBeepEnd - FADE_OUT_SEC, secondBeepStart + FADE_IN_SEC)
      );
      gainNode.gain.setValueAtTime(0.0001, secondBeepEnd);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(startTime);
      oscillator.stop(secondBeepEnd + 0.02);
    } catch {
      // ignore audio errors
    }
  }, [isSupported, unlocked]);

  useEffect(() => {
    if (!isSupported || unlocked) {
      return undefined;
    }
    const handleUnlock = () => {
      unlock();
    };
    window.addEventListener("click", handleUnlock, { once: true });
    window.addEventListener("keydown", handleUnlock, { once: true });
    window.addEventListener("touchstart", handleUnlock, { once: true });

    return () => {
      window.removeEventListener("click", handleUnlock);
      window.removeEventListener("keydown", handleUnlock);
      window.removeEventListener("touchstart", handleUnlock);
    };
  }, [isSupported, unlock, unlocked]);

  return {
    isSupported,
    isUnlocked: unlocked,
    unlock,
    play,
  };
};

export default useNewOrderSound;
