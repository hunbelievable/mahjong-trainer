// =============================================================================
// League domain — Postgres is directly authoritative here (unlike Room/Match,
// there is no in-memory runtime this mirrors). A normal awaited CRUD layer,
// not fire-and-forget: a commissioner action should report success/failure to
// the UI, and there's no live gameplay here to protect from blocking. Hard
// module boundary: references User and score records only — never GameRoom,
// never the engine. See docs/league-handoff.md and prisma/schema.prisma's
// League section comment.
//
// Vacated-seat hands (RoomManager.convertToCpu / MatchPlayer.vacatedAtGame)
// are EXCLUDED from a player's league standing — locked policy, 2026-07-09.
// syncSessionScoresFromRooms (Phase 2) is where this is enforced: it skips any
// MatchGame at/after a seat's vacatedAtGame when summing that player's points.
//
// Phase 2 auto-feed reads Room/Match/MatchPlayer/MatchGame — the DURABLE
// POSTGRES READ-MODEL, never RoomManager/GameRoom/the live engine. That's the
// same discipline the Match/MatchGame layer already follows (see its own
// header comment) and is what "references User and score records only" means
// in practice: read-model-only, never the live runtime.
// =============================================================================

import { prisma } from "@/lib/prisma";

type Role = "commissioner" | "member";

export interface LeagueSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
}

/** Every league a user belongs to (as commissioner or member), newest first. */
export async function listMyLeagues(userId: string): Promise<LeagueSummary[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    include: { league: { include: { _count: { select: { members: true } } } } },
    orderBy: { league: { createdAt: "desc" } },
  });
  return memberships.map((m) => ({
    id: m.league.id,
    name: m.league.name,
    role: m.role as Role,
    memberCount: m.league._count.members,
  }));
}

/** Creates a League and seats its creator as commissioner (also a LeagueMember row, so they appear in listings without special-casing). */
export async function createLeague(commissionerUserId: string, name: string): Promise<{ id: string }> {
  const league = await prisma.league.create({
    data: {
      name,
      commissionerUserId,
      members: { create: { userId: commissionerUserId, role: "commissioner" } },
    },
  });
  return { id: league.id };
}

export interface LeagueMemberView {
  userId: string;
  email: string;
  handle: string | null;
  role: Role;
}

export interface SeasonSummary {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date | null;
}

export interface LeagueDetail {
  id: string;
  name: string;
  commissionerUserId: string;
  members: LeagueMemberView[];
  seasons: SeasonSummary[];
}

export async function getLeagueDetail(leagueId: string): Promise<LeagueDetail | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      members: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      seasons: { orderBy: { startsAt: "desc" } },
    },
  });
  if (!league) return null;
  return {
    id: league.id,
    name: league.name,
    commissionerUserId: league.commissionerUserId,
    members: league.members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      handle: m.user.handle,
      role: m.role as Role,
    })),
    seasons: league.seasons.map((s) => ({ id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt })),
  };
}

async function isCommissioner(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { commissionerUserId: true } });
  return league?.commissionerUserId === userId;
}

export async function isLeagueMember(leagueId: string, userId: string): Promise<boolean> {
  const membership = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } } });
  return membership !== null;
}

/**
 * Add a member by email — commissioner-only. Upserts the User row (mirrors
 * the same find-or-create-by-email pattern Cloudflare Access identity already
 * uses), so inviting someone who hasn't signed in yet still works: their real
 * account matches up automatically the first time they do.
 */
export async function addMember(leagueId: string, requestingUserId: string, email: string): Promise<boolean> {
  if (!(await isCommissioner(leagueId, requestingUserId))) return false;
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
  try {
    await prisma.leagueMember.create({ data: { leagueId, userId: user.id, role: "member" } });
    return true;
  } catch {
    return false; // already a member (unique constraint on leagueId+userId)
  }
}

export async function createSeason(leagueId: string, requestingUserId: string, name: string): Promise<{ id: string } | null> {
  if (!(await isCommissioner(leagueId, requestingUserId))) return null;
  const season = await prisma.season.create({ data: { leagueId, name } });
  return { id: season.id };
}

/** Exported for route handlers that need to member-gate a GET by seasonId before returning data. */
export async function seasonLeagueId(seasonId: string): Promise<string | null> {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { leagueId: true } });
  return season?.leagueId ?? null;
}

