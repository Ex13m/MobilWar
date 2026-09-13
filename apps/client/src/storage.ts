import { defaultLoadout, sanitizeLoadout, uid, type AvatarId, type Loadout, type PlayMode } from "@mobilwar/shared";

const KEY = "mobilwar.profile.v1";

export interface Profile {
  deviceId: string;
  nick: string;
  avatar: AvatarId;
  playMode: PlayMode;
  lastRoom?: string;
  loadout: Loadout;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...defaults(), ...(JSON.parse(raw) as Partial<Profile>) };
      p.loadout = sanitizeLoadout(p.loadout);
      return p;
    }
  } catch {
    /* ignore */
  }
  const p = defaults();
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function defaults(): Profile {
  return { deviceId: uid("dev"), nick: "", avatar: "scout", playMode: "ar", loadout: defaultLoadout() };
}
