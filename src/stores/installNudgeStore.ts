import { create } from 'zustand';

const STORAGE_KEY = 'mandao_install_nudge_v1';

interface Persisted {
  dismissed: boolean;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: false };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { dismissed: false };
    // Old key was `dismissedAt: number | null`; treat any non-null
    // value there as dismissed too so existing users aren't re-prompted.
    if (parsed.dismissed === true) return { dismissed: true };
    if (typeof parsed.dismissedAt === 'number') return { dismissed: true };
    return { dismissed: false };
  } catch {
    return { dismissed: false };
  }
}

function save(s: Persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface InstallNudgeState extends Persisted {
  dismiss: () => void;
}

export const useInstallNudgeStore = create<InstallNudgeState>((set) => ({
  ...load(),
  dismiss: () => {
    const next = { dismissed: true };
    save(next);
    set(next);
  },
}));