/** Exported for route handlers that need to member-gate a GET by sessionId before returning data. */
export async function sessionLeagueId(sessionId: string): Promise<string | null> {
  const session = await prisma.leagueSession.findUnique({
    where: { id: sessionId },
    select: { season: { select: { leagueId: true } } },
  });
  return session?.season.leagueId ?? null;
}

export interface SeasonDetail {
  id: string;
  name: string;
  leagueId: string;
  leagueName: string;
  sessions: Array<{ id: string; scheduledAt: Date; label: string | null }>;
}

export async function getSeasonDetail(seasonId: string): Promise<SeasonDetail | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { league: true, sessions: { orderBy: { scheduledAt: "desc" } } },
  });
  if (!season) return null;
  return {
    id: season.id,
    name: season.name,
    leagueId: season.leagueId,
    leagueName: season.league.name,
    sessions: season.sessions.map((s) => ({ id: s.id, scheduledAt: s.scheduledAt, label: s.label })),
  };
}

/** Starts a league night — deliberately minimal, no RSVP/calendar (locked policy, 2026-07-09): the commissioner clicks a button when everyone's there. */
export async function startSession(
  seasonId: string,
  requestingUserId: string,
  label: string | null,
): Promise<{ id: string } | null> {
  const leagueId = await seasonLeagueId(seasonId);
  if (!leagueId || !(await isCommissioner(leagueId, requestingUserId))) return null;
  const session = await prisma.leagueSession.create({ data: { seasonId, label } });
  return { id: session.id };
}

export interface ScoreEntry {
  userId: string;
  points: number;
}

/** Commissioner-only. One row per (sessionId, userId) — re-entering a session's scores updates in place rather than duplicating. */
export async function enterScores(sessionId: string, requestingUserId: string, entries: ScoreEntry[]): Promise<boolean> {
  const leagueId = await sessionLeagueId(sessionId);
  if (!leagueId || !(await isCommissioner(leagueId, requestingUserId))) return false;
  await Promise.all(
    entries.map((e) =>
      prisma.scoreRecord.upsert({
        where: { sessionId_userId: { sessionId, userId: e.userId } },
        create: { sessionId, userId: e.userId, points: e.points, source: "manual", enteredByUserId: requestingUserId },
        update: { points: e.points, enteredByUserId: requestingUserId },
      }),
    ),
  );
  return true;
}

export interface SessionScoreView {
  userId: string;
  handle: string | null;
  email: string;
  points: number;
}

export async function getSessionScores(sessionId: string): Promise<SessionScoreView[]> {
  const records = await prisma.scoreRecord.findMany({ where: { sessionId }, include: { user: true } });
  return records.map((r) => ({ userId: r.userId, handle: r.user.handle, email: r.user.email, points: r.points }));
}

export interface StandingsRow {
  userId: string;
  handle: string | null;
  email: string;
  totalPoints: number;
  sessionsPlayed: number;
}

/** Cumulative payout points across a season's sessions (locked scoring model, 2026-07-09) — sorted highest first. */
export async function getSeasonStandings(seasonId: string): Promise<StandingsRow[]> {
  const records = await prisma.scoreRecord.findMany({
    where: { session: { seasonId } },
    include: { user: true },
  });
  const byUser = new Map<string, StandingsRow>();
  for (const r of records) {
    const existing = byUser.get(r.userId);
    if (existing) {
      existing.totalPoints += r.points;
      existing.sessionsPlayed += 1;
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        handle: r.user.handle,
        email: r.user.email,
        totalPoints: r.points,
        sessionsPlayed: 1,
      });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => b.totalPoints - a.totalPoints);
}

// ── Phase 2: linked rooms + online auto-feed ────────────────────────────────

/**
 * Link a multiplayer room to a league night — commissioner-only. Upserts the
 * Postgres Room row rather than requiring it to pre-exist: a room's row is
 * only created (via connectOrCreate) when its first Match starts, so linking
 * immediately after `POST /api/rooms` creates it (the normal "N pre-seated
 * tables" flow) would otherwise find nothing there yet.
 */
export async function linkRoomToSession(sessionId: string, requestingUserId: string, roomId: string): Promise<boolean> {
  const leagueId = await sessionLeagueId(sessionId);
  if (!leagueId || !(await isCommissioner(leagueId, requestingUserId))) return false;
  await prisma.room.upsert({
    where: { id: roomId },
    create: { id: roomId, leagueSessionId: sessionId, createdById: requestingUserId },
    update: { leagueSessionId: sessionId },
  });
  return true;
}

