import { create } from 'zustand';

const STORAGE_KEY = 'mandao_install_nudge_v1';

interface Persisted {
  dismissedAt: number | null;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissedAt: null };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      dismissedAt: typeof parsed.dismissedAt === 'number' ? parsed.dismissedAt : null,
    };
  } catch {
    return { dismissedAt: null };
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
    const next = { dismissedAt: Date.now() };
    save(next);
    set(next);
  },
}));
