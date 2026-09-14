const num = (v) => (v === null ? null : Number(v));

export async function getPlanning(db) {
  const settings = (await db.query(
    'select hours_per_point, load_ceiling_pct, default_weekly_hours from settings',
  )).rows[0];
  const holidays = await db.query(
    "select to_char(day, 'YYYY-MM-DD') as day, label from holiday order by day",
  );
  const people = await db.query(
    'select linear_user_id, role, default_weekly_hours, active from person order by linear_user_id',
  );
  const capacities = await db.query(
    "select linear_user_id, to_char(week_start, 'YYYY-MM-DD') as week_start, hours from weekly_capacity order by linear_user_id, week_start",
  );
  const contributions = await db.query(
    'select issue_id, linear_user_id, share from contribution order by issue_id, linear_user_id',
  );
  return {
    settings: {
      hoursPerPoint: num(settings.hours_per_point),
      loadCeilingPct: num(settings.load_ceiling_pct),
      defaultWeeklyHours: num(settings.default_weekly_hours),
    },
    holidays: holidays.rows.map((r) => ({ day: r.day, label: r.label })),
    people: people.rows.map((r) => ({
      linearUserId: r.linear_user_id, role: r.role, defaultWeeklyHours: num(r.default_weekly_hours), active: r.active,
    })),
    weeklyCapacities: capacities.rows.map((r) => ({
      linearUserId: r.linear_user_id, weekStart: r.week_start, hours: num(r.hours),
    })),
    contributions: contributions.rows.map((r) => ({
      issueId: r.issue_id, linearUserId: r.linear_user_id, share: num(r.share),
    })),
  };
}

export async function updateSettings(db, { hoursPerPoint, loadCeilingPct, defaultWeeklyHours }) {
  await db.query(
    'update settings set hours_per_point = $1, load_ceiling_pct = $2, default_weekly_hours = $3, updated_at = now()',
    [hoursPerPoint, loadCeilingPct, defaultWeeklyHours],
  );
}

export async function ensurePeople(db, userIds) {
  if (!userIds.length) return;
  await db.transaction(async (tx) => {
    for (const id of userIds) {
      await tx.query('insert into person (linear_user_id) values ($1) on conflict do nothing', [id]);
    }
  });
}

export async function updatePerson(db, userId, { role, defaultWeeklyHours }) {
  await db.query(
    `insert into person (linear_user_id, role, default_weekly_hours) values ($1, $2, $3)
     on conflict (linear_user_id) do update set role = excluded.role, default_weekly_hours = excluded.default_weekly_hours`,
    [userId, role, defaultWeeklyHours],
  );
}

export async function setWeeklyCapacity(db, userId, weekStart, hours) {
  await db.transaction(async (tx) => {
    await tx.query('insert into person (linear_user_id) values ($1) on conflict do nothing', [userId]);
    await tx.query(
      `insert into weekly_capacity (linear_user_id, week_start, hours) values ($1, $2, $3)
       on conflict (linear_user_id, week_start) do update set hours = excluded.hours`,
      [userId, weekStart, hours],
    );
  });
}

export async function deleteWeeklyCapacity(db, userId, weekStart) {
  await db.query('delete from weekly_capacity where linear_user_id = $1 and week_start = $2', [userId, weekStart]);
}

export async function setContributions(db, issueId, shares) {
  await db.transaction(async (tx) => {
    await tx.query('delete from contribution where issue_id = $1', [issueId]);
    for (const { linearUserId, share } of shares) {
      await tx.query(
        'insert into contribution (issue_id, linear_user_id, share) values ($1, $2, $3)',
        [issueId, linearUserId, share],
      );
    }
  });
}

export async function clearContributions(db, issueId) {
  await db.query('delete from contribution where issue_id = $1', [issueId]);
}

export async function addHoliday(db, day, label) {
  await db.query(
    'insert into holiday (day, label) values ($1, $2) on conflict (day) do update set label = excluded.label',
    [day, label],
  );
}

export async function deleteHoliday(db, day) {
  await db.query('delete from holiday where day = $1', [day]);
}

export async function purgeContributions(db, validPairs) {
  const valid = new Set(validPairs.map((p) => `${p.issueId}|${p.linearUserId}`));
  const rows = (await db.query('select issue_id, linear_user_id from contribution')).rows;
  const stale = rows.filter((r) => !valid.has(`${r.issue_id}|${r.linear_user_id}`));
  if (!stale.length) return 0;
  await db.transaction(async (tx) => {
    for (const r of stale) {
      await tx.query('delete from contribution where issue_id = $1 and linear_user_id = $2', [r.issue_id, r.linear_user_id]);
    }
  });
  return stale.length;
}
