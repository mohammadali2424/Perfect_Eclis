export type WorldEventTier = "T1";

export type WorldEventTag =
  | "CITY"
  | "SIEGE"
  | "CAPTURE"
  | "FACTION"
  | "GOV"
  | "ALLIANCE"
  | "WAR"
  | "BOSS"
  | "PHENOMENON"
  | "CARAVAN"
  | "RAID"
  | "ROADS"
  | "BATTLE"
  | "FIGHT"
  | "DEATH"
  | "KILL"
  | "ARMY"
  | "SPAWN"
  | "MOVE"
  | "DESTROY";

export interface WorldEvent {
  tier: WorldEventTier;
  tags: WorldEventTag[];
  title: string;
  summary: string;

  region?: string;
  spot?: string;
  zone?: string;

  actorLabel?: string;
  targetLabel?: string;

  ts?: string;
  meta?: Record<string, any>;
}