export interface LinkedRoomView {
  roomId: string;
  matchFinished: boolean;
}

/** Rooms linked to a league night, with whether each one's match has finished (i.e. is ready to sync). */
export async function getLinkedRooms(sessionId: string): Promise<LinkedRoomView[]> {
  const rooms = await prisma.room.findMany({
    where: { leagueSessionId: sessionId },
    include: { matches: { orderBy: { startedAt: "desc" }, take: 1, select: { endedAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rooms.map((r) => ({ roomId: r.id, matchFinished: r.matches[0]?.endedAt != null }));
}

export interface SyncResult {
  syncedPlayers: number;
  roomsSynced: number;
  roomsSkipped: number;
}

/**
 * Commissioner-only. Sums each human player's payouts across a linked room's
 * whole Match (excluding any MatchGame at/after that seat's vacatedAtGame —
 * locked policy) and upserts one ScoreRecord per player for the night,
 * source="online". Aggregates across ALL of a session's linked rooms before
 * writing (not per-room) so a player who somehow appears in more than one
 * table adds rather than overwrites; safe to call repeatedly as tables finish
 * — rooms whose match hasn't ended yet are counted as skipped, not errored.
 */
export async function syncSessionScoresFromRooms(sessionId: string, requestingUserId: string): Promise<SyncResult | null> {
  const leagueId = await sessionLeagueId(sessionId);
  if (!leagueId || !(await isCommissioner(leagueId, requestingUserId))) return null;

  const rooms = await prisma.room.findMany({
    where: { leagueSessionId: sessionId },
    include: {
      matches: { orderBy: { startedAt: "desc" }, take: 1, include: { players: true, games: true } },
    },
  });

  const totals = new Map<string, { points: number; matchId: string }>();
  let roomsSynced = 0;
  let roomsSkipped = 0;

  for (const room of rooms) {
    const match = room.matches[0];
    if (!match || !match.endedAt) {
      roomsSkipped++;
      continue;
    }
    for (const player of match.players) {
      if (!player.userId) continue; // CPU seat — never a human to attribute points to
      const cutoff = player.vacatedAtGame ?? Infinity;
      let points = 0;
      for (const game of match.games) {
        if (game.gameNumber >= cutoff) continue; // excludes vacated-seat hands — locked policy, 2026-07-09
        const payouts = game.payouts as Record<string, number>;
        points += payouts[player.seat] ?? 0;
      }
      const existing = totals.get(player.userId);
      totals.set(player.userId, { points: (existing?.points ?? 0) + points, matchId: match.id });
    }
    roomsSynced++;
  }

  await Promise.all(
    Array.from(totals.entries()).map(([userId, { points, matchId }]) =>
      prisma.scoreRecord.upsert({
        where: { sessionId_userId: { sessionId, userId } },
        create: { sessionId, userId, points, source: "online", matchId, enteredByUserId: requestingUserId },
        update: { points, source: "online", matchId, enteredByUserId: requestingUserId },
      }),
    ),
  );

  return { syncedPlayers: totals.size, roomsSynced, roomsSkipped };
}

// ── Phase 2: player history ─────────────────────────────────────────────────

export interface PlayerSeasonHistory {
  seasonId: string;
  seasonName: string;
  totalPoints: number;
  sessionsPlayed: number;
}

export interface PlayerHistory {
  userId: string;
  handle: string | null;
  email: string;
  allTimeTotal: number;
  seasons: PlayerSeasonHistory[];
}

/** A member's full score history within one league, broken down per season (seasons they never scored in are omitted). */
export async function getPlayerHistory(leagueId: string, userId: string): Promise<PlayerHistory | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const seasons = await prisma.season.findMany({
    where: { leagueId },
    include: { sessions: { include: { scores: { where: { userId } } } } },
    orderBy: { startsAt: "desc" },
  });

  const seasonRows: PlayerSeasonHistory[] = [];
  let allTimeTotal = 0;
  for (const season of seasons) {
    const scores = season.sessions.flatMap((s) => s.scores);
    if (scores.length === 0) continue;
    const totalPoints = scores.reduce((sum, s) => sum + s.points, 0);
    allTimeTotal += totalPoints;
    seasonRows.push({ seasonId: season.id, seasonName: season.name, totalPoints, sessionsPlayed: scores.length });
  }

  return { userId, handle: user.handle, email: user.email, allTimeTotal, seasons: seasonRows };
}
