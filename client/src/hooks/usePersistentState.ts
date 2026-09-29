import { useEffect, useState } from 'react';

/**
 * 与 localStorage 同步的状态：用于播放记录、下载记录这类需要跨刷新保留的数据。
 * 读取失败（隐私模式 / 数据损坏）时静默回退到初始值，不影响主流程。
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 超出配额或隐私模式：忽略，退化为内存状态 */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
