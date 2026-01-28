import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COOLDOWN_MS = 2000;

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
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.2,
        audioContext.currentTime + 0.01
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.12
      );
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.13);
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
