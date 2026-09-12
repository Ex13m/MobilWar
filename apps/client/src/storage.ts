import { uid, type AvatarId, type PlayMode } from "@mobilwar/shared";

const KEY = "mobilwar.profile.v1";

export interface Profile {
  deviceId: string;
  nick: string;
  avatar: AvatarId;
  playMode: PlayMode;
  lastRoom?: string;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Profile>) };
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
  return { deviceId: uid("dev"), nick: "", avatar: "scout", playMode: "ar" };
}
